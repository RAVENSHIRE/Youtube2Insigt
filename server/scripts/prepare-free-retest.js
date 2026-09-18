// Local operator CLI only. Never import from an HTTP route.
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { randomUUID } = require('node:crypto');
const { backupAccounts } = require('./backup-accounts');
const { hiddenCount, hideExisting } = require('../accounts/localLibraryVisibility');

function localOnly(env, confirmed) {
  if (!confirmed || env.NODE_ENV === 'production') throw Error('LOCAL_DEVELOPMENT_ONLY');
  const url = new URL(env.PUBLIC_BASE_URL || 'http://localhost:3000');
  if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !['http:','https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('LOCAL_DEVELOPMENT_ONLY');
}
function inspect(db, email, videoId, now) {
  if (db.prepare('PRAGMA user_version').get().user_version !== 1) throw Error('UNSUPPORTED_ACCOUNT_SCHEMA');
  const user = db.prepare('SELECT id,verified_at FROM users WHERE email=?').get(email);
  if (!user?.verified_at) throw Error('VERIFIED_ACCOUNT_REQUIRED');
  if (db.prepare("SELECT 1 FROM subscriptions WHERE user_id=? AND status='active' AND period_end>?").get(user.id,now)) throw Error('FREE_ACCOUNT_REQUIRED');
  if (db.prepare('SELECT 1 FROM library WHERE user_id=? AND video_id=?').get(user.id,videoId)) throw Error('CHOOSE_A_DIFFERENT_VIDEO');
  if (db.prepare("SELECT 1 FROM jobs WHERE user_id=? AND state='reserved'").get(user.id)) throw Error('RESERVED_JOB_PRESENT');
  const grants = db.prepare(`SELECT g.amount-(SELECT count(*) FROM jobs j WHERE j.grant_id=g.id AND j.state='complete') AS available
    FROM credit_grants g WHERE g.user_id=? AND g.kind='free' AND g.starts_at<=? AND g.expires_at>?`).all(user.id,now,now);
  const available = grants.reduce((sum,g)=>sum+Math.max(0,g.available),0);
  if (available>1) throw Error('EXPECTED_AT_MOST_ONE_FREE_CREDIT');
  const grantId = `dev-retest:${user.id}:${videoId}`;
  if (!available && db.prepare('SELECT 1 FROM credit_grants WHERE id=?').get(grantId)) throw Error('RETEST_GRANT_ALREADY_USED_OR_EXPIRED');
  return {userId:user.id,grantId,available,reports:db.prepare('SELECT count(*) AS n FROM library WHERE user_id=?').get(user.id).n,hidden:hiddenCount(db,user.id)};
}
async function prepareRetest({ database, email, videoId, apply=false, hideExistingReports=false, localDevelopment=false, env=process.env, now=Date.now() }) {
  localOnly(env,localDevelopment);
  if (!path.isAbsolute(database) || !fs.statSync(database).isFile()) throw Error('EXISTING_ABSOLUTE_DATABASE_REQUIRED');
  if (!/^[A-Za-z0-9_-]{11}$/u.test(videoId || '')) throw Error('INVALID_VIDEO_ID');
  email=String(email || '').trim().toLowerCase();
  const readonly=new DatabaseSync(database,{readOnly:true});let state;
  try { state=inspect(readonly,email,videoId,now); } finally { readonly.close(); }
  const toHide=hideExistingReports ? state.reports-state.hidden : 0;
  const result={status:state.available && !toHide ? 'already_ready' : 'dry_run',videoId,credits_before:state.available,credits_after:state.available,existing_reports:state.reports,hidden_reports:state.hidden,reports_to_hide:toHide,writes_performed:false};
  if (!apply || (state.available && !toHide)) return result;
  const destination=path.join(path.dirname(database),'recovery',`before-free-retest-${now}-${randomUUID()}.sqlite`);
  await backupAccounts(database,destination);
  const db=new DatabaseSync(database);
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    const current=inspect(db,email,videoId,now);
    if (!current.available) db.prepare('INSERT INTO credit_grants VALUES (?,?,?,?,?,?)').run(current.grantId,current.userId,'free',1,now,now+86400000);
    const newlyHidden=hideExistingReports ? hideExisting(db,current.userId,now) : 0;
    db.exec('COMMIT');
    return {...result,status:'ready',credits_after:1,hidden_reports:current.hidden+newlyHidden,reports_to_hide:0,writes_performed:!current.available || newlyHidden>0,backup:destination,...(!current.available ? {expires_in_hours:24} : {})};
  } catch(error) { try {db.exec('ROLLBACK');} catch {} throw error; }
  finally {db.close();}
}
async function restoreLibrary({ database, email, apply=false, localDevelopment=false, env=process.env }) {
  localOnly(env,localDevelopment);
  if (!path.isAbsolute(database) || !fs.statSync(database).isFile()) throw Error('EXISTING_ABSOLUTE_DATABASE_REQUIRED');
  const read=new DatabaseSync(database,{readOnly:true});let user,count;
  try {
    if(read.prepare('PRAGMA user_version').get().user_version!==1)throw Error('UNSUPPORTED_ACCOUNT_SCHEMA');
    user=read.prepare('SELECT id FROM users WHERE email=?').get(String(email || '').trim().toLowerCase());
    if(!user)throw Error('ACCOUNT_NOT_FOUND');
    count=hiddenCount(read,user.id);
  }finally{read.close();}
  if(!apply || !count)return {status:count?'dry_run':'already_visible',reports_to_restore:count,writes_performed:false};
  const destination=path.join(path.dirname(database),'recovery',`before-library-restore-${Date.now()}-${randomUUID()}.sqlite`);
  await backupAccounts(database,destination);
  const db=new DatabaseSync(database);
  try {
    db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE;');
    const restored=db.prepare('DELETE FROM local_hidden_library WHERE user_id=?').run(user.id).changes;
    db.exec('COMMIT');
    return {status:'restored',restored_reports:restored,writes_performed:restored>0,credits_changed:false,backup:destination};
  }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
  finally{db.close();}
}
if (require.main === module) {
  (async()=>{
    require('dotenv').config({path:path.join(__dirname,'../../.env'),quiet:true});
    const args=process.argv.slice(2);
    if (args.some(arg=>!['--apply','--local-development','--hide-existing','--restore-library'].includes(arg))) throw Error('UNKNOWN_ARGUMENT');
    if(args.includes('--hide-existing') && args.includes('--restore-library'))throw Error('CONFLICTING_ARGUMENTS');
    localOnly(process.env,args.includes('--local-development'));
    const rl=require('node:readline/promises').createInterface({input:process.stdin,output:process.stdout});
    let email,videoUrl;
    try { email=await rl.question('E-Mail deines bestätigten lokalen Free-Testkontos: ');if(!args.includes('--restore-library'))videoUrl=await rl.question('Andere YouTube-Video-URL: '); } finally {rl.close();}
    const database=process.env.ACCOUNT_DB_PATH || path.resolve(__dirname,'../runtime/accounts.sqlite');
    if(args.includes('--restore-library')) {
      console.log(JSON.stringify(await restoreLibrary({database,email,apply:args.includes('--apply'),localDevelopment:true}),null,2));
      return;
    }
    const video=new URL(videoUrl.trim());
    if(video.protocol!=='https:' || !['youtube.com','www.youtube.com','youtu.be'].includes(video.hostname) || video.username || video.password)throw Error('INVALID_VIDEO_URL');
    const videoId=video.hostname==='youtu.be' ? video.pathname.slice(1) : video.searchParams.get('v');
    console.log(JSON.stringify(await prepareRetest({database,email,videoId,apply:args.includes('--apply'),hideExistingReports:args.includes('--hide-existing'),localDevelopment:true}),null,2));
  })().catch(error=>{console.error(JSON.stringify({status:'blocked',code:/^[A-Z_]+$/u.test(error.message)?error.message:'RETEST_PREPARATION_FAILED'}));process.exitCode=1;});
}
module.exports={prepareRetest,restoreLibrary,localOnly};
