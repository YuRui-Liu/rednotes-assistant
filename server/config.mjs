import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, chmodSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import { AppError } from './store.mjs';

export class ServiceConfig {
  constructor(path, env = process.env) {
    this.path = path;
    this.value = {
      provider: env.LLM_BASE_URL ? 'api' : 'codex',
      codexPath: 'codex',
      workbuddyPath: '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      runtimeModel: '', timeoutSeconds: 180,
      llmBaseUrl: env.LLM_BASE_URL || '', llmApiKey: env.LLM_API_KEY || '',
      grsaiBaseUrl: env.GRSAI_BASE_URL || 'https://grsai.dakka.com.cn', grsaiApiKey: env.GRSAI_API_KEY || '',
    };
    // Resolve the common local Codex launcher without embedding a user's path.
    for (const dir of (env.PATH || '').split(':')) {
      if (dir && existsSync(`${dir}/codex`)) { this.value.codexPath = `${dir}/codex`; break; }
    }
    if (path && existsSync(path)) this.value = { ...this.value, ...JSON.parse(readFileSync(path, 'utf8')) };
  }
  public() {
    const { llmApiKey, grsaiApiKey, ...safe } = this.value;
    return { ...safe, llmApiKeySet: Boolean(llmApiKey), grsaiApiKeySet: Boolean(grsaiApiKey) };
  }
  update(input) {
    const fail = () => { throw new AppError('服务配置无效，请检查地址、执行器路径与超时'); };
    const allowed = [...Object.keys(this.value), 'clearLlmApiKey', 'clearGrsaiApiKey'];
    if (Object.keys(input).some(k => !allowed.includes(k))) fail();
    const next = { ...this.value };
    for (const [key, value] of Object.entries(input)) {
      if (key.startsWith('clear')) { if (typeof value !== 'boolean') fail(); continue; }
      if (key === 'timeoutSeconds') {
        if (!Number.isInteger(value) || value < 10 || value > 1800) fail();
      } else if (typeof value !== 'string' || value.length > 4096 || /[\r\n\0]/.test(value)) fail();
      if (key.endsWith('ApiKey') && !value.trim()) continue;
      next[key] = typeof value === 'string' ? value.trim() : value;
    }
    if (!['api', 'codex', 'workbuddy'].includes(next.provider)) fail();
    for (const key of ['llmBaseUrl', 'grsaiBaseUrl']) {
      if (!next[key]) continue;
      let url; try { url = new URL(next[key]); } catch { fail(); }
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) fail();
      if (url.protocol === 'http:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) fail();
    }
    for (const key of ['codexPath', 'workbuddyPath']) {
      if (!next[key] || (!isAbsolute(next[key]) && !/^[\w.-]+$/.test(next[key]))) fail();
    }
    if (input.clearLlmApiKey) next.llmApiKey = '';
    if (input.clearGrsaiApiKey) next.grsaiApiKey = '';
    if (this.path) {
      mkdirSync(dirname(this.path), { recursive: true });
      const temporary = `${this.path}.tmp`;
      writeFileSync(temporary, JSON.stringify(next), { mode: 0o600 });
      chmodSync(temporary, 0o600);
      renameSync(temporary, this.path);
    }
    this.value = next;
    return this.public();
  }
}
