# Run TracerAgent yourself

This guide tells you how to make the data, run the cases with an agent, and run a full benchmark.
For what the project is, see the [README](README.md).

## What you need

- **Node.js** 22 or newer.
- **Python** 3.10 or newer. The seed script uses only the standard library.
- **The `pi` CLI**, on your `PATH`. The agent and the LLM judge use it to get model access.

Sign in once:

```sh
pi auth login openai-codex
```

The sign-in goes to `~/.pi/agent/auth.json`. It is not in the repo.
API keys in environment variables (for example `ANTHROPIC_API_KEY`) also work for the agent.
If `pi` is missing or you are signed out, the runner skips the LLM graders.

## Quick start

```sh
npm install
npm run eval -- data --all                          # make the data for all cases
npm run eval -- list                                # show the cases
npm run eval -- run noise-price-import-replica-lag  # run one case
```

The result goes to `evals/results/<case-id>/`. The data goes to `data/<case-id>/`. Git ignores both folders.

## Run the cases

```sh
npm run eval -- run --all
npm run eval -- run <case-id> --agent-model openai-codex/gpt-6.2-astra --agent-effort low
npm run eval -- run <case-id> --judge-model openai-codex/gpt-6.2-astra --judge-thinking low
```

| Flag | Use |
| --- | --- |
| `--agent-model <provider/id>` | The model for the agent. |
| `--agent-effort <level>` | The reasoning effort for the agent. |
| `--agent-arch <name>` | The agent architecture: `single` (the default) or `multi`. |
| `--agent-roles <json>` | Model and effort for each `multi` agent, for example `{"critic":{"effort":"xhigh"}}`. |
| `--judge-model <provider/id>` | The model for the LLM graders. |
| `--judge-thinking <level>` | The thinking level for the LLM graders. |
| `--run-id <id>` | Set the run ID. |

The levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh` and `max`.
Put the flags in any order. They also work with `run --all`.

For example, to run one case with the team of agents:

```sh
npm run eval -- run <case-id> --agent-arch multi
```

## Run a benchmark

A benchmark runs every combination of model × architecture × effort on each case you select, a number of times.

1. Start the eval UI:

   ```sh
   npm run eval:ui
   ```

2. Open `http://127.0.0.1:4317` in a browser.
3. Open **Benchmarks** and select **New benchmark**.
4. Select the models, architectures, efforts, cases, repeats and the number of parallel runs. Then start it.

A background worker runs the benchmark. You can stop it and resume it later.
The benchmark file goes to `evals/results/benchmarks/<id>.json`, with a log file next to it.
To run a saved benchmark from the terminal, use `npm run eval -- bench <benchmark-id>`.

Note: a large benchmark makes many model calls. For example, 2 models × 2 architectures × 4 efforts × 9 cases × 3 repeats is 432 agent runs, and each run also calls the judge.

## How the score works

The runner calculates a score out of 10. Each grader (trajectory and outcome) can give up to 5 points.

1. The runner takes the mean of the numeric item scores in each completed part (JavaScript checks and LLM judge).
2. It takes the mean of the available part scores and multiplies it by 5.
3. The total is the sum of the two grader scores. If a grader has no part score, the total is unavailable.

The runner rounds scores to two decimal places.

## The eval UI

`npm run eval:ui` builds the UI and starts the server. The server restarts by itself when `evals/server.js` or a harness file changes. Set `PORT` to use a different port.

- **Run settings:** select the agent and the judge for the next run.
- **Dashboard tab:** shows the telemetry for the case. **Split view** shows it next to the results. Links in the transcript open a trace or an order.
- **Info tab:** shows the fault, its trigger, the affected systems and the answer that the outcome grader expects.
- **Run history:** open an earlier run.

The UI is a React app in `evals/ui/src`. It uses Vite, Tailwind CSS and shadcn/ui.

- `npm run ui:build` builds the UI into `evals/ui/dist`. The server needs this folder. After a UI change, build again and refresh the page.
- `npm run ui:dev` starts the Vite dev server with hot reload. Start `node evals/server.js` first. The dev server sends `/api`, `/dashboard` and `/data` requests to port 4317.

### API

- `GET /api/judge/options` gives the agent and judge defaults, the model list and the levels. The server keeps the model list for five minutes.
- `POST /api/cases/:id/run` starts a run. The body accepts an `agent` object with `model` and `effort`, and a `judge` object with `model` and `thinking`. The server uses the defaults for fields that you do not give.

## Use your own agent

The runner starts the agent as a command. It sends a JSON request on standard input and reads the transcript from standard output.

- Set `EVAL_AGENT_CMD`, or set `agent.command` in `evals/config.json`. The environment variable takes priority. The default is `node agent/cli.js`.
- The request includes `model` and `effort`.
- For the full input and output format, see the [eval file contract](evals/harness/transcript.md).

