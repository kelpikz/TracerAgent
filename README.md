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

## Output: `data/<scenario>/`

| File | Contents |
|---|---|
| `metrics.json` | 140 series, 1 point per minute, 24 hours. Values only. Time = `start + i * step_s`. |
| `logs.jsonl` | One JSON log line per row, with `trace_id` when there is one. |
| `traces.json` | Sampled traces. Each span has `offset_ms` from the trace start. |
| `orders.json` | Each sampled checkout, with its full timeline and trace IDs. |
| `events.json` | Deploys and config changes. |
| `alerts.json` | Alert rules and the alerts that fire now. |
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
