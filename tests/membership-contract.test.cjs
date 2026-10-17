const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const app=fs.readFileSync("public/app/index.html","utf8");
const home=fs.readFileSync("public/index.html","utf8");
const partner=fs.readFileSync("public/partner/index.html","utf8");
const terms=fs.readFileSync("public/terms/index.html","utf8");
const sql=fs.readFileSync("supabase/migrations/20261012102000_property_checkout_contract_consent.sql","utf8");

function harness(answers=[true,false],rate=1999){
  const inserts=[], updates=[], navigations=[], alerts=[];
  const customer={id:"customer_1",terms_version:"1.1",terms_accepted_at:null};
  const q={
    from(table){
      if(table==="membership_checkout_consents")return {async insert(v){inserts.push(v);return {error:null}}};
      if(table==="customers")return {update(v){updates.push(v);return {eq(){return {select(){return {async single(){return {data:{...customer,...v},error:null}}}}}}}}};
      throw new Error("Unexpected table "+table);
    }
  };
  const ctx=vm.createContext({
    state:{customer}, supabase:q, planForNextProperty:()=>({monthly_price_pence:rate}),
    checkoutUrl:()=>"/test-stripe-checkout",fmtMoney:p=>"£"+(p/100).toFixed(2),
    confirm:()=>answers.shift(), alert:msg=>alerts.push(msg),
    window:{location:{assign:url=>navigations.push(url)}}
  });
  const start=app.indexOf("let checkoutInProgress=false;");
  const end=app.indexOf("async function requestMultiProperty(",start);
  assert.ok(start>=0&&end>start,"Checkout handler present");
  vm.runInContext(app.slice(start,end)+";globalThis.checkout=acceptTermsAndCheckout;",ctx);
  return {checkout:ctx.checkout,inserts,updates,navigations,alerts};
}

test("marketed contract prices disclose initial yearly commitment",()=>{
  for(const s of ["£239.88","£19.99","12-month"])assert.ok(home.includes(s),"Homepage missing "+s);
  for(const s of ["£239.88","£19.99","12-month"])assert.ok(partner.includes(s),"Partner page missing "+s);
  assert.match(terms,/Version 1\.3/);
  assert.match(terms,/After the initial 12 months/);
  assert.match(terms,/rolling/);
  assert.match(terms,/cooling-off/);
  assert.match(terms,/reasonable demonstrable net loss/);
  assert.doesNotMatch(terms,/you may stop future monthly renewals by cancelling before the next billing date/i);
});

test("new membership checkout requires property-specific accepted evidence before Stripe",async()=>{
  const h=harness([true,false],1999);
  await h.checkout({heating_fuel:"gas",id:"property_1",property_name:"Sea View"});
  assert.equal(h.inserts.length,1);
  assert.equal(h.inserts[0].property_id,"property_1");
  assert.equal(h.inserts[0].terms_version,"1.3");
  assert.equal(h.inserts[0].monthly_price_pence,1999);
  assert.equal(h.inserts[0].initial_term_months,12);
  assert.equal(h.inserts[0].early_service_requested,false);
  assert.equal(h.updates[0].terms_version,"1.3");
  assert.deepEqual(h.navigations,["/test-stripe-checkout"]);
});

test("declining new twelve-month agreement never redirects or writes consent",async()=>{
  const h=harness([false],1999);
  await h.checkout({heating_fuel:"gas",id:"property_2",address_line1:"Unit 2"});
  assert.equal(h.inserts.length,0);
  assert.equal(h.navigations.length,0);
});

test("price outside approved annual membership tiers blocks checkout",async()=>{
  const h=harness([true,false],5000);
  await h.checkout({heating_fuel:"gas",id:"property_3"});
  assert.equal(h.inserts.length,0);
  assert.equal(h.navigations.length,0);
  assert.equal(h.alerts.length,1);
});

test("append-only consent table blocks customer edits and protects tenant boundaries",()=>{
  assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
  assert.match(sql,/FOR SELECT TO authenticated/);
  assert.match(sql,/FOR INSERT TO authenticated/);
  assert.doesNotMatch(sql,/FOR UPDATE/);
  assert.doesNotMatch(sql,/FOR DELETE/);
  assert.match(sql,/p.customer_id = c.id/);
  assert.match(sql,/c.user_id = \(SELECT auth.uid\(\)\)/);
});
