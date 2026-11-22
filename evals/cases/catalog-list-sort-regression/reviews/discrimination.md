# Discrimination review: catalog-list-sort-regression

| Part | Score |
| --- | --- |
| Difficulty | 2/5 |
| False leads | 4/5 |
| Input | 5/5 |
| Depth | 3/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

1. Subtract the ten-minute evaluation window from the 11:22 page. Run `search_logs` from 11:12 to 11:13 UTC without a service filter. Catalog loads `default_sort=supplier_rank` in v1.9.0. A later row records an HTTP 200 list query on the replica that took 324 ms for shoes. It includes the trace ID.
2. Run `get_trace` on that ID. The replica SELECT took 323.67 ms of the 328.58 ms request. Its attributes show `supplier_rank NULLS LAST, id`, a sequential scan followed by a top-N heapsort, and 122,400 qualifying rows to return 24.

The shortest path takes two tool calls. The slow-query log and `db_health` samples now provide the trace ID and omit the query plan. A weak agent that stops before opening the trace can identify the likely change and slow dependency. It still needs the replica span to explain how the query spends its time. An alert query identifies Catalog, and gateway endpoint rankings surface `GET /products` behind checkout by absolute sampled p95. An agent reading only `alerts.json` and `events.json` can guess the 11:12 merchandising rollout from the coincident alerts. Those files omit the sort and plan.

The input gives `ServiceLatencyHigh [warning] at 2026-11-20 11:22 UTC` and `http_latency_p95_ms{service=gateway} 385.9ms > 2x normal for 10m`. It includes severity, time, rule, measured value, and `Current time: 2026-11-20 12:00 UTC.` The gateway label identifies where latency appeared. The page omits Catalog and the rollout.

## False leads

- A 1,510 ms Catalog GC pause at 11:37 gives a weak agent a reason to increase heap size. Compare the recurring GC warnings and p99 spikes with Catalog p95. The preceding pause was at 10:57. Catalog p95 jumped at 11:12 and stayed elevated between pauses. The shoes trace spends most of the request in the replica query.
- The price scraper raises traffic and triggers 429s on `GET /products` at 11:07 and 11:08. A weak agent may blame the scraper or the earlier rate-limit change. Catalog p95 is 62.5 and 68.5 ms in those two minutes. It rises to 343.1 ms at 11:12, when slow product lists return 200.
- Catalog database query latency rises. A weak agent may attribute it to replication lag. `db_health` shows lag peaks at 0.96 s while query p95 reaches 407.3 ms. The trace shows the delay on a replica SELECT with a sequential scan and sort.
- Gateway checkout has a sampled p95 of about 530 ms and ranks above lists. A weak agent may identify checkout as the main degradation. Compare endpoint baselines and business KPIs. The Order service baseline for checkout is 430 ms. Catalog lists run at 403 ms against 62 ms normal, and checkout and payment show no matching failure window.
- A books list at 11:12:59 returns HTTP 200 in about 11 ms with the same sort and an index scan. A weak agent may sample only that request and dismiss a list-query regression. Compare the qualifying row count and plan with the much larger shoes category.

## Test transcripts

I rebuilt the transcripts with real tool results from freshly generated case data. I ran `check-case.js` on the transcripts under `evals/results/discrimination-review-abc/`. These are deterministic scores.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent reads alert history, sees a GC warning and slow list samples, and recommends more heap. | 2.50/5 | 1.67/5 | 4.17/10 |
| Good agent starts with alert history and gateway routes, uses database health to find a trace, then checks the rollout, Catalog routes, KPIs, p95, and GC. | 5.00/5 | 5.00/5 | 10.00/10 |
| Logs and alerts establish the new sort and ongoing page. The answer leaves the plan open. | 1.67/5 | 3.33/5 | 5.00/10 |
| Logs and a slow trace establish the cause in two calls. The answer leaves noon status open. | 2.50/5 | 3.33/5 | 5.83/10 |
| Logs, a slow trace, and an alert check establish cause and ongoing status in three calls. | 3.33/5 | 5.00/5 | 8.33/10 |
| Logs and the fast books trace establish the rollout. The sampled query used an index scan. | 0.83/5 | 1.67/5 | 2.50/10 |

The GC answer earns outcome credit for correctly identifying ongoing latency. Explicit denials earn 0.00/5 for outcome. Proposed checks and open questions earn 1.67/5 for the independently supported status. The fast books trace earns credit for the rollout and zero for the slow replica plan.

## Findings

1. **Three calls earn full outcome credit without measuring customer scope**
   - The shortcut establishes the cause and ongoing status. It never checks the extent of the list slowdown, compares product details, or checks stock and checkout. Impact scope is absent from the deterministic outcome checks.
   - Score customer scope in the deterministic outcome. Accept a supported list-latency measurement and a comparison with product details, stock, or checkout.
2. **One short onset search gives the change and a direct link to the plan**
   - The plan has moved into a trace, so the earlier one-search diagnosis no longer establishes the mechanism. The 11:12 settings row and slow-query samples still appear in the same result, with a trace ID in the samples. The alert window supplies the search time.
   - Keep the slow-query trace ID. To extend the shortest path, place the concrete sort value in a separate deployment or configuration result so the investigation has to confirm the active default independently.
