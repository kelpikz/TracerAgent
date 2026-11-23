// Six agents. The orchestrator LLM plans the investigation and calls the other agents as tools:
//   observability  logs, metrics, traces, business KPIs
//   dependency     deploys, config changes, databases, queues, third parties
//   reasoning      ranks competing root-cause hypotheses (no tools)
//   critic         accepts the conclusion or asks for more evidence (no tools)
//   reporting      writes the final report; its answer ends the run (no tools)
// Each call starts a new child conversation that the call owns. The child sees only the task text.
// Models, effort and turn limits per agent come from multi-agent.json (null = use the request value).
// The eval request can override model and effort per agent (`agents` field), for example from the eval page.
import { readFileSync } from 'node:fs';
import { configure, defineExtension, defineTool } from '@earendil-works/pi-durable';
import { createTelemetryExtension } from '../extensions/telemetry.js';
import { parseModelRef } from '../models.js';

const CONFIG_FILE = process.env.AGENT_MULTI_CONFIG || new URL('./multi-agent.json', import.meta.url);
const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'));

const ORCHESTRATOR_TOOLS = ['list_alerts', 'list_services'];
const OBSERVABILITY_TOOLS = [
  'list_services', 'get_service_health', 'list_alerts',
  'query_metric', 'top_endpoints', 'compare_windows',
  'search_logs', 'log_patterns', 'logs_by_trace',
  'find_traces', 'get_trace',
  'business_kpis', 'stuck_orders', 'get_order_timeline',
];
const DEPENDENCY_TOOLS = [
  'list_services', 'get_service_health',
  'list_changes', 'db_health', 'kafka_lag', 'dlq_sample', 'third_party_health',
  'get_runbook', 'past_incidents',
];

// One round = one call each to ask_observability and ask_dependency.
const MAX_ROUNDS = 3;
const INVESTIGATORS = ['observability', 'dependency'];

const iso = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');

const window = store => `Telemetry covers ${iso(store.start)} to ${iso(store.now)} UTC. "Now" is ${iso(store.now)}.`;

const RULES = `Your tools are read-only. Each gives a small summary, compared to normal.
Always give "from" and "to" (ISO UTC) for the window you check.
Do not guess. If the data does not show something, say so.`;

