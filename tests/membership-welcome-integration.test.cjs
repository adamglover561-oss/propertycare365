const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { stripTypeScriptTypes } = require('node:module');
const { webcrypto } = require('node:crypto');

// This harness runs the real production Stripe webhook and signature validation.
// All Supabase tables and the Resend HTTP request are isolated fakes: no live
// membership, charge, invoice, or outbound message can be created by this test.
function harness() {
  const rows = {
    stripe_events: [],
    integration_secrets: [
      { name: 'stripe_webhook_signing_secret', secret_value: 'fixture-signing-secret' },
      { name: 'resend_transactional_api_key', secret_value: 'fixture-resend-api-key' }
    ],
    customers: [{
      id: 'customer_test', stripe_customer_id: 'cus_test', email: 'no-reply@example.invalid',
      full_name: 'Integration Test Member'
    }],
    properties: [{
      id: 'property_test', customer_id: 'customer_test', property_name: 'Test Oil Cottage',
      address_line1: '1 Fixture Lane', town_city: 'Test Town', heating_fuel: 'oil'
    }],
    subscriptions: [{
      id: 'subscription_row', customer_id: 'customer_test',
      stripe_subscription_id: 'sub_test', status: 'pending',
      current_period_start: null, current_period_end: null
    }],
    property_cover: [{
      id: 'cover_test', subscription_id: 'subscription_row', property_id: 'property_test',
      active: true, membership_started_at: null, annual_callouts_included: null
    }],
    membership_checkout_consents: [{
      customer_id: 'customer_test', property_id: 'property_test',
      terms_version: '1.7', monthly_price_pence: 1999, accepted_at: '2026-11-09T09:00:00Z'
    }],
    billing_records: [],
    notification_log: []
  };
  const emails = [];
  const ownerNotifications = [];
  let failOneEmail = false;
  const supabase = {
    from(table) {
      if (!(table in rows)) throw Error('Unexpected table in webhook: ' + table);
      let op = 'select', payload, predicates = [], maximum = Infinity;
      function matching() {
        return rows[table].filter(r => predicates.every(p => p(r))).slice(0, maximum);
      }
      function execute() {
        const found = matching();
        if (op === 'insert') {
          if (table === 'stripe_events' && rows.stripe_events.some(r => r.event_id === payload.event_id)) {
            return Promise.resolve({ data: null, error: { code: '23505' } });
          }
          if (table === 'notification_log' &&
              rows.notification_log.some(r => r.notification_key === payload.notification_key)) {
            return Promise.resolve({ data: null, error: { code: '23505' } });
          }
          const item = { id: table + '_' + rows[table].length, ...payload };
          rows[table].push(item);
          return Promise.resolve({ data: [item], error: null });
        }
        if (op === 'update') {
          found.forEach(r => Object.assign(r, payload));
        }
        if (op === 'delete') {
          for (const item of found) rows[table].splice(rows[table].indexOf(item), 1);
        }
        return Promise.resolve({ data: found, error: null });
      }
      const q = {
        select() { return q; },
        eq(field, value) { predicates.push(r => r[field] === value); return q; },
        is(field, value) { predicates.push(r => (r[field] ?? null) === value); return q; },
        order() { return q; },
        limit(n) { maximum = n; return q; },
        or() { throw Error('Unexpected OR query in invoice-only test'); },
        update(value) { op = 'update'; payload = value; return q; },
        delete() { op = 'delete'; return q; },
        insert(value) { op = 'insert'; payload = value; return q; },
        upsert() { throw Error('Unexpected upsert in invoice-only test'); },
        async maybeSingle() {
          const result = await execute();
          return { ...result, data: result.data?.[0] ?? null };
        },
        async single() { return q.maybeSingle(); },
        then(resolve, reject) { return execute().then(resolve, reject); }
      };
      return q;
    }
  };
  let webhook;
  const source = fs.readFileSync('supabase/functions/stripe-webhook/index.ts', 'utf8')
    .replace(/^import .*;$/m, '');
  const context = vm.createContext({
    createClient: () => supabase,
    Deno: {
      env: {
        get(name) {
          if (name === 'SUPABASE_URL') return 'https://example.invalid';
          if (name === 'SUPABASE_SECRET_KEYS') return '{}';
          if (name === 'SUPABASE_SERVICE_ROLE_KEY') return 'fixture-admin-key';
          return undefined;
        }
      },
      serve(fn) { webhook = fn; }
    },
    console, crypto: webcrypto, TextEncoder, Response, Request, Date,
    fetch: async (url, options) => {
      if (url === 'https://api.resend.com/emails') {
        assert.equal(options.headers.Authorization, 'Bearer fixture-resend-api-key');
        const email = JSON.parse(options.body);
        if (failOneEmail) {
          failOneEmail = false;
          return new Response('simulated temporary error', { status: 503 });
        }
        emails.push({ headers: options.headers, ...email });
        return new Response(JSON.stringify({ id: 'fixture-delivery-' + emails.length }), { status: 200 });
      }
      if (url === 'https://example.invalid/functions/v1/owner-push') {
        ownerNotifications.push(JSON.parse(options.body));
        return new Response('{"ok":true}', { status: 200 });
      }
      throw Error('A real network request was attempted: ' + url);
    }
  });
  vm.runInContext(stripTypeScriptTypes(source), context);
  assert.equal(typeof webhook, 'function');

  const paidInvoice = {
    id: 'in_test_first', customer: 'cus_test',
    parent: { subscription_details: {
      subscription: 'sub_test', metadata: { app: 'property_care_365' }
    } },
    billing_reason: 'subscription_create',
    amount_paid: 1999, currency: 'gbp', status: 'paid', created: 1794222040,
    status_transitions: { paid_at: 1794222076 },
    lines: { data: [{
      parent: { subscription_item_details: { subscription: 'sub_test' } },
      period: { start: 1794222040, end: 1796814040 }
    }] }
  };

  async function signedEvent(id, type, invoice = paidInvoice, goodSignature = true) {
    const event = { id, type, data: { object: invoice } };
    const body = JSON.stringify(event);
    const ts = Math.floor(Date.now() / 1000);
    const secret = goodSignature ? 'fixture-signing-secret' : 'invalid-secret';
    const key = await webcrypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
    );
    const bytes = await webcrypto.subtle.sign('HMAC', key, new TextEncoder().encode(ts + '.' + body));
    const signature = Buffer.from(bytes).toString('hex');
    const request = new Request('https://example.invalid/functions/v1/stripe-webhook', {
      method: 'POST', headers: { 'stripe-signature': 't=' + ts + ',v1=' + signature },
      body
    });
    const response = await webhook(request);
    const responseBody = await response.json().catch(() => null);
    return { status: response.status, body: responseBody };
  }
  return {
    rows, emails, ownerNotifications, signedEvent, paidInvoice,
    failNextEmail() { failOneEmail = true; }, context
  };
}

