const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {webcrypto}=require('node:crypto');
function setup(){
  const tables={properties:[{id:'prop',customer_id:'customer',next_boiler_service_due:null,next_plumbing_check_due:null}],customers:[{id:'customer',stripe_customer_id:'cus_original'}],subscriptions:[],property_cover:[],plans:[{id:'plan',code:'home_care_first_property',monthly_price_pence:4900}],billing_records:[]};
  const client={from(table){
    let action='select',patch,filters=[],orFilters;
    const q={
      select(){return q;},eq(k,v){filters.push(r=>r[k]===v);return q;},
      is(k,v){filters.push(r=>r[k]===v);return q;},limit(){return q;},
      or(s){orFilters=s.split(',').map(s=>{const [k,op,...v]=s.split('.');return r=>r[k]===v.join('.');});return q;},
      update(v){action='update';patch=v;return q;},insert(v){action='insert';patch=v;return q;},
      upsert(v){action='upsert';patch=v;return q;},
      async maybeSingle(){const r=await q;return {...r,data:r.data?.[0]??null};},
      async single(){return q.maybeSingle();},
      then(resolve,reject){
        let rows=tables[table]??=[];
        let found=rows.filter(r=>filters.every(f=>f(r))&&(!orFilters||orFilters.some(f=>f(r))));
        if(action==='update')found.forEach(r=>Object.assign(r,patch));
        if(action==='insert'||action==='upsert'){
          const old=action==='upsert'?rows.find(r=>patch.stripe_subscription_id?r.stripe_subscription_id===patch.stripe_subscription_id:r.subscription_id===patch.subscription_id&&r.property_id===patch.property_id):null;
          if(old){Object.assign(old,patch);found=[old];}
          else{const row={id:table+'_'+rows.length,...patch};rows.push(row);found=[row];tables[table]=rows;}
        }
        return Promise.resolve({data:found,error:null}).then(resolve,reject);
      }
    };return q;
  }};
  const source=fs.readFileSync('supabase/functions/stripe-webhook/index.ts','utf8').replace(/^import .*;$/m,'');
  const context=vm.createContext({createClient:()=>client,Deno:{env:{get:k=>k==='SUPABASE_SERVICE_ROLE_KEY'?'local-test-key':k==='SUPABASE_URL'?'https://example.invalid':undefined},serve:()=>{}},console,crypto:webcrypto,TextEncoder,Response,Date});
  vm.runInContext(stripTypeScriptTypes(source),context);
  return {context,tables};
}
test('checkout records one invoice and keeps canonical customer across properties',async()=>{
  const {context:c,tables:t}=setup();
  const s={id:'cs_1',client_reference_id:'hc_customer__prop',customer:'cus_new',subscription:'sub_1',invoice:'in_1',payment_status:'paid',amount_total:4900,currency:'gbp'};
  await c.processCheckoutCompleted(s);
  assert.equal(t.customers[0].stripe_customer_id,'cus_original');
  assert.equal(t.property_cover[0].monthly_price_pence,4900);
  await c.processInvoice({id:'in_1',customer:'cus_new',parent:{subscription_details:{subscription:'sub_1'}},amount_paid:4900,currency:'gbp'},true);
  assert.equal(t.billing_records.length,1);
  assert.equal(t.billing_records[0].stripe_invoice_id,'in_1');
  assert.equal(t.billing_records[0].property_id,'prop');
});
test('asynchronous payment updates pending signup instead of duplicating billing',async()=>{
  const {context:c,tables:t}=setup();
  const s={id:'cs_2',client_reference_id:'hc_customer__prop',customer:'cus_new',subscription:'sub_2',invoice:'in_2',payment_status:'unpaid',amount_total:4900};
  await c.processCheckoutCompleted(s);
  assert.equal(t.subscriptions[0].status,'pending');
  await c.processCheckoutCompleted({...s,payment_status:'paid'});
  assert.equal(t.subscriptions[0].status,'active');
  assert.equal(t.billing_records.length,1);
  assert.equal(t.billing_records[0].status,'paid');
});
test('early subscription invoice is retried until checkout exists',async()=>{
  const {context:c}=setup();
  await assert.rejects(c.processInvoice({id:'in_early',customer:'cus_new',parent:{subscription_details:{subscription:'sub_early',metadata:{app:'property_care_365'}}}},true),/retry invoice/);
});
test('failed renewal reaches original property through current Stripe invoice format',async()=>{
  const {context:c,tables:t}=setup();
  t.subscriptions.push({id:'s_old',customer_id:'customer',stripe_subscription_id:'sub_old',status:'active'});
  t.property_cover.push({subscription_id:'s_old',property_id:'prop',active:true});
  await c.processInvoice({id:'in_failed',customer:'cus_older',parent:{subscription_details:{subscription:'sub_old'}},amount_due:4400,currency:'gbp'},false);
  assert.equal(t.subscriptions[0].status,'past_due');
  assert.equal(t.billing_records[0].customer_id,'customer');
  assert.equal(t.billing_records[0].property_id,'prop');
  assert.equal(t.billing_records[0].amount_pence,4400);
});
test('signature verification accepts valid HMAC and rejects tampering and expiry',async()=>{
  const {context:c}=setup();const body='{"id":"evt_local_test"}',ts=Math.floor(Date.now()/1000);
  const key=await webcrypto.subtle.importKey('raw',new TextEncoder().encode('test-secret'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=Buffer.from(await webcrypto.subtle.sign('HMAC',key,new TextEncoder().encode(ts+'.'+body))).toString('hex');
  assert.equal(await c.verifyStripeSignature(body,'t='+ts+',v1='+sig,'test-secret'),true);
  assert.equal(await c.verifyStripeSignature(body+'x','t='+ts+',v1='+sig,'test-secret'),false);
  assert.equal(await c.verifyStripeSignature(body,'t='+(ts-600)+',v1='+sig,'test-secret'),false);
});
