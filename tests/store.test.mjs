import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mod = await import('../server/store.mjs');
test('malformed product fields are validation errors',()=>{const s=new mod.AppStore(':memory:');assert.throws(()=>s.createProduct({name:'商品',facts:{text:'错'}}),/文字/);assert.throws(()=>s.createProduct({name:'商品',confirmed:'yes'}),/布尔/);s.close();});
const fixture = () => {
  const s = new mod.AppStore(':memory:');
  const p = s.createProduct({name:'杯子',facts:'容量 300ml',images:['https://example.org/cup.jpg'],confirmed:true});
  const a = s.createAccount({name:'生活账号',positioning:'日常'});
  const b = s.createBatch({productId:p.id,accountId:a.id});
  const [t] = s.addTopics(b.id,{titles:['杯子的使用记录']});
  s.confirmTopic(t.id); const [n] = s.generate(b.id); return {s,p,a,b,n};
};
test('topic confirmation gates generation', () => {const s=new mod.AppStore(':memory:');const p=s.createProduct({name:'物品'});const a=s.createAccount({name:'账号'});const b=s.createBatch({productId:p.id,accountId:a.id});assert.throws(()=>s.generate(b.id),/确认/);s.close();});
test('approval bound to immutable revision and account; content edits invalidate schedules',()=>{
 const {s,p,a,n}=fixture();const other=s.createAccount({name:'其他'});
 assert.throws(()=>s.createSchedule({noteId:n.id,accountId:a.id,scheduledAt:Date.now()+60000,mode:'normal'}),/批准/);
 s.approveNote(n.id,{mode:'product',productId:p.id});assert.throws(()=>s.createSchedule({noteId:n.id,accountId:other.id,scheduledAt:Date.now()+60000,mode:'normal'}),/账号/);
 const j=s.createSchedule({noteId:n.id,accountId:a.id,scheduledAt:Date.now()+60000,mode:'product',productId:p.id});s.approveSchedule(j.id);
 s.editNote(n.id,{body:'修改文案'});assert.equal(s.get('schedules',j.id).status,'invalidated');assert.equal(s.get('notes',n.id).approvedRevision,null);assert.equal(s.get('notes',n.id).revisions.length,2);s.close();
});
test('missing facts and images prevent content approval',()=>{const {s,n,p}=fixture();s.updateProduct(p.id,{facts:'',images:[]});assert.throws(()=>s.approveNote(n.id),/资料|图片/);s.close();});
test('time change requires renewed authorization and collisions are rejected',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+600000;const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});s.approveSchedule(j.id);assert.throws(()=>s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time}),/冲突/);s.reschedule(j.id,{scheduledAt:time+60000});assert.equal(s.get('schedules',j.id).status,'pending');s.close();});
test('claims serialize and missed jobs are never backfilled',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const now=Date.now();const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:now+1000});s.approveSchedule(j.id);assert.equal(s.claim(now+1001).id,j.id);assert.equal(s.claim(now+1002),null);s.recover();assert.equal(s.get('schedules',j.id).status,'unknown');assert.equal(s.claim(now+1003),null);s.editNote(n.id,{body:'另一版本'});s.approveNote(n.id);const j2=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:now+61000});s.approveSchedule(j2.id);assert.equal(s.claim(now+180001),null);assert.equal(s.get('schedules',j2.id).status,'missed');s.close();});
test('changing approved publishing mode invalidates previous authorization',()=>{const {s,n,a,p}=fixture();s.approveNote(n.id);const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:Date.now()+60000});s.approveSchedule(j.id);s.approveNote(n.id,{mode:'product',productId:p.id});assert.equal(s.get('schedules',j.id).status,'invalidated');s.close();});
test('sqlite persists records and recovers interrupted execution',()=>{const dir=mkdtempSync(join(tmpdir(),'rednote-'));const path=join(dir,'db.sqlite');let s=new mod.AppStore(path);const p=s.createProduct({name:'持久化'});s.close();s=new mod.AppStore(path);assert.equal(s.get('products',p.id).name,'持久化');s.close();rmSync(dir,{recursive:true});});
test('target count is advisory; all confirmed topics generate',()=>{const {s,b}=fixture();const more=s.addTopics(b.id,{titles:['二','三','四']});more.forEach(t=>s.confirmTopic(t.id));assert.equal(s.generate(b.id).length,3);s.close();});
test('unknown publication cannot be scheduled again',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+1000;const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});s.approveSchedule(j.id);s.claim(time+1);s.recover();assert.throws(()=>s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time+120000}),/重复/);s.close();});
test('missed can be explicitly rescheduled with fresh authorization',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+1000;const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});s.approveSchedule(j.id);s.claim(time+61000);assert.equal(s.reschedule(j.id,{scheduledAt:Date.now()+120000}).status,'pending');s.close();});
test('account daily limit is editable and enforced',()=>{const {s,n,a}=fixture();assert.equal(s.updateAccount(a.id,{dailyLimit:1}).dailyLimit,1);s.approveNote(n.id);const time=Date.now()+1000;s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});assert.throws(()=>s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time+120000}),/上限/);s.close();});
test('claim verifies the complete immutable publication authorization',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+1000;const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});s.approveSchedule(j.id);s.save('schedules',{...s.get('schedules',j.id),approval:'tampered'});assert.equal(s.claim(time+1),null);assert.equal(s.get('schedules',j.id).status,'invalidated');s.close();});
test('editing content or connection preserves a running job and its final outcome',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+1000;const j=s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});s.approveSchedule(j.id);s.claim(time+1);s.editNote(n.id,{body:'执行中修改'});s.updateAccount(a.id,{mcpUrl:'http://127.0.0.1:9999'});assert.equal(s.get('schedules',j.id).status,'running');assert.equal(s.get('schedules',j.id).revision,1);assert.equal(s.finish(j.id,{status:'succeeded',result:{id:'actual'}}).status,'succeeded');s.close();});
test('pending publication prevents a duplicate revision at another time',()=>{const {s,n,a}=fixture();s.approveNote(n.id);const time=Date.now()+1000;s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time});assert.throws(()=>s.createSchedule({noteId:n.id,accountId:a.id,mode:'normal',scheduledAt:time+120000}),/重复/);s.close();});