test('signed first paid Stripe invoice triggers a single welcome email and five call-outs', async () => {
  const h = harness();
  const result = await h.signedEvent('evt_first', 'invoice.paid');
  assert.equal(result.status, 200);
  assert.equal(h.rows.subscriptions[0].status, 'active');
  assert.equal(h.rows.subscriptions[0].current_period_start, new Date(1794222040 * 1000).toISOString());
  assert.equal(h.rows.subscriptions[0].current_period_end, new Date(1796814040 * 1000).toISOString());
  assert.equal(h.rows.property_cover[0].annual_callouts_included, 5);
  assert.equal(h.rows.property_cover[0].membership_started_at, new Date(1794222076 * 1000).toISOString());
  assert.equal(h.rows.billing_records.length, 1);
  assert.equal(h.rows.billing_records[0].status, 'paid');
  assert.equal(h.rows.notification_log.length, 1);
  assert.equal(h.rows.notification_log[0].notification_type, 'membership_confirmation_sent');
  assert.equal(h.emails.length, 1);
  const email = h.emails[0];
  assert.equal(email.from, 'Property Care 360 <membership@propertycare360.co.uk>');
  assert.deepEqual(email.to, ['no-reply@example.invalid']);
  assert.equal(email.headers['Idempotency-Key'], 'pc360-welcome-in_test_first');
  assert.match(email.subject, /membership is active/);
  for (const phrase of [
    'Test Oil Cottage', 'OIL', '£19.99', '£239.88', '12 months',
    'five priority', 'boiler service', 'plumbing', 'version 1.7',
    'cooling-off'
  ]) assert.ok(email.text.toLowerCase().includes(phrase.toLowerCase()), phrase);
  assert.equal(h.ownerNotifications.length, 1);
});

