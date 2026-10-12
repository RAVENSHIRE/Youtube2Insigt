const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {AccountStore}=require('../accounts/store');
const {prepareRetest,restoreLibrary}=require('../scripts/prepare-free-retest');
function fixture(t){
 const temporary=path.join(__dirname,'.tmp');fs.mkdirSync(temporary,{recursive:true});
 const root=fs.mkdtempSync(path.join(temporary,'free-retest-')), database=path.join(root,'accounts.sqlite');
 const store=new AccountStore(database),email='test@example.test';
 const user=store.createUser(email,'synthetic');store.emailToken(user.id,'verify');store.consumeEmailToken('verify','verify');
 const report={analysis_version:8,video:{id:'RN_C7a66OSA'},companies:[{ticker:'RKLB',thesis:'Original stays intact'}]};
 const job=store.reserve(user.id,report.video.id,8);store.complete(user.id,job.id,report);
 t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
 return {store,user,database,email,report,input:{database,email,videoId:'J3Y_JBATcWg',env:{PUBLIC_BASE_URL:'http://localhost:3000'},localDevelopment:true}};
}
test('local retest takes a verified recovery backup, grants one credit idempotently and preserves old reports/jobs',async t=>{
 const f=fixture(t),before=f.store.ownReport(f.user.id,'RN_C7a66OSA');
 const preview=await prepareRetest(f.input);assert.equal(preview.status,'dry_run');assert.equal(f.store.account(f.user.id).analyses_available,0);
 const result=await prepareRetest({...f.input,apply:true});assert.equal(result.credits_after,1);assert.equal(f.store.account(f.user.id).plan,'free');
 const backup=new DatabaseSync(result.backup,{readOnly:true});try{
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(backup.prepare('SELECT count(*) AS n FROM credit_grants').get().n,1);
 }finally{backup.close();}
 assert.equal((await prepareRetest({...f.input,apply:true})).status,'already_ready');
 const jobsBefore=f.store.db.prepare('SELECT count(*) AS n FROM jobs').get().n;
 const newJob=f.store.reserve(f.user.id,'J3Y_JBATcWg',8);
 f.store.complete(f.user.id,newJob.id,{...f.report,video:{id:'J3Y_JBATcWg'}});
 assert.equal(f.store.account(f.user.id).analyses_available,0);
 assert.equal(f.store.library(f.user.id).length,2);
 assert.deepEqual(f.store.ownReport(f.user.id,'RN_C7a66OSA'),before);
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM jobs').get().n,jobsBefore+1);
 await assert.rejects(prepareRetest({...f.input,apply:true}),/CHOOSE_A_DIFFERENT_VIDEO/u);
});
test('failed second video releases the test credit without deleting either job history or the old report',async t=>{
 const f=fixture(t);await prepareRetest({...f.input,apply:true});
 const job=f.store.reserve(f.user.id,'J3Y_JBATcWg',8);
 await assert.rejects(prepareRetest({...f.input,apply:true}),/RESERVED_JOB_PRESENT/u);
 f.store.fail(f.user.id,job.id,'MODEL_UNAVAILABLE');
 assert.equal(f.store.account(f.user.id).analyses_available,1);
 assert.equal((await prepareRetest({...f.input,apply:true})).status,'already_ready');
 assert.equal(f.store.library(f.user.id).length,1);
 assert.equal(f.store.job(f.user.id,job.id).state,'failed');
});
test('credit maintenance rejects production/public environments and unverified accounts',async t=>{
 const f=fixture(t);
 for(const change of [{localDevelopment:false},{env:{NODE_ENV:'production'}},{env:{PUBLIC_BASE_URL:'https://example.com'}}]){
  await assert.rejects(prepareRetest({...f.input,...change,apply:true}),/LOCAL_DEVELOPMENT_ONLY/u);
 }
 f.store.createUser('pending@example.test','synthetic');
 await assert.rejects(prepareRetest({...f.input,email:'pending@example.test',apply:true}),/VERIFIED_ACCOUNT_REQUIRED/u);
 assert.equal(f.store.account(f.user.id).analyses_available,0);
});
test('concurrent local preparations cannot give a Free account more than one available test credit',async t=>{
 const f=fixture(t);
 await Promise.all([prepareRetest({...f.input,apply:true}),prepareRetest({...f.input,apply:true,videoId:'QzRxievcmug'})]);
 assert.equal(f.store.account(f.user.id).analyses_available,1);
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM credit_grants').get().n,2);
});