To add an architecture to the included agent, see [`agent/README.md`](agent/README.md#add-an-architecture).

## Environment variables

| Variable | Default | Use |
| --- | --- | --- |
| `EVAL_AGENT_CMD` | `agent.command` in `evals/config.json` | The command that runs the agent. |
| `EVAL_AGENT_MODEL` | `openai-codex/gpt-6.2-sol` | The default agent model, in `provider/model` format. |
| `EVAL_AGENT_EFFORT` | `high` | The default agent effort. |
| `EVAL_JUDGE_MODEL` | `openai-codex/gpt-6.2-sol` | The default judge model, in `provider/model` format. |
| `EVAL_JUDGE_THINKING` | `high` | The default judge thinking level. |
| `EVAL_PI_CMD` | `pi` | The `pi` executable name or path. On Windows, use `pi.cmd` for a full path. |
| `EVAL_JUDGE_TIMEOUT_S` | `600` | The time limit in seconds for each `pi` command during a run. |
| `EVAL_PYTHON` | `python` | The Python command that makes the case data. |
| `AGENT_ARCH` | `single` | The agent architecture when the request does not give one. |
| `AGENT_MULTI_CONFIG` | `agent/architectures/multi-agent.json` | A different config for the `multi` agents. |
| `PORT` | `4317` | The port for the eval UI. |

## Write a new case

Use the [create-eval-case skill](.claude/skills/create-eval-case/SKILL.md) to write a case.
To check its graders, run:

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id>
```

Real faults for cases are in `seed/incidents.py`. Noise items are in `seed/noise.py`.

---

## The telemetry data

### Make data by hand

```sh
python seed/generate.py
```

This writes the `baseline` scenario to `data/baseline/`. All services are healthy, with normal daily traffic, 3 deploys and 1 config change with no impact.

Then open `dashboard/index.html` in a browser. You do not need a server.

- To open a different scenario: `dashboard/index.html?scenario=<name>`.
- Deep links: `#traces/<trace_id>` and `#orders/<order_id>`.

`SEED = 42` in `seed/generate.py`. A run with the same seed gives the same data.

### Noise

Noise looks like a problem, but it is not. Use it to test if the agent can tell noise from a real incident.
There are 12 noise items in `seed/noise.py`. Each item is an overlay on the baseline.

- **Dashboard:** open the **Noise** tab. Each toggle turns on one item. All tabs show the result.
  The **i** button shows the truth. The URL keeps your choice: `?noise=nightly_backup,price_scraper`.
- **Files for the agent:** `python seed/generate.py --noise all` writes `data/noisy/`.
  Use `--noise <id>,<id>` for some items and `--name <scenario>` for a different folder.
  `labels.json` has the truth for each item. Use it to grade the agent. Do not give it to the agent.

| # | id | When (UTC) | Alerts |
|---|---|---|---|
| 1 | `night_declines` | 03:00–05:00 | PaymentSuccessLow, CheckoutSuccessLow |
| 3 | `dlq_deleted_users` | 5 times a day | DlqGrowing (the last one is still firing) |
| 6 | `stuck_3ds` | from 11:26 | none |
| 7 | `nightly_backup` | 02:00–02:45 | none |
| 8 | `price_import` | 00:30–00:42 | ReplicaLagHigh |
| 9 | `redis_keys_scan` | 00:00–00:02 | none |
| 10 | `notification_oom` | about every 6 h | none |
| 11 | `catalog_gc` | every 40 min | none |
| 12 | `node3_report` | 06:00–06:12 | none |
| 13 | `carrier_maintenance` | 01:00–01:15 | ThirdPartyErrors |
| 14 | `newsletter_spike` | 10:00–10:30 | none |
| 15 | `price_scraper` | every hour at :07 | none |

Logs from scheduled jobs use the service name `cron`.

### Incidents

An incident is a real fault for an eval case. Incidents are in `seed/incidents.py` and use the same overlays as noise.
Each incident also makes the text for the Info tab of the eval page.

```sh
python seed/generate.py --incidents stripe_webhook_secret --noise price_scraper --name <case-id>
```

This writes one incident and one noise item to `data/<case-id>/`.

### Output files: `data/<scenario>/`

| File | Contents |
|---|---|
| `metrics.json` | 140 series, 1 point per minute, 24 hours. Values only. Time = `start + i * step_s`. |
| `logs.jsonl` | One JSON log line per row, with `trace_id` when there is one. |
| `traces.json` | Sampled traces. Each span has `offset_ms` from the trace start. |
| `orders.json` | Each sampled checkout, with its full timeline and trace IDs. |
| `events.json` | Deploys and config changes. |
| `alerts.json` | Alert rules, the alerts that fire now, and the alert history. |
| `topology.json` | Services, calls, Kafka topics and consumer groups, endpoints. |
| `meta.json` | Scenario, seed, window start and end, and `now` (the window end). |
| `data.js` | All of the above in one file, for the dashboard. |

### What "normal" looks like

- Traffic is lowest at 04:00 UTC and highest at 16:00 UTC.
- 5xx rate is 0.05–0.2%. Low-traffic services have spiky error rates, because one error is a large share.
- Some errors are normal: 3 single 5xx errors, carrier timeouts that a retry fixes, card declines (402), wrong passwords (401), 404s, a few 429s.
- The notification DLQ has 2 old messages. The count does not change. This is normal.
- Disk use on Postgres grows slowly.

### Assumptions not in the design

- Order consumes `payment.succeeded` and `delivery.updated`. Delivery consumes `order.paid`.
- Metrics use 1-minute points. The real scraper uses 15 seconds.
