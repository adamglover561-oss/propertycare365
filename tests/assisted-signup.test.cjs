const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const admin = fs.readFileSync("public/admin/index.html", "utf8");
const service = fs.readFileSync("supabase/functions/assisted-signup/index.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20261111124500_assisted_membership_consent_audit.sql", "utf8");
const webhook = fs.readFileSync("supabase/functions/stripe-webhook/index.ts", "utf8");

test("tablet form collects boiler due date separately from booked appointment", () => {
  assert.match(admin, /id="assistedSignupForm"/);
  assert.match(admin, /id="asDateKind"/);
  assert.match(admin, /value="due"/);
  assert.match(admin, /value="preferred"/);
  assert.match(admin, /value="unknown"/);
  assert.match(admin, /not a confirmed appointment/i);
  assert.match(service, /next_boiler_service_due/);
  assert.match(service, /preferred_boiler_service_date/);
});

test("assisted signup uses secure recurring Stripe checkout, not manual card capture", () => {
  assert.match(service, /\.eq\("code", "home_care_core_1999"\)/);
  assert.match(service, /monthly_price_pence !== 1999/);
  assert.match(service, /stripe\.searchParams\.set\("client_reference_id", "hc_" \+ customerId \+ "__" \+ propertyId\)/);
  assert.match(webhook, /ref\.startsWith\("hc_"\)/);
  assert.match(admin, /window\.location\.replace\(target\.toString\(\)\)/);
  assert.doesNotMatch(admin, /(?:id|name)="(?:cardNumber|cvc|cvv)"/i);
  assert.doesNotMatch(service, /paymentIntents\.create|charges\.create/);
});

test("only owner may prepare checkout and customer must personally accept terms", () => {
  assert.match(service, /auth\.getUser\(token\)/);
  assert.match(service, /rpc\("is_home_care_admin"\)/);
  assert.match(service, /isAdmin !== true/);
  assert.match(service, /customerAcceptedTerms !== true/);
  assert.match(service, /normalized\(typedName\) !== normalized\(fullName\)/);
  assert.match(admin, /Customer: type your full name to accept/);
  assert.match(admin, /id="asConsent"/);
  assert.match(migration, /acceptance_channel/);
  assert.match(migration, /accepted_by_name/);
});

test("do not create entitlements or bill without a successful Stripe webhook", () => {
  assert.doesNotMatch(service, /from\("subscriptions"\)\.(?:insert|upsert)/);
  assert.doesNotMatch(service, /from\("property_cover"\)\.(?:insert|upsert)/);
  assert.match(webhook, /async function processCheckoutCompleted/);
  assert.match(webhook, /async function processInvoice/);
});
