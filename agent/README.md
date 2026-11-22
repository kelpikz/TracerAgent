# Triage agent

The agent reads an incident, calls the read-only tools from `system-design.html` (section 3), and writes its findings.
It runs on [`@earendil-works/pi-durable`](https://www.npmjs.com/package/@earendil-works/pi-durable).
Each run is stored in SQLite. If the process stops, run it again with the same run ID and it continues.

## Run

Sign in once with `pi auth login openai-codex`. The agent reads the `pi` sign-in from `~/.pi/agent/auth.json`.
API keys in environment variables (for example `ANTHROPIC_API_KEY`) also work.

```sh
EVAL_AGENT_CMD="node agent/cli.js" npm run eval -- run noise-price-import-replica-lag
```

PowerShell:

```powershell
$env:EVAL_AGENT_CMD = "node agent/cli.js"; npm run eval -- run noise-price-import-replica-lag
```

| Environment variable | Use |
| --- | --- |
| `AGENT_ARCH` | Architecture name: `single` (default) or `multi`. |
| `AGENT_MULTI_CONFIG` | Path to a different `multi-agent.json`. |
| `AGENT_RUN_ID` | Run store name in `.agent-runs/`. Use the same ID to continue a stopped run. |
| `PI_AUTH_FILE` | Path to a different `auth.json`. |

The model and effort come from the eval request (`--agent-model`, `--agent-effort`).

## Files

| File | Contents |
| --- | --- |
| `cli.js` | Eval command. JSON request on stdin, transcript on stdout, logs on stderr. |
| `run.js` | Opens the durable harness, installs the architecture, submits the incident, waits. |
| `architectures/` | One file for each architecture. `index.js` lists them. |
| `extensions/telemetry.js` | Makes the tools into one pi-durable extension. |
| `telemetry/tools.js` | The 21 tools. Plain functions and JSON schemas, with no framework code. |
| `telemetry/store.js` | Loads one scenario folder. It never reads `labels.json`. |
| `models.js` | pi-ai models with the `pi` CLI sign-in. |
| `transcript.js` | Changes the durable conversation into the eval transcript. |

## Architectures

| Name | Agents |
| --- | --- |
| `single` | One agent with all tools. |
| `multi` | An orchestrator LLM calls 5 agents as tools. Each call starts a new child conversation. |

### `multi`

| Agent | Tool for the orchestrator | Telemetry tools |
| --- | --- | --- |
| Orchestrator | — | `list_alerts`, `list_services` |
| Observability | `ask_observability` | Metrics, logs, traces, business, `list_services`, `get_service_health`, `list_alerts` |
| Dependency | `ask_dependency` | Changes, dependencies, `get_runbook`, `past_incidents`, `list_services`, `get_service_health` |
| Reasoning | `ask_reasoning` | None |
| Critic | `ask_critic` | None |
| Reporting | `write_report` | None. Its report is the final answer and ends the run. |

The orchestrator decides the order. Its prompt tells it to use the critic and to finish with `write_report`.
Each agent sees only the text that the orchestrator sends.

`architectures/multi-agent.json` sets `model` (`provider/model`), `effort`, and `maxTurns` for each agent.
`null` uses the value from the eval request. `AGENT_MULTI_CONFIG` gives the path to a different file.

In the transcript, the tool calls of a subagent come right after the `ask_*` call that started it.
These steps have an `agent` field.

## Add an architecture

1. Make a file in `architectures/`. Export an object with `name`, `description`, and `extensions({ store })`.
2. Optional: `agent({ store })` gives conversation settings, for example `maxTurns`.
3. Optional: `run({ harness, root, input, context })` replaces the default flow. Use it for subagents or several steps.
   Return the settled submission.
4. Add the object to `architectures/index.js`.
5. Run it with `AGENT_ARCH=<name>`.

`createTelemetryExtension(store, { only: [...] })` gives a subset of the tools, for example for a specialist subagent.

## Tools

| Group | Tools |
| --- | --- |
| Map | `list_services`, `get_service_health` |
| Metrics | `query_metric`, `top_endpoints`, `compare_windows` |
| Logs | `search_logs`, `log_patterns`, `logs_by_trace` |
| Traces | `find_traces`, `get_trace` |
| Changes | `list_changes` |
| Dependencies | `db_health`, `kafka_lag`, `dlq_sample`, `third_party_health` |
| Business | `business_kpis`, `stuck_orders`, `get_order_timeline` |
| Context | `list_alerts`, `get_runbook`, `past_incidents` |

Each windowed tool takes `from` and `to` (ISO UTC). The default window is the last hour before `now`.
`now` comes from the request, then `meta.json`, then the last metric point.
The tools remove user IDs, IPs, and user agents from their output.
`get_runbook` and `past_incidents` read `runbooks.json` and `incidents.json` in the data folder. These files do not exist yet,
so the tools say that no runbook or past incident is recorded.
