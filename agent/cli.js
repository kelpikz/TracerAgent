#!/usr/bin/env node
// Eval agent command. Reads one JSON request on stdin, writes the transcript on stdout.
// Logs go to stderr. See evals/harness/transcript.md.
//
//   EVAL_AGENT_CMD="node agent/cli.js" npm run eval -- run <case-id>
//
// Env: AGENT_ARCH picks the architecture (default "single"). AGENT_RUN_ID reuses a run store, so a crashed run resumes.
import { runIncident } from './run.js';

async function readStdin() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  return text;
}

const request = JSON.parse(await readStdin());
const log = line => process.stderr.write(`[agent] ${line}\n`);

const transcript = await runIncident({
  input: request.input,
  dataDir: request.data_dir,
  model: request.model || process.env.EVAL_AGENT_MODEL || 'openai-codex/gpt-6.2-sol',
  effort: request.effort || process.env.EVAL_AGENT_EFFORT || 'high',
  now: request.now ?? undefined,
  architecture: request.architecture || process.env.AGENT_ARCH,
  runId: process.env.AGENT_RUN_ID,
  log,
});

process.stdout.write(`${JSON.stringify(transcript)}\n`);
