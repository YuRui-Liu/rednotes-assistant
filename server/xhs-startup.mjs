import { spawn } from 'node:child_process';
import { existsSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const script=fileURLToPath(new URL('../data/start-xiaohongshu-mcp.sh',import.meta.url));
const log=fileURLToPath(new URL('../data/xiaohongshu-mcp.log',import.meta.url));
function launchInstalled() {
  if(!existsSync(script))throw Error('缺少 data/start-xiaohongshu-mcp.sh，请先安装小红书连接服务');
  const fd=openSync(log,'a',0o600);
  try {return spawn('/bin/sh',[script],{detached:true,stdio:['ignore',fd,fd]});}
  finally {closeSync(fd);}
}

// The installed account-1 launcher owns port 18060 and its existing cookie file.
// Keep it independent from the web process so dev restarts reuse the session.
export async function ensureXhs({fetch=globalThis.fetch,launch=launchInstalled,sleep=delay,attempts=20}={}) {
  async function probe() {
    let response;
    try {response=await fetch('http://127.0.0.1:18060/health',{signal:AbortSignal.timeout(1500),redirect:'error'});}
    catch {return false;}
    let body;
    try {body=await response.json();} catch {}
    if(response.ok&&body?.success===true&&body.data?.service==='xiaohongshu-mcp'&&body.data.status==='healthy')return true;
    throw Error('18060 端口被其他服务占用或小红书服务健康检查异常，请检查后重启');
  }
  if(await probe())return {status:'reused'};
  let child,failure;
  try {child=launch();} catch(error) {throw Error(`小红书连接服务启动失败：${error.message}`);}
  child.once('error',()=>{failure='小红书连接服务启动失败，请检查启动脚本和可执行文件';});
  child.once('exit',(code)=>{failure=`小红书连接服务启动失败（退出码 ${code}），请查看 data/xiaohongshu-mcp.log`;});
  try {
    for(let i=0;i<attempts;i++) {
      await sleep(500);
      if(failure)throw Error(failure);
      if(await probe()) {child.unref();return {status:'started'};}
    }
    throw Error('小红书连接服务启动后未就绪，请查看 data/xiaohongshu-mcp.log');
  } catch(error) {child.kill('SIGTERM');throw error;}
}
