import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as startup from '../server/xhs-startup.mjs';

const healthy=()=>Response.json({success:true,data:{service:'xiaohongshu-mcp',status:'healthy'}});
test('reuse healthy connector without launching another process',async()=>{
  const result=await startup.ensureXhs({fetch:async()=>healthy(),launch:()=>{throw Error('duplicate launch');}});
  assert.equal(result.status,'reused');
});
test('start disconnected connector and wait for health before reporting success',async()=>{
  let calls=0,launches=0;const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};
  const result=await startup.ensureXhs({fetch:async()=>{if(++calls===1)throw Error('offline');return healthy();},launch:()=>{launches++;return child;},sleep:async()=>{}});
  assert.equal(result.status,'started');assert.equal(launches,1);assert.ok(calls>=2);
});
test('occupied port is never treated as our connector',async()=>{
  await assert.rejects(startup.ensureXhs({fetch:async()=>Response.json({status:'ok'}),launch:()=>{throw Error('must not launch');}}),/18060.*其他服务/);
});
test('startup errors produce actionable failure',async()=>{
  const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{};
  await assert.rejects(startup.ensureXhs({fetch:async()=>{throw Error('offline');},launch:()=>{queueMicrotask(()=>child.emit('error',Error('ENOENT')));return child;},sleep:async()=>{},attempts:2}),/启动失败/);
});
test('health timeout terminates only the child started by this call',async()=>{
  let killed=0;const child=new EventEmitter();child.unref=()=>{};child.kill=()=>{killed++;};
  await assert.rejects(startup.ensureXhs({fetch:async()=>{throw Error('offline');},launch:()=>child,sleep:async()=>{},attempts:2}),/未就绪/);
  assert.equal(killed,1);
});
