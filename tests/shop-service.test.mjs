import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AppStore } from '../server/store.mjs';
import { Services } from '../server/services.mjs';
const snapshot={shopId:'s1',shopName:'店铺',complete:true,fetchedAt:new Date().toISOString(),products:[{productId:'p1',name:'商品',status:'sold_out'}]};
async function fixture(fn,shopReader) {
  const store=new AppStore(),dir=mkdtempSync(join(tmpdir(),'red-shop-'));
  const service=new Services(store,{assetsDir:dir,env:{},shopReader});
  const account=store.createAccount({name:'账号'});
  const call=(action,body={},id=account.id)=>service.route({method:'POST',kind:'accounts',id,action,body});
  try {await fn({store,service,account,call});} finally {await service.close();store.close();rmSync(dir,{recursive:true,force:true});}
}
test('shop preview has no writes; import uses server snapshot and rejects replay',async()=>{
  await fixture(async({store,call})=>{
    const preview=await call('shop-preview');assert.ok(preview.token);assert.equal(store.list('products').length,0);
    assert.equal(preview.products[0].status,'sold_out');
    const result=await call('shop-import',{token:preview.token,products:[{name:'tampered'}]});
    assert.equal(result.created,1);assert.equal(store.list('products')[0].name,'商品');
    await assert.rejects(call('shop-import',{token:preview.token}),/重新检测/);
  },async()=>snapshot);
});
test('shop preview token is bound to selected account and connection',async()=>{
  await fixture(async({store,call,account})=>{
    const p=await call('shop-preview'),other=store.createAccount({name:'另一个账号'});
    await assert.rejects(call('shop-import',{token:p.token},other.id),/重新检测/);
    store.updateAccount(account.id,{mcpUrl:'http://127.0.0.1:18061'});
    await assert.rejects(call('shop-import',{token:p.token}),/重新检测/);
    assert.equal(store.list('products').length,0);
  },async()=>snapshot);
});
test('missing shop reader reports connection requirement instead of empty success',async()=>{
  await fixture(async({call,store})=>{await assert.rejects(call('shop-preview'),e=>e.code==='SHOP_CONNECTION_REQUIRED');assert.equal(store.list('products').length,0);});
});
test('malformed or incomplete upstream snapshot never gets an import token',async()=>{
  await fixture(async({call,store})=>{await assert.rejects(call('shop-preview'),e=>e.code==='SHOP_DATA');assert.equal(store.list('products').length,0);},async()=>({...snapshot,complete:false}));
});