test('local reset hides old library entries with a backup, preserves original reports and restores stable sequences',async t=>{
 const f=fixture(t),old=f.store.ownReport(f.user.id,'RN_C7a66OSA');
 const other=f.store.createUser('other@example.test','synthetic');
 f.store.emailToken(other.id,'other');f.store.consumeEmailToken('other','verify');
 const otherJob=f.store.reserve(other.id,f.report.video.id,8);f.store.complete(other.id,otherJob.id,f.report);
 // Credit was already released: hiding must not add another credit.
 await prepareRetest({...f.input,apply:true});
 const preview=await prepareRetest({...f.input,hideExistingReports:true});
 assert.equal(preview.reports_to_hide,1);assert.equal(f.store.library(f.user.id).length,1);
 const result=await prepareRetest({...f.input,apply:true,hideExistingReports:true});
 assert.equal(result.hidden_reports,1);assert.equal(result.credits_after,1);
 assert.equal(f.store.library(f.user.id).length,0);assert.equal(f.store.library(other.id).length,1);
 assert.equal(f.store.db.prepare('SELECT count(*) AS n FROM credit_grants WHERE user_id=?').get(f.user.id).n,2);
 assert.deepEqual(f.store.ownReport(f.user.id,'RN_C7a66OSA'),old);
 const backup=new DatabaseSync(result.backup,{readOnly:true});try{
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
  assert.equal(backup.prepare('SELECT count(*) AS n FROM library WHERE user_id=?').get(f.user.id).n,1);
 }finally{backup.close();}
 assert.equal((await prepareRetest({...f.input,apply:true,hideExistingReports:true})).writes_performed,false);
 assert.equal(f.store.reserve(f.user.id,'RN_C7a66OSA',8).cached,true);
 const failed=f.store.reserve(f.user.id,'J3Y_JBATcWg',8);f.store.fail(f.user.id,failed.id,'EVIDENCE_UNSUPPORTED');
 assert.equal(f.store.library(f.user.id).length,0);assert.equal(f.store.account(f.user.id).analyses_available,1);
 const job=f.store.reserve(f.user.id,'J3Y_JBATcWg',8);f.store.complete(f.user.id,job.id,{...f.report,video:{id:'J3Y_JBATcWg'}});
 assert.equal(f.store.library(f.user.id).length,1);assert.equal(f.store.library(f.user.id)[0].personal_sequence,2);
 assert.equal(f.store.account(f.user.id).analyses_available,0);
 const restoreInput={database:f.database,email:f.email,localDevelopment:true,env:f.input.env};
 assert.equal((await restoreLibrary(restoreInput)).reports_to_restore,1);
 assert.equal(f.store.library(f.user.id).length,1);
 const restored=await restoreLibrary({...restoreInput,apply:true});
 assert.equal(restored.restored_reports,1);assert.equal(restored.credits_changed,false);
 assert.deepEqual(f.store.library(f.user.id).map(r=>r.personal_sequence),[1,2]);
 assert.deepEqual(f.store.ownReport(f.user.id,'RN_C7a66OSA'),old);
 assert.equal(f.store.account(f.user.id).analyses_available,0);
 assert.equal((await restoreLibrary({...restoreInput,apply:true})).status,'already_visible');
});
test('hiding and restoring are local-only and never affect another account',async t=>{
 const f=fixture(t);
 for(const operation of [prepareRetest,restoreLibrary])for(const change of [{localDevelopment:false},{env:{NODE_ENV:'production'}},{env:{PUBLIC_BASE_URL:'https://public.example'}}]){
  await assert.rejects(operation({...f.input,...change,hideExistingReports:true,apply:true}),/LOCAL_DEVELOPMENT_ONLY/u);
 }
 assert.equal(f.store.library(f.user.id).length,1);
 assert.equal(f.store.db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_hidden_library'").get(),undefined);
});
