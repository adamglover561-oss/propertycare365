const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {stripTypeScriptTypes} = require('node:module');

const SOURCE = fs.readFileSync('supabase/functions/stripe-webhook/index.ts','utf8')
  .replace(/^import .*;$/m,'');

function fixture({termsVersion='1.7', failFirstSend=false}={}) {
  const rows = {
    customers:[{id:'customer-test',full_name:'Test Customer',email:'test-recipient@example.invalid',stripe_customer_id:'cus_test'}],
    properties:[{id:'property-test',customer_id:'customer-test',property_name:'Test Property',address_line1:'Test address',town_city:'Test town',heating_fuel:'oil'}],
    subscriptions:[{id:'sub-row-test',stripe_subscription_id:'sub_stripe_test',customer_id:'customer-test',status:'pending',current_period_start:null,current_period_end:null}],
    property_cover:[{id:'cover-test',subscription_id:'sub-row-test',property_id:'property-test',active:true,membership_started_at:null,annual_callouts_included:null}],
    membership_checkout_consents:[{id:'consent-test',customer_id:'customer-test',property_id:'property-test',terms_version:termsVersion,monthly_price_pence:1999,accepted_at:'2026-11-09T10:59:00Z'}],
    integration_secrets:[{name:'resend_transactional_api_key',secret_value:'fake-isolated-resend-token'}],
    billing_records:[],
    notification_log:[],
  };
  const sends = [];
  let failuresRemaining=failFirstSend?1:0;
  function query(table) {
    if(!(table in rows))throw Error('Unexpected table: '+table);
    let predicates=[],order=null,limit=null,operation='select',patch=null;
    const q={
      select(){return q},
      eq(key,value){predicates.push(row=>row[key]===value);return q},
      is(key,value){predicates.push(row=>row[key]===(value===null?null:value));return q},
      order(key,{ascending=true}={}){order={key,ascending};return q},
      limit(n){limit=n;return q},
      update(data){operation='update';patch=data;return q},
      insert(data){operation='insert';patch=data;return q},
      async maybeSingle(){const result=await q;return {data:result.data[0]??null,error:result.error}},
      async single(){const result=await q;return {data:result.data[0]??null,error:result.error}},
      then(resolve,reject) {
        const tableRows=rows[table];
        let selected=tableRows.filter(row=>predicates.every(predicate=>predicate(row)));
        if(order) selected.sort((a,b)=>{
          const x=String(a[order.key]??''),y=String(b[order.key]??'');
          return (order.ascending?1:-1)*x.localeCompare(y);
        });
        if(limit!==null) selected=selected.slice(0,limit);
        if(operation==='update') selected.forEach(row=>Object.assign(row,patch));
        if(operation==='insert'){
          const inserted=Array.isArray(patch)?patch:[patch];
          selected=inserted.map(row=>({id:'id-'+table+'-'+(tableRows.length+1),...row}));
          tableRows.push(...selected);
        }
        return Promise.resolve({data:selected,error:null}).then(resolve,reject);
      }
    };
    return q;
  }
  const env={SUPABASE_URL:'https://example.invalid',SUPABASE_SERVICE_ROLE_KEY:'fake-supabase-test-key'};
  const context=vm.createContext({
    createClient:()=>({from:query}),
    Deno:{env:{get:key=>env[key]},serve:()=>{}},
    fetch:async (url,options)=>{
      assert.equal(url,'https://api.resend.com/emails','No other network access allowed');
      assert.equal(options.method,'POST');
      assert.equal(options.headers.Authorization,'Bearer fake-isolated-resend-token');
      sends.push({url,options,payload:JSON.parse(options.body)});
      if(failuresRemaining-->0) return {ok:false,status:503,text:async()=>''};
      return {ok:true,status:200,json:async()=>({id:'fake-email-id'})};
    },
    console,TextEncoder,Response,Date,
  });
  vm.runInContext(stripTypeScriptTypes(SOURCE),context);
  const invoice={
    id:'in_first_test',customer:'cus_test',billing_reason:'subscription_create',
    parent:{subscription_details:{subscription:'sub_stripe_test'}},
    status_transitions:{paid_at:1794222040},created:1794222040,
    amount_paid:1999,currency:'gbp',
    lines:{data:[{period:{start:1794222040,end:1796814040},parent:{subscription_item_details:{subscription:'sub_stripe_test'}}}]},
  };
  return {rows,sends,invoice,processInvoice:context.processInvoice};
}

test('first paid v1.7 Stripe invoice automatically triggers exactly one welcome email and five call-outs',async()=>{
  const f=fixture();
  await f.processInvoice(f.invoice,true);
  assert.equal(f.sends.length,1,'First successful subscription payment must send an email');
  assert.equal(f.rows.billing_records.length,1);
  assert.equal(f.rows.billing_records[0].status,'paid');
  assert.equal(f.rows.subscriptions[0].status,'active');
  assert.equal(f.rows.subscriptions[0].current_period_start,new Date(1794222040*1000).toISOString());
  assert.equal(f.rows.subscriptions[0].current_period_end,new Date(1796814040*1000).toISOString());
  assert.equal(f.rows.property_cover[0].annual_callouts_included,5);
  assert.equal(f.rows.property_cover[0].membership_started_at,new Date(1794222040*1000).toISOString());
  assert.equal(f.rows.notification_log.length,1);
  assert.equal(f.rows.notification_log[0].notification_type,'membership_confirmation_sent');
  const sent=f.sends[0];
  assert.equal(sent.options.headers['Idempotency-Key'],'pc360-welcome-in_first_test');
  assert.equal(sent.payload.to[0],'test-recipient@example.invalid');
  assert.equal(sent.payload.from,'Property Care 360 <membership@propertycare360.co.uk>');
  assert.match(sent.payload.subject,/membership is active/);
  assert.match(sent.payload.text,/Monthly payment: £19\.99/);
  assert.match(sent.payload.text,/five priority plumbing\/heating call-out attendances/);
  assert.match(sent.payload.text,/annual suitable gas\/LPG\/oil boiler service/);
  assert.match(sent.payload.text,/Membership Terms version 1\.7/);
});

test('Stripe duplicate delivery and future monthly renewal never resend the welcome',async()=>{
  const f=fixture();
  await f.processInvoice(f.invoice,true);
  await f.processInvoice(f.invoice,true);
  await f.processInvoice({...f.invoice,id:'in_renewal_test',billing_reason:'subscription_cycle',created:1796814040},true);
  assert.equal(f.sends.length,1);
  assert.equal(f.rows.notification_log.length,1);
  assert.equal(f.rows.billing_records.length,2,'Only one row per invoice');
  assert.equal(f.rows.property_cover[0].annual_callouts_included,5,'Renewal must not reset contract-year allowance');
});

test('failed Resend send raises an error, leaves no false sent log, and succeeds on retry',async()=>{
  const f=fixture({failFirstSend:true});
  await assert.rejects(f.processInvoice(f.invoice,true),/Membership confirmation email failed: HTTP 503/);
  assert.equal(f.rows.notification_log.length,0);
  await f.processInvoice(f.invoice,true);
  assert.equal(f.sends.length,2);
  assert.equal(f.rows.notification_log.length,1);
  assert.equal(f.rows.billing_records.length,1);
});

test('historical membership terms do not receive incorrect v1.7 confirmation',async()=>{
  const f=fixture({termsVersion:'1.6'});
  await f.processInvoice(f.invoice,true);
  assert.equal(f.sends.length,0);
  assert.equal(f.rows.notification_log.length,0);
  assert.equal(f.rows.property_cover[0].annual_callouts_included,null);
});