const PROMPTS = {
  orchestrator: store => `You are the lead on-call engineer for an online shop. You plan and coordinate an incident investigation.
${window(store)}

You get an alert or a report. The team must find the root cause, the customer impact, and if someone must act now.
Some alerts are noise: scheduled jobs, low night traffic, known slow jobs. Tell a real incident from expected behavior.

You have a team of agents. Each one sees only the text you send. Put the times, services and facts it needs in that text.
- ask_observability: logs, metrics, traces, business KPIs and orders.
- ask_dependency: deploys, config changes, databases, Kafka, DLQs, third-party services, runbooks, past incidents.
- ask_reasoning: give it all findings. It makes and compares root-cause hypotheses.
- ask_critic: give it the best hypothesis and its evidence. It accepts it or asks for more investigation.
- write_report: give it the accepted conclusion and all evidence. It writes the final report. This ends the investigation.
You can also call list_alerts and list_services yourself to plan.

Find the full cause chain. For each cause you find, ask what made it happen and when that began,
until you reach a change (deploy, migration, config change, job) or an outside event. The first cause can start hours before the alert.

An investigation round is one set of ask_observability and ask_dependency calls. You have at most ${MAX_ROUNDS} rounds.
Make each round count: give each agent all open questions in one task.

How to work:
1. Get the exact time of the alert or report. Make a short plan.
2. Round 1: send specific tasks to ask_observability and ask_dependency in the same turn.
   Ask them when the affected service or database first got worse (look back over all telemetry, not only near the alert),
   and what changed just before that.
3. Call ask_reasoning once. Then use round 2 for the "Missing" items that the tools can check.
4. Call ask_critic with the best hypothesis. If it asks for more evidence and you have rounds left, use one more round for its checks.
   Do not call ask_reasoning again. Call ask_critic at most 2 times.
   If the tools cannot give a requested check, do not search for it again. In the next ask_critic call,
   write "Not available: <check>" and ask the critic to judge the evidence that exists.
5. Call write_report. Always finish with write_report. When no rounds are left, call write_report next.

When you call ask_reasoning, ask_critic or write_report, include the raw evidence for each claim:
the exact IDs, values, times and log lines from the tool results (for example "trace 7d2c… blocking_pid=5089").
Copy these facts. Do not reword them, and keep them in every later call. Do not drop a fact only because it is not proved yet.`,

  observability: store => `You are the observability agent in an incident investigation for an online shop.
You investigate logs, metrics, traces, business KPIs and orders.
${window(store)}
${RULES}

Do the task you get. Use more than one source. Find when the problem started and stopped, and how large it is.
Check if a related metric or log got worse earlier than the alert, and when. Look back over all telemetry if needed.
Reply with short facts: times in UTC, metric values compared to normal, trace IDs, order IDs, log patterns.
Say what you checked that was normal too.`,

  dependency: store => `You are the dependency agent in an incident investigation for an online shop.
You examine deploys, configuration changes, scheduled jobs and service dependencies:
databases, Kafka topics, dead-letter queues and third-party services. You also read runbooks and past incidents.
${window(store)}
${RULES}

Do the task you get. Find changes and dependency problems before the incident, and their exact times.
Look back to when the problem first began. This can be hours before the alert.
Reply with short facts: change IDs, services, times in UTC, values compared to normal.
Say what you checked that was normal too.`,

  reasoning: () => `You are the reasoning agent in an incident investigation for an online shop.
You get the findings of the investigation. You have no tools.

Make 2 to 4 competing root-cause hypotheses. One hypothesis can be "this is expected behavior, not an incident".
For each hypothesis, give the evidence for it, the evidence against it, and what data is missing.
Check the timing: a cause must start before its effect.
If a job or query got slower, compare its speed per item (for example rows per second) before and after, not only its input size.
If a change happened just before a step change in a metric, test it as the cause of that step.
Rank the hypotheses from most to least likely, and say how confident you are in the first one.
Name the data that would best separate the top two hypotheses.`,

  critic: () => `You are the critic agent in an incident investigation for an online shop.
You get a proposed root cause and its evidence. You have no tools.

Challenge the conclusion. Look for:
- a claim without evidence, or evidence that only shows correlation;
- a timing problem: the cause does not start before the effect;
- another cause that the evidence does not rule out;
- missing customer impact, or no check that the problem stopped;
- noise (a scheduled job, low traffic) that was called an incident, or the opposite.

If a check is marked "Not available", do not ask for it. Judge the claim on the evidence that exists.
Accept a link that a trace, log or metric shows directly. Do not ask to check every single event.
Check the full cause chain. If the cause is a slow or stuck job, query or service, ask what made it slow and when that began.
Do not accept a conclusion that leaves this unknown, if the tools can still look for it.
If no investigation rounds are left, start with "VERDICT: ACCEPT" and list the gaps the report must state.

Start your reply with one line: "VERDICT: ACCEPT" or "VERDICT: INVESTIGATE MORE".
Then give your reasons. For "INVESTIGATE MORE", give a numbered list of specific checks:
which data, which service, which time window.`,

  reporting: () => `You are the reporting agent in an incident investigation for an online shop.
You get the conclusion and the evidence of the investigation. You have no tools.
Write the final report. Use only the facts you get. Do not add facts.
Give the full cause chain, from the first cause to the customer symptom. Name the most likely first cause as the root cause,
and give your confidence. Do not call a link "not proven" when the timing and the evidence support it.
If requests failed before payment, say that customers were not charged.

Write in short, plain sentences, with these headings:
## Root cause
## Evidence
(times in UTC, metric values, trace or order IDs)
## Customer impact
(how many attempts or orders, where requests failed, if customers were charged, and if the problem is still active)
## Next steps
(most important first: stop the immediate cause now, then fix the first cause (for example repair or revert the change), then how to check recovery.
Say "No immediate action is needed." if that is true)`,
};

export const ROLES = [
  { name: 'orchestrator', description: 'Plans and coordinates the investigation.' },
  { name: 'observability', description: 'Investigates logs, metrics, traces and business KPIs.' },
  { name: 'dependency', description: 'Examines deploys, config changes and service dependencies.' },
  { name: 'reasoning', description: 'Makes and compares root-cause hypotheses.' },
  { name: 'critic', description: 'Challenges the conclusion and asks for more evidence.' },
  { name: 'reporting', description: 'Writes the final report and remediation steps.' },
];

/**
 * Model, effort and turn limit for one agent: the request override, then multi-agent.json.
 * Unset fields keep the inherited value (the request model and effort).
 */
function agentChange(role, overrides) {
  const c = { ...config[role], ...Object.fromEntries(Object.entries(overrides?.[role] ?? {}).filter(([, v]) => v)) };
  return {
    ...(c.model ? { model: parseModelRef(c.model) } : {}),
    ...(c.effort ? { thinkingLevel: c.effort } : {}),
    ...(c.maxTurns ? { maxTurns: c.maxTurns } : {}),
  };
}

