import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../server/http.mjs';
test('shop HTTP preview and import preserve account scope and origin protection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'red-shop-http-'));
 const app=createApp({enableServices:true,serviceOptions:{assetsDir:dir,env:{},shopReader:async()=>({shopId:'s1',shopName:'测试店铺',complete:true,fetchedAt:new Date().toISOString(),products:[{productId:'p1',name:'测试商品',status:'on_sale'}]})}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
 const base=`http://127.0.0.1:${app.server.address().port}/api`;
 const post=(path,body={},origin)=>fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',...(origin?{Origin:origin}:{})},body:JSON.stringify(body)});
 try{
   const account=app.store.createAccount({name:'测试账号'}),path=`/accounts/${account.id}`;
   const denied=await post(path+'/shop-preview',{},'https://evil.example');assert.equal(denied.status,403);
   const preview=await post(path+'/shop-preview');assert.equal(preview.status,200);const data=(await preview.json()).data;
   assert.equal(app.store.list('products').length,0);assert.ok(data.token);
   const imported=await post(path+'/shop-import',{token:data.token});assert.equal(imported.status,200);assert.equal((await imported.json()).data.created,1);
   const replay=await post(path+'/shop-import',{token:data.token});assert.equal(replay.status,409);
   const state=await (await fetch(base+'/state')).json();assert.equal(state.data.products[0].confirmed,false);
   assert.equal(JSON.stringify(state).includes(data.token),false);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
