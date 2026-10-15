import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/http.mjs';

test('configuration API never leaks keys into state, supports restart persistence and rejects cross-origin updates', async () => {
 const dir = mkdtempSync(join(tmpdir(),'red-config-http-'));
 const options = {enableServices:true,serviceOptions:{assetsDir:join(dir,'assets'),configPath:join(dir,'config.json'),env:{}}};
 let app = createApp(options);
 const start = async () => { await new Promise(r=>app.server.listen(0,'127.0.0.1',r)); return `http://127.0.0.1:${app.server.address().port}/api`; };
 try {
  let url = await start();
  const patch = await fetch(url+'/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'api',llmBaseUrl:'https://example.org/v1',llmApiKey:'do-not-return-me'})});
  assert.equal(patch.status,200); assert.equal((await patch.json()).data.llmApiKeySet,true);
  assert.equal((await (await fetch(url+'/state')).text()).includes('do-not-return-me'),false);
  assert.equal((await (await fetch(url+'/config')).text()).includes('do-not-return-me'),false);
  assert.equal((await fetch(url+'/config',{method:'PATCH',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'})).status,403);
  await app.close(); app=createApp(options); url=await start();
  const data=(await (await fetch(url+'/config')).json()).data;
  assert.equal(data.provider,'api'); assert.equal(data.llmApiKeySet,true);
  app.store.add('jobs',{status:'unknown',taskId:'unfinished-provider-task',abandonedAt:new Date().toISOString()});
  assert.equal((await fetch(url+'/config',{method:'PATCH',headers:{'Content-Type':'application/json'},body:'{"provider":"codex"}'})).status,400);
 } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
