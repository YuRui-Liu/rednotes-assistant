import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server/http.mjs';

function queue(store, account, time) {
  const product = store.createProduct({name:'杯',facts:'300ml',images:['https://example.org/cup.png'],confirmed:true});
  account ||= store.createAccount({name:'账号'});
  const batch = store.createBatch({accountId:account.id,productId:product.id});
  const [topic] = store.addTopics(batch.id,{titles:['杯']});
  store.confirmTopic(topic.id);
  const [note] = store.generate(batch.id);
  store.approveNote(note.id);
  const job = store.createSchedule({noteId:note.id,accountId:account.id,mode:'normal',scheduledAt:time});
  store.approveSchedule(job.id);
  return {job,account};
}

test('timeout retains execution lock until underlying publisher settles', async () => {
  let settle, calls=0;
  const app=createApp({publishTimeoutMs:10,publish:()=>{calls++;return new Promise(r=>{settle=r;});}});
  const now=Date.now();
  const first=queue(app.store,null,now+1000);
  queue(app.store,null,now+1000);
  const execution=app.tick(now+1001);
  try {
    await delay(30);
    assert.equal(app.store.get('schedules',first.job.id).status,'unknown');
    await app.tick(now+1002);
    assert.equal(calls,1);
    settle({id:'late-real-receipt'});
    await execution;
    assert.equal(app.store.get('schedules',first.job.id).status,'unknown');
  } finally {settle?.({id:'late'});await execution;await app.close();}
});

test('claim never ages an active publisher out; recovered unknown blocks its account',async()=>{
  const app=createApp();const now=Date.now();const first=queue(app.store,null,now+1000);
  queue(app.store,first.account,now+181000);
  app.store.claim(now+1001);
  assert.equal(app.store.claim(now+181001),null);
  assert.equal(app.store.get('schedules',first.job.id).status,'running');
  app.store.recover();
  assert.equal(app.store.claim(now+181001),null);
  await app.close();
});

test('close waits for pending publisher before closing database',async()=>{
  let settle;
  const app=createApp({publishTimeoutMs:10,publish:()=>new Promise(r=>{settle=r;})});
  const now=Date.now();queue(app.store,null,now+1000);
  const execution=app.tick(now+1001);
  let closed=false;const closing=app.close().then(()=>{closed=true;});
  await delay(30);
  try{assert.equal(closed,false);}finally{settle({id:'receipt'});await execution;await closing;}
});
