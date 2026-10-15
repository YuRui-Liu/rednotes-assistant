import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, statSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ServiceConfig } from '../server/config.mjs';
test('service secrets persist privately, never appear in public configuration, blank preserves and clear removes', () => {
 const dir = mkdtempSync(join(tmpdir(), 'red-config-'));
 try {
  const path = join(dir,'config.json'), c = new ServiceConfig(path, {});
  assert.equal(c.public().provider,'codex');
  c.update({provider:'api',llmBaseUrl:'https://example.com/v1',llmApiKey:'secret'});
  assert.equal(JSON.stringify(c.public()).includes('secret'),false);
  assert.equal(statSync(path).mode & 0o777,0o600);
  c.update({llmApiKey:''});
  assert.equal(new ServiceConfig(path,{}).value.llmApiKey,'secret');
  assert.throws(()=>c.update({llmBaseUrl:'https://user:pass@example.com'}));
  assert.throws(()=>c.update({timeoutSeconds:0}));
  assert.throws(()=>c.update({provider:'shell'}));
  c.update({clearLlmApiKey:true}); assert.equal(c.public().llmApiKeySet,false);
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
