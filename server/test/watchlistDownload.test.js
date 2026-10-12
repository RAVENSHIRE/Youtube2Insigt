const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const script = fs.readFileSync(path.join(__dirname,'../../extension/watchlist-download.js'),'utf8');
test('extension CSV uses scoped authenticated API, downloads once and shows failures honestly', async () => {
  let click, fail = false, downloads = 0;
  const urls = [], timers = [], notice = {};
  const anchor = {click(){downloads++;},remove(){}};
  const button = {dataset:{exportWatchlist:'J3Y_JBATcWg'},isConnected:true,textContent:'Export',
    parentElement:{querySelector:()=>notice}};
  vm.runInNewContext(script, {
    document:{addEventListener:(name,handler)=>{click=handler;},createElement:()=>anchor,body:{append(){}}},
    AppApi:{base:'http://localhost:3000',scope:'examples',fetch:async url=>{
      urls.push(url); return fail ? Response.json({error:'Keine eindeutig zugeordneten US-Symbole.'},{status:422}) : new Response('Symbol\r\nRKLB\r\n');
    }},
    URL:{createObjectURL:()=> 'blob:fixture',revokeObjectURL(){}},setTimeout:fn=>timers.push(fn)
  });
  const event = {target:{closest:()=>button},preventDefault(){}};
  await click(event);
  assert.deepEqual(urls,['http://localhost:3000/videos/J3Y_JBATcWg/watchlist.csv']);
  assert.equal(downloads,1);assert.equal(anchor.download,'signaltube-J3Y_JBATcWg-watchlist.csv');
  assert.equal(button.disabled,false);
  fail=true;await click(event);assert.equal(downloads,1);assert.match(notice.textContent,/Keine eindeutig/u);
  for(const timer of timers)timer();
});
