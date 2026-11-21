import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { repoDir } from './storage.js';

export function scenarioDir(testCase) {
  return join(repoDir, 'data', testCase.scenario);
}

export async function hasData(testCase) {
  return Boolean((await stat(join(scenarioDir(testCase), 'meta.json'), { throwIfNoEntry: false }))?.isFile());
}

// The command that makes data/<scenario>/ from the case recipe.
export function generateArgs(testCase) {
  const args = [join('seed', 'generate.py'), '--name', testCase.scenario];
  if (testCase.noise.length) args.push('--noise', testCase.noise.join(','));
  if (testCase.incidents?.length) args.push('--incidents', testCase.incidents.join(','));
  return args;
}

export function generateCommand(testCase) {
  return ['python', ...generateArgs(testCase)].join(' ');
}

export function generateData(testCase, { quiet = false } = {}) {
  const python = process.env.EVAL_PYTHON || 'python';
  return new Promise((resolve, reject) => {
    const child = spawn(python, generateArgs(testCase), {
      cwd: repoDir,
      windowsHide: true,
      stdio: ['ignore', quiet ? 'ignore' : 'inherit', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`Data generation failed for ${testCase.id} (${python} exited with code ${code}).`
        + `${stderr.trim() ? `\n${stderr.trim()}` : ''}`));
    });
  });
}

export async function ensureData(testCase) {
  if (!(await hasData(testCase))) await generateData(testCase, { quiet: true });
  return scenarioDir(testCase);
}
