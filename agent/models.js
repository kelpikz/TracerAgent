// Model access through pi-ai. Sign-ins come from the pi CLI's auth.json,
// so `pi auth login openai-codex` is enough. API keys in env vars also work.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { builtinModels } from '@earendil-works/pi-ai/providers/all';

const AUTH_FILE = process.env.PI_AUTH_FILE
  || join(process.env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent'), 'auth.json');

/** A CredentialStore over pi's auth.json. Writes keep the other providers. */
class PiAuthFileStore {
  #chain = Promise.resolve();

  #readAll() {
    return existsSync(AUTH_FILE) ? JSON.parse(readFileSync(AUTH_FILE, 'utf8')) : {};
  }

  async read(providerId) {
    return this.#readAll()[providerId];
  }

  async list() {
    return Object.entries(this.#readAll()).map(([providerId, c]) => ({ providerId, type: c.type }));
  }

  modify(providerId, fn) {
    const run = this.#chain.then(async () => {
      const all = this.#readAll();
      const next = await fn(all[providerId]);
      if (next === undefined) delete all[providerId];
      else all[providerId] = next;
      mkdirSync(dirname(AUTH_FILE), { recursive: true });
      writeFileSync(AUTH_FILE, JSON.stringify(all, null, 2));
      return next;
    });
    this.#chain = run.catch(() => {});
    return run;
  }

  async delete(providerId) {
    await this.modify(providerId, async () => undefined);
  }
}

export function createModels() {
  return builtinModels({ credentials: new PiAuthFileStore() });
}

/** "provider/model-id" -> { provider, modelId } */
export function parseModelRef(ref) {
  const slash = ref?.indexOf('/') ?? -1;
  if (slash <= 0) throw new Error(`Bad model "${ref}". Use provider/model, e.g. openai-codex/gpt-6.2-sol.`);
  return { provider: ref.slice(0, slash), modelId: ref.slice(slash + 1) };
}
