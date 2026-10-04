const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('public/app/index.html','utf8');
const source=html.slice(html.indexOf('async function ensureCustomer('),html.indexOf('async function loadData('));
test('concurrent first sign-in reuses the customer created by another request',async()=>{
 const customer={id:'customer',user_id:'user'};
 const q={select(){return q},eq(){return q},insert(){return q},async maybeSingle(){return {data:null,error:null}},async single(){return ++q.calls===1?{data:null,error:{code:'23505'}}:{data:customer,error:null}},calls:0};
 const c=vm.createContext({supabase:{from:()=>q}});vm.runInContext(source,c);
 assert.equal(await c.ensureCustomer({id:'user',email:'test@example.invalid'}),customer);
 assert.equal(q.calls,2);
});
test('first sign-in surfaces database errors rather than treating them as duplicate accounts',async()=>{
 const error={code:'42501',message:'permission denied'};
 const q={select(){return q},eq(){return q},insert(){return q},async maybeSingle(){return {data:null,error:null}},async single(){return {data:null,error}}};
 const c=vm.createContext({supabase:{from:()=>q}});vm.runInContext(source,c);
 await assert.rejects(c.ensureCustomer({id:'user',email:'test@example.invalid'}),e=>e===error);
});
