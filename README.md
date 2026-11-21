# TracerAgent: seeded telemetry

Fake telemetry for the shop in `system-design.html`. Use it to test the triage agent.

## Run

```
python seed/generate.py
```

Then open `dashboard/index.html` in a browser. A server is not necessary.

## Scenarios

| Scenario | What it shows |
|---|---|
| `baseline` | All services are healthy. Normal daily traffic. 3 deploys and 1 config change, with no impact. |

To open a different scenario: `dashboard/index.html?scenario=<name>`.
Deep links: `#traces/<trace_id>`, `#orders/<order_id>`.

## Noise

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

## Output: `data/<scenario>/`

| File | Contents |
|---|---|
| `metrics.json` | 140 series, 1 point per minute, 24 hours. Values only. Time = `start + i * step_s`. |
| `logs.jsonl` | One JSON log line per row, with `trace_id` when there is one. |
| `traces.json` | Sampled traces. Each span has `offset_ms` from the trace start. |
| `orders.json` | Each sampled checkout, with its full timeline and trace IDs. |
| `events.json` | Deploys and config changes. |
| `alerts.json` | Alert rules, the alerts that fire now, and the alert history. |
| `topology.json` | Services, calls, Kafka topics and consumer groups, endpoints. |
| `data.js` | All of the above in one file, for the dashboard. |

## What "normal" looks like

- Traffic is lowest at 04:00 UTC and highest at 16:00 UTC.
- 5xx rate is 0.05–0.2%. Low-traffic services have spiky error rates, because one error is a large share.
- Some errors are normal: 3 single 5xx errors, carrier timeouts that a retry fixes, card declines (402), wrong passwords (401), 404s, a few 429s.
- The notification DLQ has 2 old messages. The count does not change. This is normal.
- Disk use on Postgres grows slowly.

## Assumptions not in the design

- Order consumes `payment.succeeded` and `delivery.updated`. Delivery consumes `order.paid`.
- Metrics use 1-minute points. The real scraper uses 15 seconds.

## Same seed, same data

`SEED = 42` in `seed/generate.py`. A run with the same seed gives the same data.

## Evals

Install the dependencies. Install the `pi` CLI and make sure that it is on your PATH.
The LLM graders use `pi` with your ChatGPT subscription. To sign in, run `pi auth login openai-codex`.
If `pi` is missing or you are signed out, the runner skips the LLM graders.

Run the smoke test to check the replay agent and all four graders.

```sh
npm install
npm run eval -- list
npm run eval -- run smoke
npm run eval -- run noise-price-import-replica-lag
npm run eval -- run --all
npm run eval -- run smoke --agent-model openai-codex/gpt-6.2-astra --agent-effort low
npm run eval -- run smoke --judge-model openai-codex/gpt-6.2-astra --judge-thinking low
```

Use `--run-id <id>` to set the run ID. Use `--agent-model <provider/id>` and
`--agent-effort <level>` to set the agent for a run. Use `--judge-model <provider/id>` and
`--judge-thinking <level>` to set the judge for a run. These flags also work with `run --all`.
Put the flags in any order. The agent and judge levels are `off`, `minimal`, `low`, `medium`, `high`,
`xhigh`, and `max`.

The runner calculates a score out of 10. Each grader can give up to 5 points.
The runner takes the mean of the numeric item scores in each completed part.
It takes the mean of the available part scores and multiplies it by 5.
If a grader has no part score, the total is unavailable.
Otherwise, the total is the sum of the two grader scores. The runner rounds scores to two decimal places.

To browse the cases, run `npm run eval:ui`. It builds the UI and starts the server. The server restarts by itself when `evals/server.js` or a harness file changes. After a UI change, run `npm run ui:build` and refresh the page. You do not need to restart the server.
Open `http://127.0.0.1:4317` in a browser. Set `PORT` to use a different port.
Open **Run settings** to select the agent and judge for the next run.

Use `GET /api/judge/options` to get the agent and judge defaults, model list, and levels.
The server keeps the model list for five minutes.
Use `POST /api/cases/:id/run` to start a run. The request body accepts an `agent`
object with `model` and `effort` and a `judge` object with `model` and `thinking`.
The server uses the defaults for fields that you omit.

Each case has a **Dashboard** tab. It shows the telemetry dashboard for the scenario and noise of the case. On wide screens, **Split view** shows the dashboard next to the results. Links in the transcript open a trace or an order in the dashboard.

Open **Info** to see the failure, its trigger, the affected systems, and the answer the outcome grader expects. The tab reads optional `info` from `case.json` and shows the scenario labels for the case's noise IDs. Use the telemetry links to open evidence in **Dashboard**. A case with `info` opens on **Info** before its first run.

The UI is a React app in `evals/ui/src`. It uses Vite, Tailwind CSS, and shadcn/ui.

- `npm run ui:build` builds the UI into `evals/ui/dist`. The server needs this folder.
- `npm run ui:dev` starts the Vite dev server with hot reload. Start `node evals/server.js` first. The dev server sends `/api`, `/dashboard`, and `/data` requests to port 4317.

- Set `EVAL_AGENT_CMD` to run your agent. You can also set `agent.command` in `evals/config.json`. The environment variable takes priority. If both are empty, the runner uses `sample_transcript.json`.
- The agent command receives `model` and `effort` in the JSON on standard input.
  The replay agent ignores these fields.
- Each run writes a JSON file to `evals/results/<case-id>/`. Open an earlier run from **Run history**.

| Environment variable | Default | Use |
| --- | --- | --- |
| `EVAL_AGENT_MODEL` | `openai-codex/gpt-6.2-sol` | Set the default agent model in `provider/model` format. |
| `EVAL_AGENT_EFFORT` | `high` | Set the default agent effort. |
| `EVAL_JUDGE_MODEL` | `openai-codex/gpt-6.2-sol` | Set the default model in `provider/model` format. |
| `EVAL_JUDGE_THINKING` | `high` | Set the default thinking level. |
| `EVAL_PI_CMD` | `pi` | Set the executable name or path. On Windows, use `pi.cmd` for a full path. |
| `EVAL_JUDGE_TIMEOUT_S` | `600` | Set the time limit in seconds for each `pi` command during a run. |

For the case files and agent input and output, see the [eval file contract](evals/harness/transcript.md).
Use the [create-eval-case skill](.claude/skills/create-eval-case/SKILL.md) to write a case. Run `node .claude/skills/create-eval-case/scripts/check-case.js <case-id>` to check its graders.
