import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRuntime, checkRuntime } from '../server/runtime.mjs';

async function fixture(t, body) {
  const dir = await mkdtemp(join(tmpdir(), 'runtime-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'runtime');
  await writeFile(path, `#!${process.execPath}\n${body}`, { mode: 0o700 });
  return { provider: 'codex', codexPath: path, workbuddyPath: path, timeoutSeconds: 2 };
}
test('Codex uses stdin and parses final agent result with isolation flags', async t => {
  const config = await fixture(t, `let input='';process.stdin.on('data',c=>input+=c);process.stdin.on('end',()=>{const args=process.argv.slice(2);if(!args.includes('--ignore-user-config')||!args.includes('read-only')||!args.includes('shell_tool')||!input.includes('secret-input'))process.exit(3);console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'\u0060\u0060\u0060json\\n{"topics":[]}\\n\u0060\u0060\u0060'}}));});`);
  assert.deepEqual(await runRuntime(config, 'system', { data: 'secret-input' }), { topics: [] });
});
test('WorkBuddy final envelope parses JSON and disables tools', async t => {
  const config = await fixture(t, `const a=process.argv.slice(2);if(a[a.indexOf('--tools')+1]!==''||!a.includes('--strict-mcp-config'))process.exit(4);console.log(JSON.stringify({type:'result',subtype:'success',result:'{"body":"ok"}'}));`);
  config.provider = 'workbuddy';
  assert.deepEqual(await runRuntime(config, '', {}), { body: 'ok' });
});
test('runtime errors do not expose stderr secrets', async t => {
  const config = await fixture(t, `console.error('secret-api-key');process.exit(1);`);
  await assert.rejects(runRuntime(config, '', {}), e => e.code === 'RUNTIME_EXIT' && !e.message.includes('secret'));
});
test('runtime timeout terminates process', async t => {
  const config = await fixture(t, 'setInterval(()=>{},1000);');
  config.timeoutSeconds = 0.1;
  await assert.rejects(runRuntime(config, '', {}), e => e.code === 'RUNTIME_TIMEOUT');
});
test('runtime refuses oversized output and invalid JSON', async t => {
  const config = await fixture(t, `process.stdout.write('x'.repeat(3*1024*1024));`);
  await assert.rejects(runRuntime(config, '', {}), e => e.code === 'RUNTIME_OUTPUT_LIMIT');
  const invalid = await fixture(t, `console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'not-json'}}));`);
  await assert.rejects(runRuntime(invalid, '', {}), e => e.code === 'RUNTIME_JSON');
});
test('runtime check only invokes version, never implies authentication', async t => {
  const config = await fixture(t, `if(process.argv.slice(2).join(' ')!=='--version')process.exit(2);console.log('test-cli 1.0');`);
  const result = await checkRuntime(config);
  assert.equal(result.ok, true);
  assert.equal(result.authenticated, null);
});
