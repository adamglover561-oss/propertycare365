const {test}=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const cp=require("node:child_process");

const admin=fs.readFileSync("public/admin/index.html","utf8");
const migration=fs.readFileSync("supabase/migrations/20261111132300_customer_archiving.sql","utf8");

test("tablet assisted sales rehearsal cannot invoke live checkout",()=>{
  assert.match(admin,/Assisted sign-up — safe tablet rehearsal/);
  assert.match(admin,/TEST MODE — no payments/);
  assert.match(admin,/Rehearsal passed/);
  assert.doesNotMatch(admin,/functions\.invoke\(["']assisted-signup["']/);
  assert.doesNotMatch(admin,/window\.location\.replace\(target\.toString\(\)\)/);
  assert.match(admin,/type="submit">Run safe sign-up rehearsal \(no payment\)/);
});

test("archived customer list is reversible and real counts exclude demo",()=>{
  assert.match(admin,/function isLiveCustomer\(c\)/);
  assert.match(admin,/s\.customers\.filter\(isLiveCustomer\)/);
  assert.match(admin,/archivedCustomersList/);
  assert.match(admin,/restoreCustomer/);
  assert.match(admin,/set_customer_archived/);
  assert.match(admin,/app-review@propertycare360\.co\.uk/);
});

test("archive function enforces owner-only access and active-membership protection",()=>{
  assert.match(migration,/security definer/);
  assert.match(migration,/private\.is_home_care_admin\(\)/);
  assert.match(migration,/status in \('active','trialing','past_due','incomplete','paused','unpaid'\)/);
  assert.match(migration,/grant execute on function public\.set_customer_archived\(uuid, boolean\) to authenticated/);
  assert.doesNotMatch(migration,/delete from (public\.|auth\.)/i);
});

test("embedded admin JavaScript parses as an ES module",()=>{
  const m=admin.match(/<script type="module">([\s\S]*?)<\/script>/);
  assert.ok(m,"Admin module script found");
  const check=cp.spawnSync(process.execPath,["--input-type=module","--check"],{input:m[1],encoding:"utf8"});
  assert.equal(check.status,0,check.stderr||"Syntax check failed");
});
