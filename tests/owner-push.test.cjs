const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');

function setup({foreign=false, urgent=true, subscribers=false, emailFails=false}={}) {
  let handler; const pushes=[],emails=[],logKeys=new Set();
  const admin={
    auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user'}:null}})},
    from(table){
      let filter={};
      const q={
        select(){return q},
        eq(k,v){filter[k]=v;return q},
        maybeSingle:async()=>{
          let data=null;
          if(table==='notification_log') data=logKeys.has(filter.notification_key)?{notification_key:filter.notification_key}:null;
          if(table==='customers') data=filter.user_id?{id:'customer'}:{id:'customer',full_name:'Test Customer',email:'customer@example.com',phone:'07123456789'};
          if(table==='jobs') data={id:'job',customer_id:foreign?'other':'customer',property_id:'property',booking_source:'customer',title:urgent?'URGENT CALL-OUT — Leak':'Breakdown requested',description:'Emergency call-out\nContact phone: 07000000000',created_at:'2026-11-09T13:00:00Z'};
          if(table==='properties') data={id:'property',address_line1:'1 Test Street',town_city:'St Austell',postcode:'PL25 1AA'};
          if(table==='integration_secrets') data={secret_value:'fake-test-key'};
          return {data,error:null};
        },
        insert:async payload=>{
          if(table==='notification_log'){
            if(logKeys.has(payload.notification_key))return {error:{code:'23505'}};
            logKeys.add(payload.notification_key);
          }
          return {error:null};
        },
        then(resolve){return Promise.resolve({data:table==='owner_push_subscriptions'&&subscribers?[{id:'device',endpoint:'test',p256dh:'test',auth:'test'}]:[],error:null}).then(resolve)}
      };return q;
    }
  };
  const source=fs.readFileSync('supabase/functions/owner-push/index.ts','utf8').replace(/^import .*;\s*$/gm,'');
  vm.runInNewContext(stripTypeScriptTypes(source),{
    Deno:{env:{get:()=> 'test'},serve:fn=>handler=fn},
    createClient:()=>admin,
    webpush:{setVapidDetails(){},sendNotification:async(_sub,payload)=>pushes.push(JSON.parse(payload))},
    fetch:async(_url,options)=>{emails.push(JSON.parse(options.body));return {ok:!emailFails,status:emailFails?403:200}},
    Response,Headers,Request,console,crypto,setTimeout
  });
  return {call:handler,pushes,emails,logKeys};
}
function request(event='breakdown_requested',id='job',token='valid') {
  return new Request('https://test',{method:'POST',headers:{Authorization:'Bearer '+token},body:JSON.stringify({action:'customer-event',event,id})});
}
test('browser preflight succeeds without authentication',async()=>{
  const {call}=setup();const r=await call(new Request('https://test',{method:'OPTIONS'}));
  assert.equal(r.status,204);assert.equal(r.headers.get('Access-Control-Allow-Origin'),'*');
});
test('unauthenticated request is rejected without sending email',async()=>{
  const {call,emails}=setup();const r=await call(request('breakdown_requested','job','bad'));
  assert.equal(r.status,401);assert.equal(emails.length,0);
});
test('foreign customer job cannot send alerts',async()=>{
  const {call,emails,pushes}=setup({foreign:true});const r=await call(request());
  assert.equal(r.status,403);assert.equal(emails.length,0);assert.equal(pushes.length,0);
});
test('urgent request sends email even when there are no push subscribers',async()=>{
  const {call,emails,pushes,logKeys}=setup();
  const r=await call(request());
  assert.equal(r.status,200);const data=await r.json();assert.equal(data.emailSent,true);assert.equal(data.sent,0);
  assert.equal(emails.length,1);assert.match(emails[0].subject,/URGENT CALL-OUT/);
  assert.match(emails[0].text,/1 Test Street/);assert.match(emails[0].text,/07000000000/);
  assert.ok(logKeys.has('owner-email:breakdown_requested:job'));assert.equal(pushes.length,0);
});
test('replay sends exactly one owner email even when push key already exists',async()=>{
  const {call,emails,logKeys}=setup({subscribers:true});
  logKeys.add('owner-push:breakdown_requested:job');
  const first=await call(request());assert.equal(first.status,200);assert.equal((await first.json()).emailSent,true);
  const second=await call(request());assert.equal(second.status,200);assert.equal((await second.json()).emailSent,false);
  assert.equal(emails.length,1);
});
test('normal breakdown and booking requests are emailed',async()=>{
  for(const event of ['breakdown_requested','booking_requested']){
    const {call,emails}=setup({urgent:false});
    const r=await call(request(event));assert.equal(r.status,200);assert.equal(emails.length,1);
    assert.match(emails[0].subject,/REQUEST/);
  }
});
test('email send failures do not falsely mark an owner email delivered',async()=>{
  const {call,emails,logKeys}=setup({emailFails:true});
  const r=await call(request());assert.equal(r.status,500);
  assert.equal(emails.length,1);
  assert.equal(logKeys.has('owner-email:breakdown_requested:job'),false);
});
