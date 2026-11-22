// Turns the durable conversation into the eval transcript (evals/harness/transcript.md).

function parseResult(content) {
  const text = (content ?? []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sumUsage(usage) {
  const totals = { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cost_usd: 0 };
  for (const u of Object.values(usage?.models ?? {})) {
    totals.input_tokens += u.input ?? 0;
    totals.output_tokens += u.output ?? 0;
    totals.cache_read_tokens += u.cacheRead ?? 0;
    totals.cost_usd += u.cost?.total ?? 0;
  }
  totals.cost_usd = Math.round(totals.cost_usd * 10000) / 10000;
  return totals;
}

export function toTranscript({ entries, input, agent, usage, startedAt, endedAt, runFile }) {
  const steps = [];
  const calls = new Map();
  let finalOutput = '';

  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role === 'assistant') {
        const texts = [];
        for (const block of message.content ?? []) {
          if (block.type === 'text' && block.text.trim()) texts.push(block.text);
          if (block.type === 'toolCall') {
            if (texts.length) steps.push({ type: 'message', role: 'assistant', text: texts.splice(0).join('\n') });
            const step = { type: 'tool_call', id: block.id, tool: block.name, args: block.arguments ?? {}, result: null, error: null, duration_ms: null };
            calls.set(block.id, step);
            steps.push(step);
          }
        }
        if (texts.length) {
          const text = texts.join('\n');
          steps.push({ type: 'message', role: 'assistant', text });
          finalOutput = text;
        }
      } else if (message.role === 'toolResult') {
        const step = calls.get(message.toolCallId);
        if (!step) continue;
        const result = parseResult(message.content);
        if (message.isError) step.error = typeof result === 'string' ? result : JSON.stringify(result);
        else step.result = result;
        step.duration_ms = entry.data?.details?.duration_ms ?? message.details?.duration_ms ?? null;
      }
    }
  }

  // The last assistant message is the answer, so it is not also a step.
  const last = steps.at(-1);
  if (last?.type === 'message' && last.text === finalOutput) steps.pop();

  return {
    agent: { ...agent, run_file: runFile },
    input,
    steps,
    final_output: finalOutput,
    usage: sumUsage(usage),
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
  };
}
