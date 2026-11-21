import { parentPort, workerData } from 'node:worker_threads';
import { errorDetails } from './errors.js';
import * as helpers from './helpers.js';

function normalizeItem(name, value) {
  const reason = typeof value?.reason === 'string' ? value.reason : null;
  const raw = value && typeof value === 'object' ? value.score : value;
  const score = typeof raw === 'boolean' ? Number(raw) : raw;
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    return { name, score: null, reason, error: 'Use a score from 0 to 1 or a boolean.' };
  }
  return { name, score, reason };
}

async function grade() {
  const { url, transcript, testCase, labels } = workerData;
  const { default: check } = await import(url);
  if (typeof check !== 'function') throw new Error('Export a default grade function in tests.js.');
  const scores = await check(transcript, { case: testCase, helpers, labels });
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) {
    throw new Error('Return an object with item names and scores.');
  }
  const items = Object.entries(scores).map(([name, value]) => normalizeItem(name, value));
  const invalid = items.filter(item => item.error).map(item => item.name);
  if (invalid.length) {
    return { status: 'error', items, error: errorDetails(`Invalid scores for ${invalid.join(', ')}.`) };
  }
  return { status: 'done', items, error: null };
}

try {
  parentPort.postMessage(await grade());
} catch (error) {
  parentPort.postMessage({ status: 'error', items: [], error: errorDetails(error) });
}
