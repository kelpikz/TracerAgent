// Turns the durable conversation into the eval transcript (evals/harness/transcript.md).
// A tool call that ran a subagent has `details.conversationId`. Its child's steps come right after that call,
// with an `agent` field, so the graders see every tool call of every agent.

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

/**
 * Steps of one conversation. `children` maps a child conversation ID to its entries.
 * Returns the flat steps (children included) and the conversation's last assistant text.
 */
function conversationSteps(entries, agentName, children) {
  const steps = [];
  const calls = new Map();
  let finalOutput = '';
  const tag = step => (agentName ? { ...step, agent: agentName } : step);

  for (const entry of entries) {
    for (const message of entry.model ?? []) {
      if (message.role === 'assistant') {
        const texts = [];
        for (const block of message.content ?? []) {
          if (block.type === 'text' && block.text.trim()) texts.push(block.text);
          if (block.type === 'toolCall') {
            if (texts.length) steps.push(tag({ type: 'message', role: 'assistant', text: texts.splice(0).join('\n') }));
            const step = tag({ type: 'tool_call', id: block.id, tool: block.name, args: block.arguments ?? {}, result: null, error: null, duration_ms: null });
            calls.set(block.id, step);
            steps.push(step);
          }
        }
        if (texts.length) {
          const text = texts.join('\n');
          steps.push(tag({ type: 'message', role: 'assistant', text }));
          finalOutput = text;
        }
      } else if (message.role === 'toolResult') {
        const step = calls.get(message.toolCallId);
        if (!step) continue;
        const result = parseResult(message.content);
        if (message.isError) step.error = typeof result === 'string' ? result : JSON.stringify(result);
        else step.result = result;
        const details = entry.data?.details ?? message.details;
        step.duration_ms = details?.duration_ms ?? null;
        const childEntries = details?.conversationId && children.get(details.conversationId);
        if (childEntries) {
          const child = conversationSteps(childEntries, details.agent ?? 'subagent', children);
          // The child's answer is already this call's result.
          const last = child.steps.at(-1);
          if (last?.type === 'message' && last.text === child.finalOutput) child.steps.pop();
          step.children = child.steps;
        }
      }
    }
  }

  // Put each child's steps right after the call that ran it.
  const flat = [];
  for (const step of steps) {
    const { children: nested, ...rest } = step;
    flat.push(rest);
    if (nested) flat.push(...nested);
  }
  return { steps: flat, finalOutput };
}

export function toTranscript({ entries, children = new Map(), input, agent, rootAgent, finalTool, usage, startedAt, endedAt, runFile }) {
  const { steps, finalOutput: lastText } = conversationSteps(entries, rootAgent, children);
  let finalOutput = lastText;

  // An architecture can end with a tool whose result is the answer, for example a reporting agent.
  const report = finalTool && steps.findLast(s => s.type === 'tool_call' && s.tool === finalTool && !s.error && typeof s.result === 'string');
  if (report) finalOutput = report.result;

  // The last assistant message is the answer, so it is not also a step.
  const last = steps.at(-1);
  if (last?.type === 'message' && last.text === finalOutput && (!rootAgent || last.agent === rootAgent)) steps.pop();

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