test('duplicate Stripe events and a second event for the same invoice cannot resend the email', async () => {
  const h = harness();
  assert.equal((await h.signedEvent('evt_first', 'invoice.paid')).status, 200);
  const dup = await h.signedEvent('evt_first', 'invoice.paid');
  assert.equal(dup.status, 200);
  assert.equal(dup.body.duplicate, true);
  assert.equal((await h.signedEvent('evt_second_delivery', 'invoice.paid')).status, 200);
  assert.equal(h.emails.length, 1);
  assert.equal(h.rows.billing_records.length, 1);
  assert.equal(h.rows.notification_log.length, 1);
});

test('recurring paid invoices update monthly dates without another welcome or annual allowance reset', async () => {
  const h = harness();
  await h.signedEvent('evt_first', 'invoice.paid');
  const originalStart = h.rows.property_cover[0].membership_started_at;
  const renewal = {
    ...h.paidInvoice, id: 'in_test_renewal',
    billing_reason: 'subscription_cycle',
    lines: { data: [{
      parent: { subscription_item_details: { subscription: 'sub_test' } },
      period: { start: 1796814040, end: 1799492440 }
    }] }
  };
  assert.equal((await h.signedEvent('evt_renewal', 'invoice.paid', renewal)).status, 200);
  assert.equal(h.rows.subscriptions[0].current_period_start, new Date(1796814040 * 1000).toISOString());
  assert.equal(h.rows.property_cover[0].membership_started_at, originalStart);
  assert.equal(h.rows.property_cover[0].annual_callouts_included, 5);
  assert.equal(h.rows.billing_records.length, 2);
  assert.equal(h.emails.length, 1);
});

test('missing property cover makes Stripe retry, then the later retry sends the welcome', async () => {
  const h = harness();
  const removed = h.rows.property_cover.pop();
  const early = await h.signedEvent('evt_early', 'invoice.paid');
  assert.equal(early.status, 500);
  assert.equal(h.rows.stripe_events.length, 0);
  assert.equal(h.emails.length, 0);
  h.rows.property_cover.push(removed);
  const retry = await h.signedEvent('evt_early', 'invoice.paid');
  assert.equal(retry.status, 200);
  assert.equal(h.emails.length, 1);
});

test('temporary Resend failure causes Stripe retry rather than falsely recording delivery', async () => {
  const h = harness();
  h.failNextEmail();
  assert.equal((await h.signedEvent('evt_retry', 'invoice.paid')).status, 500);
  assert.equal(h.emails.length, 0);
  assert.equal(h.rows.notification_log.length, 0);
  assert.equal(h.rows.stripe_events.length, 0);
  assert.equal((await h.signedEvent('evt_retry', 'invoice.paid')).status, 200);
  assert.equal(h.emails.length, 1);
  assert.equal(h.rows.notification_log.length, 1);
});

test('invalid Stripe signature cannot trigger membership email or billing', async () => {
  const h = harness();
  const response = await h.signedEvent('evt_forged', 'invoice.paid', h.paidInvoice, false);
  assert.equal(response.status, 400);
  assert.equal(h.emails.length, 0);
  assert.equal(h.rows.billing_records.length, 0);
  assert.equal(h.rows.stripe_events.length, 0);
});

test('subscription status updates with no billing periods preserve dates from the paid invoice', async () => {
  const h = harness();
  await h.signedEvent('evt_first', 'invoice.paid');
  const originalStart = h.rows.subscriptions[0].current_period_start;
  const originalEnd = h.rows.subscriptions[0].current_period_end;
  await h.context.processSubscription({
    id: 'sub_test', status: 'active', cancel_at_period_end: false,
    metadata: { app: 'property_care_365' }
  });
  assert.equal(h.rows.subscriptions[0].current_period_start, originalStart);
  assert.equal(h.rows.subscriptions[0].current_period_end, originalEnd);
});