function answerText(entry) {
  return (entry?.model ?? [])
    .filter(m => m.role === 'assistant')
    .flatMap(m => m.content ?? [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('\n')
    .trim();
}

/** Runs one agent in a child conversation owned by this tool call, and returns its answer. */
async function runChild(api, context, { role, content, tools, instructions, overrides }) {
  const child = await api.commit(async tx => {
    // A rerun after a crash finds the same child.
    const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
    if (existing) return existing.id;
    const created = await tx.createConversation({ ownership: { kind: 'task', taskId: api.taskId } });
    await configure(tx, created.id, { ...agentChange(role, overrides), tools, instructions });
    return created.id;
  }, context);
  const details = { agent: role, conversationId: child };
  await api.details(details, context);

  const conversation = await api.conversation(child, context);
  const request = { type: 'input', content, requestId: `${role}:${api.taskId}` };
  const settled = await (await conversation.submit(request, context)).wait(context);
  if (settled.status !== 'done') {
    throw new Error(`The ${role} agent ended without an answer (${settled.reason ?? settled.status}).`);
  }
  const text = answerText(await api.commit(tx => tx.entry(settled.answer), context));
  return { text, details };
}

function buildExtensions(store, overrides) {
  const telemetry = createTelemetryExtension(store);
  const pick = names => telemetry.tools.filter(t => names.includes(t.name));

  const roles = {
    observability: { tools: pick(OBSERVABILITY_TOOLS), param: 'task', help: 'What to investigate. Include times, services and what you know.' },
    dependency: { tools: pick(DEPENDENCY_TOOLS), param: 'task', help: 'What to examine. Include times, services and what you know.' },
    reasoning: { tools: [], param: 'findings', help: 'All findings so far, with the exact IDs, values, times and log lines from the tool results.' },
    critic: { tools: [], param: 'conclusion', help: 'The proposed root cause, impact, the raw evidence for it (exact IDs, values, times, log lines), and the checks that are not available.' },
    reporting: { tools: [], param: 'material', help: 'The accepted conclusion and all evidence, impact and status.' },
  };

  const descriptions = {
    observability: 'Ask the observability agent to investigate logs, metrics, traces, business KPIs and orders.',
    dependency: 'Ask the dependency agent to examine deploys, config changes, databases, Kafka, DLQs, third parties, runbooks and past incidents.',
    reasoning: 'Ask the reasoning agent to make and rank competing root-cause hypotheses from the findings.',
    critic: 'Ask the critic agent to challenge a conclusion. It accepts it or lists the checks that are still needed.',
    reporting: 'Ask the reporting agent to write the final report. Its report is the final answer and ends the investigation.',
  };

  const calls = { observability: 0, dependency: 0 };
  const roundsLeft = () => MAX_ROUNDS - Math.max(...INVESTIGATORS.map(r => calls[r]));

  const agentTools = Object.entries(roles).map(([role, { tools, param, help }]) => defineTool({
    name: role === 'reporting' ? 'write_report' : `ask_${role}`,
    description: descriptions[role],
    parameters: { type: 'object', properties: { [param]: { type: 'string', description: help } }, required: [param] },
    replay: 'safe',
    async execute(args, api, context) {
      let content = args[param];
      if (INVESTIGATORS.includes(role)) {
        if (calls[role] >= MAX_ROUNDS) {
          return { output: [{ type: 'text', text: `No investigation rounds are left (limit ${MAX_ROUNDS}). Call write_report now.` }] };
        }
        calls[role]++;
      } else if (role === 'reasoning' || role === 'critic') {
        content += `\n\nInvestigation rounds left: ${roundsLeft()} of ${MAX_ROUNDS}.`;
      }
      const { text, details } = await runChild(api, context, {
        role,
        content,
        tools,
        instructions: PROMPTS[role](store),
        overrides,
      });
      return {
        output: [{ type: 'text', text: text || `(The ${role} agent gave an empty answer.)` }],
        details,
        // The report is the answer: end the orchestrator's run without another model request.
        ...(role === 'reporting' ? { control: { terminate: true } } : {}),
      };
    },
  }));

  const agents = defineExtension({ name: 'multi-agents', tools: agentTools });
  const orchestratorTools = [...pick(ORCHESTRATOR_TOOLS), ...agentTools];
  return { extensions: [telemetry, agents], orchestratorTools };
}

const built = new WeakMap();
const forStore = (store, overrides) => {
  if (!built.has(store)) built.set(store, buildExtensions(store, overrides));
  return built.get(store);
};

export default {
  name: 'multi',
  description: 'Orchestrator with observability, dependency, reasoning, critic and reporting agents.',
  rootAgent: 'orchestrator',
  finalTool: 'write_report',
  roles: ROLES,

  extensions({ store, agents }) {
    return forStore(store, agents).extensions;
  },

  agent({ store, agents }) {
    return {
      ...agentChange('orchestrator', agents),
      tools: forStore(store, agents).orchestratorTools,
      instructions: PROMPTS.orchestrator(store),
    };
  },
};
