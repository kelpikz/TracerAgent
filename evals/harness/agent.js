import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { validateEffort, validateModel } from './judge.js';
import { stopCommand } from './process.js';
import { evalsDir, readJson, repoDir } from './storage.js';

export function agentDefaults() {
  return {
    model: process.env.EVAL_AGENT_MODEL || 'openai-codex/gpt-6.2-sol',
    effort: process.env.EVAL_AGENT_EFFORT || 'high',
  };
}

export function validateAgent({ model, effort }) {
  validateModel(model, 'an agent model');
  validateEffort(effort, 'agent effort');
}

function runCommand(command, request, timeoutSeconds) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      cwd: repoDir,
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => {
      stopCommand(child);
      reject(new Error(`Agent command timed out after ${timeoutSeconds} s.`));
    }, timeoutSeconds * 1000);

    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', error => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Agent command exited with ${signal ?? `code ${code}`}.${
        stderr.trim() ? `\n${stderr.trim()}` : ''
      }`));
    });
    child.stdin.on('error', error => {
      if (error.code !== 'EPIPE') reject(error);
    });
    child.stdin.end(`${JSON.stringify(request)}\n`);
  });
}

export async function runAgent(testCase, dataDir, { model, effort } = agentDefaults()) {
  const { id, input, scenario, noise, incidents = [], timeout_s } = testCase;
  // The data has a fixed time window. The agent must treat its end as the current time.
  const now = (await readJson(join(dataDir, 'meta.json')))?.now ?? null;
  const config = process.env.EVAL_AGENT_CMD ? null : await readJson(join(evalsDir, 'config.json'));
  const command = process.env.EVAL_AGENT_CMD || config?.agent?.command;
  if (command != null && typeof command !== 'string') {
    throw new Error('Set agent.command in evals/config.json to a shell command string.');
  }

  if (!command) {
    throw new Error('No agent command. Set EVAL_AGENT_CMD or agent.command in evals/config.json, '
      + 'for example: node agent/cli.js');
  }
  const source = 'agent stdout';
  const raw = await runCommand(command,
    { case_id: id, input, scenario, noise, incidents, now, data_dir: dataDir, model, effort }, timeout_s);

  let transcript;
  try {
    transcript = JSON.parse(raw);
  } catch (error) {
    throw new Error(`Invalid transcript JSON from ${source}. Write logs to stderr.`,
      { cause: error });
  }
  if (!Array.isArray(transcript?.steps) || typeof transcript.final_output !== 'string') {
    throw new Error(`Invalid transcript from ${source}. Use a steps array and a final_output string.`);
  }
  return transcript;
}
