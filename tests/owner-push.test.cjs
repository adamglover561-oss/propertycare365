const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function setup({foreign=false,urgent=true}={}) {
  let handler; const sent=[];
  const admin={auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user'}:null}})},from(table){
    const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:table==='customers'?{id:'customer'}:table==='jobs'?{id:'job',customer_id:foreign?'other':'customer',booking_source:'customer',title:urgent?'URGENT CALL-OUT — Leak':'Breakdown request'}:{secret_value:'private-test'}}),insert:async()=>({error:null}),then(resolve){return Promise.resolve({data:[{id:'device',endpoint:'test',p256dh:'test',auth:'test'}]}).then(resolve)}};return q;
  }};
  let source=fs.readFileSync('supabase/functions/owner-push/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},createClient:()=>admin,webpush:{setVapidDetails(){},sendNotification:async(_sub,payload)=>sent.push(JSON.parse(payload))},Response,Headers,console,crypto});
  return {call:handler,sent};
}
test('browser preflight succeeds without authentication',async()=>{const {call}=setup();const r=await call(new Request('https://test',{method:'OPTIONS'}));assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.match(r.headers.get('Access-Control-Allow-Headers'),/authorization/)});
test('unauthenticated requests remain rejected with CORS headers',async()=>{const {call,sent}=setup();const r=await call(new Request('https://test',{method:'POST',body:JSON.stringify({action:'customer-event'})}));assert.equal(r.status,401);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');assert.equal(sent.length,0)});
for(const foreign of [false,true]) test(foreign?'foreign jobs cannot send alerts':'urgent requests send a distinct alert',async()=>{const {call,sent}=setup({foreign});const r=await call(new Request('https://test',{method:'POST',headers:{Authorization:'Bearer valid'},body:JSON.stringify({action:'customer-event',event:'breakdown_requested',id:'job'})}));assert.equal(r.status,foreign?403:200);assert.equal(sent.length,foreign?0:1);if(!foreign)assert.match(sent[0].title,/URGENT CALL-OUT/)});
