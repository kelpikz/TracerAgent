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
