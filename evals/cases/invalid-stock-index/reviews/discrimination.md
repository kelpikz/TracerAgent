# Discrimination review: invalid-stock-index

| Part | Score |
| --- | --- |
| Difficulty | 3/5 |
| False leads | 5/5 |
| Input | 5/5 |
| Depth | 5/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

1. Find a failed checkout with `find_traces` for `POST /checkout` from 11:00 UTC. The first sampled failure gives trace `3d69e65bf747ca49a4a070e55c48fc20`.
2. Read that trace with `get_trace`. The Catalog `pg UPDATE stock` span waits on `Lock:transactionid` and times out at 2,000 ms. Its `blocking_pid` is 5089. Catalog returns 503 and the request stops before Payment.
3. Search `cron` logs for `pg_pid=5089`. The 11:15 start matches the blocker and shows 42,161 restock rows in one transaction. Progress after the trace confirms the run continues. At 11:55 it has updated 32,993 rows.
4. Run `query_metric` for `pg_query_p95_ms` with `db=catalog` from 04:00 to 12:00 UTC. The 06:32 bucket reaches 5.4 ms. The next bucket, covering 06:40 through 06:47, reaches 81.53 ms. The step predates the restock by hours.
5. Search `cron` logs from 06:35 to 06:48 UTC. Migration 0142 drops `stock_sku_idx` at 06:41. Its concurrent build of `stock_sku_warehouse_idx` fails with a lock timeout and logs `index_valid=false`. The failure falls inside the bucket where DB latency rises.

Five calls establish the cause. A sixth call to `business_kpis` measures impact. A weak agent can find the lock holder and stop at step 3. Step 4 exposes the earlier slowdown that step 5 explains.

## False leads

- The 11:15 restock: Blame the 42,161-row transaction because its PID holds the locks / Check Catalog DB p95 before the restock and match the 06:41 step to the failed index build.
- The 11:36 Order alert: Blame Order because it emits 503s / Follow a failed checkout trace to the Catalog stock update that timed out first.
- The 09:40 Cart Redis-client deploy: Roll back the most recent change / Check the failing trace for Cart and compare the deploy time with the earlier Catalog DB step.
- The previous day's Catalog deploy: Blame the last recorded change to the service that fails / Query Catalog DB p95 across the overnight window and check what changed at the actual step.
- The newsletter spike: Blame Black Friday traffic or rate-limit it / Compare the 10:00 to 10:30 traffic spike with the sustained failures after 11:15. Newsletter traces read from the Catalog replica. The isolated 10:15 checkout failure also shows a stock lock wait, with a different blocker.
- Catalog GC: Explain slow checkout with the 11:37 GC warning or the p99 spikes / Compare the brief, recurring product-read pauses with failed checkout traces. The 2 s wait is on a stock write in Postgres.
- Normal Catalog p95 and healthy Postgres uptime and replica lag: Clear Catalog or the database based on aggregate health / Check `POST /stock/reserve`, query latency on the Catalog DB, and the lock wait on the failed span.
- The 03:10 Orders migration and 06:30 Catalog stats refresh: Blame the wrong index build or suspect a query-plan change / Check `index_valid=true` for the Orders build and confirm that Catalog DB p95 stays near baseline after the stats refresh, until 06:41.
- Routine cron jobs: Treat recurring stock hold expiry or the 06:39 product search index refresh as the cause / Compare earlier successful runs and check the job and index names on the failed DDL.
- The node-3 report: Blame the CPU spike for the DB slowdown / Check the report finish at 06:11 and the later Catalog DB step.
- The PriceGrabber burst and Gateway rate-limit config: Blame throttling for checkout failures / Check that the recurring 429s affect `GET /products` and that failed checkouts return 503 after a Catalog lock wait.
- The 11:51 Notification DLQ and 03:30 Notification deploy: Treat the new alert as a blocked checkout workflow / Check the DLQ entry for the deleted mailbox on `delivery.updated` and trace the checkout failure to a step before payment or delivery.
- Payment or Stripe: Read fewer callbacks as provider trouble / Check Stripe errors and the spans or order timeline. The failed reservation stops checkout before the payment request.

## Test transcripts

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent: proves the blocker and stops at the restock | 2.50/5 | 1.88/5 | 4.38/10 |
| Good agent: starts with Order endpoints and checks DB history before the sync logs | 5.00/5 | 5.00/5 | 10.00/10 |

The checker used the deterministic graders. Both transcripts used live tool results. The weak agent ran `top_endpoints`, `get_trace`, the PID log search, and `business_kpis`. The good agent checked Catalog DB history and the 06:41 cron window before mapping the PID, then measured impact. The sample maps the PID before querying DB history.

## Findings

1. **One broad cron search names the root defect**
   - Evidence: The page and a last-hour Order log search show symptoms. `alerts.json` and `events.json` alone give no evidence of the index failure. A full-day `search_logs` call for `service=cron`, `text="migration step"`, and `from="2026-11-19T12:00:00Z"` gives four rows. They include the successful old-index drop and the sole invalid index build. Filtering for `result=error` returns the failed build alone. Both searches expose the defect before the agent links it to checkout.
   - Fix: Add plausible, recovered migration failures with visible retry results. Preserve the evidence that links the unresolved stock index failure to the latency step and failed checkouts.

2. **The page gives a symptom and enough context to start**
   - Evidence: The input says `CheckoutSuccessLow [critical] at 2026-11-20 11:31 UTC`, `checkout_success_rate 82.8% < 90% for 10m`, and `Current time: 2026-11-20 12:00 UTC.` It names the alert, severity, time, rule, observed value, and current time. The request for cause, impact, and action gives no clue to the faulty service, change, or fix.
   - Fix: Keep the input as written.

3. **The outcome grader rewards an unverified lock theory**
   - Evidence: The restock-only transcript scores 4.38/10, below half, and the good transcript scores 10.00/10. A third transcript runs only the full-day migration search and offers a plausible stock sync and lock theory with a conditional mitigation. It gets 0.63/5 on trajectory and 4.38/5 on outcome, for 5.01/10 as displayed. The migration is supported. The slow sync, lock wait, and mitigation target have no supporting tool result.
   - Fix: Keep credit for the logged DDL and a valid index repair. Tie full credit for the slow sync, lock mechanism, and immediate mitigation to evidence for those claims.

4. **A sync start row earns full credit for an open transaction**
   - Evidence: The good transcript still scores 10.00/10 when the PID search is limited to the start row and the final answer drops its progress citation. The trace proves the run blocked a reservation at 11:23. It gives no evidence that the same transaction remains open at noon.
   - Fix: Credit the PID match at trace time. Require a later progress row or equivalent evidence before awarding full credit for the ongoing blocker and immediate mitigation.

5. **The expected impact numbers differ from the generated data**
   - Evidence: From 11:15 to 12:00 UTC, the current tools show 62.14% checkout success across 1,334 attempts. The metric sums to 467 stock-reserve failures and the Catalog logs show 462 statement timeouts. The grader prompts still use 465 and 460, and the outcome prompt and good fixture's answer use 62.3%.
   - Fix: Refresh the examples from the generated metrics and logs. Keep tolerance for rounded figures and clearly named windows.
