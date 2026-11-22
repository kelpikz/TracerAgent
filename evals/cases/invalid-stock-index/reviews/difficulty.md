# Difficulty review: invalid-stock-index

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 5/5 |
| Shortcut resistance | 5/5 |
| Depth | 4/5 |
| Cross-source evidence | 5/5 |
| Time reasoning | 5/5 |
| Partial-answer trap | 5/5 |
| Distractors | 5/5 |
| **Total** | **34/35** |

The blind-solve score is provisional. The reconstruction met the call-count and initial-hypothesis criteria after I had already seen the diagnosis. The four-call path also falls short of the five-call depth target.

## Blind solve

The initial read of `case.json` displayed the entire file. Its title and description disclosed the diagnosis before the first tool call. I did not open the seed, labels, graders, fixtures, or old reviews before writing this answer. The evidence reconstruction below cannot establish how hard the case is for an unprimed reviewer.

All times are UTC on November 20, 2026. The discovery call `--list` listed tools and their descriptions. The table includes unsuccessful CLI invocations. Calls issued together appear in request order.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `list_alerts {}` | Checkout paged at 11:31. Order errors followed at 11:36 and the notification DLQ at 11:51. | |
| 2 | `business_kpis {}` | In the last hour, 71.23% of 1,811 checkout attempts succeeded. The lowest minute was 24.14%. The stuck-order metric stayed at zero. | |
| 3 | `find_traces {"service":"order","status":"error","limit":5}` | PowerShell stripped the JSON quotes. The CLI returned a parse error. | The order path is the first lead. Checkout failures and order errors rose without a stuck-order buildup. Payment success fell less than checkout success. |
| 4 | `find_traces {"service":"order","status":"error","limit":5}` | With corrected quoting, failed checkout samples returned 503 after about two seconds, with catalog in the service list. The earliest shown was at 11:15:30. A separate Stripe webhook involved a carrier timeout. | The failed checkout requests point to a pre-payment catalog dependency. |
| 5 | `get_trace {"trace_id":"b7d0cc85fa05730e7a6803a116813532"}` | At 11:24:30, catalog's stock UPDATE timed out at 2,000 ms on `Lock:transactionid` with blocker PID 5089. Stock reserve and checkout returned 503. Order SQL completed. | Catalog Postgres row contention explains the checkout and order errors. Identify the blocker. |
| 6 | `search_logs {"service":"catalog","text":"5089","limit":12}` | Zero matches. | |
| 7 | `db_health {"db":"catalog"}` | The database stayed up with ordinary connections, disk and replica lag. Query p95 averaged 83.01 ms against 5.61 ms normal. Slow queries peaked at 866/min. The tool returned no slow-query samples. | The contention coexists with elevated query work. |
| 8 | `query_metric {"metric":"checkout_success_rate"}` | The tool returned an undefined-property error. | |
| 9 | `search_logs {"text":"5089","limit":12}` | Cron started `warehouse_stock_sync` at 11:15:00.693 with 42,161 rows, a Black Friday CSV and one transaction. PID 5089 was still progressing at 11:55. | The warehouse restock holds the locks. Look for earlier degradation before attributing it to volume alone. |
| 10 | `search_logs {"service":"catalog","level":"error","limit":8}` | 462 stock-reserve errors matched. The first was a timeout at 11:15:17.361. | |
| 11 | `search_logs {"service":"cron","text":"stock","from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z","limit":20}` | Stock-hold expiry lines crowded the first page. It also showed a routine 520-row sync at 06:15. | |
| 12 | `search_logs {"service":"catalog","text":"stock","from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z","limit":12}` | The first samples were successful reservations spanning before and after 06:41. | |
| 13 | `list_changes {"from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z"}` | The window contained a cart Redis client deploy at 09:40. | Look beyond tracked deploys for a stock database change. |
| 14 | `search_logs {"service":"cron","text":"index","from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z","limit":20}` | Between search refresh logs, migration `0142_stock_sku_warehouse_idx` dropped `stock_sku_idx` at 06:41:05.200. At 06:41:35.300 the concurrent replacement hit a lock timeout and left `index_valid=false`. | The migration left stock without its usable lookup index. The restock exposed the defect by holding row locks. |
| 15 | `search_logs {"service":"cron","text":"job=warehouse_stock_sync","from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z","limit":14}` | Five earlier runs each wrote 520 to 1,099 rows in one transaction. | |
| 16 | `search_logs {"text":"Seq Scan","limit":16}` | The space in the argument broke JSON quoting in PowerShell. The CLI returned a parse error. | |
| 17 | `search_logs {"service":"cron","text":"job=catalog_migrations","from":"2026-11-20T06:00:00Z","to":"2026-11-20T12:00:00Z","limit":14}` | The run began at 06:41:03.400 and ended at 06:41:35.800 with `completed_with_warnings`. The middle steps confirmed the drop and invalid replacement. | |
| 18 | `business_kpis {"from":"2026-11-20T11:15:00Z","to":"2026-11-20T12:00:00Z"}` | 62.14% of 1,334 attempts succeeded. The lowest minute was 24.14%. The stuck-order metric stayed at zero. | |
| 19 | `search_logs {"text":"scan","limit":12}` | Zero matches. | |
| 20 | `search_logs {"text":"stock_sku_warehouse_idx","limit":12}` | Zero matches in the last hour. | |
| 21 | `db_health {"db":"catalog","from":"2026-11-20T06:00:00Z","to":"2026-11-20T11:15:00Z"}` | Query p95 was as low as 3.82 ms early and was 93.25 ms at the end. Slow-query counts reached 890/min at 09:15. No query samples. | |
| 22 | `db_health {"db":"catalog","from":"2026-11-20T06:25:00Z","to":"2026-11-20T06:40:00Z"}` | Before the migration, query p95 averaged 4.81 ms and slow queries stayed at zero. | |
| 23 | `db_health {"db":"catalog","from":"2026-11-20T06:42:00Z","to":"2026-11-20T06:57:00Z"}` | After the migration, query p95 averaged 76.64 ms and slow queries averaged 12.69/min. The database stayed up. | The database slowdown began with the index change, hours before the lock storm. |
| 24 | `search_logs {"text":"scan","from":"2026-11-20T06:00:00Z","to":"2026-11-20T12:00:00Z","limit":12}` | Zero matches. | The exact plan remains an inference from the migration and the query slowdown. |

Answer: At 06:41, catalog migration `0142_stock_sku_warehouse_idx` dropped `stock_sku_idx` and timed out while building `stock_sku_warehouse_idx`, leaving an invalid replacement. Catalog Postgres query p95 rose from about 5 ms to 77 ms across the migration. The missing usable index implies scan-heavy stock lookups. At 11:15:00.693, the 42,161-row warehouse restock began one long transaction under PID 5089. Checkout's stock UPDATEs waited on that PID and timed out at two seconds, causing 503s before payment in the sampled trace. About 505 of 1,334 checkout attempts failed between 11:15 and noon. The worst minute was 24.14% successful and the stuck-pending metric stayed at zero. Pause new restock runs. Coordinate with the database and warehouse owners to abort and roll back PID 5089 if it is still the blocker. Restore a valid stock lookup index with a concurrent build, verify its validity and recheck checkout and locks. Then rerun the restock in smaller transactions. Verify the stock query plan and make the migration verify the replacement index before dropping the original. Correct: yes.

The seed and labels confirm the causal chain. The approximately 505 failures in the reconstruction include all unsuccessful checkout attempts. The narrower stock-reserve metric gives 467 failed reservations, and the Catalog error search gives 462 lock timeouts from the restock. The outcome rubric accepts the measured checkout success rate. It also calls for an explicit statement that the fault is active, an explicit drop of the invalid index before rebuilding it, and verification before retrying the restock.

## Shortest path

1. `find_traces {"route":"POST /checkout","status":"error","limit":3}` follows the paged endpoint. It returns multiple two-second 503s that touch Catalog and include no Payment spans. Open the 11:24 trace to identify the failing operation.
2. `get_trace {"trace_id":"b7d0cc85fa05730e7a6803a116813532"}` shows that Catalog's stock write timed out waiting on PID 5089. Check Catalog DB history to see whether the degraded write path predates that wait.
3. `query_metric {"name":"pg_query_p95_ms","labels":{"db":"catalog"},"from":"2026-11-20T06:00:00Z","to":"2026-11-20T12:00:00Z"}` shows a break in the 06:36 to 06:42 bucket. Its maximum was 78.60 ms, up from 5.40 ms in the preceding bucket. Use the start of the break and the stock operation to bound a cron log search that also covers the failing request.
4. `search_logs {"service":"cron","text":"stock","from":"2026-11-20T06:36:00Z","to":"2026-11-20T12:00:00Z","limit":400}` returns 341 rows. It shows both DDL steps at 06:41 and the 11:15 stock sync with PID 5089, including its progress through 11:55.

Four calls prove the cause with a bulk log result. A focused path takes five calls. Replace step 4 with a PID-filtered search of the last hour and a cron search around the metric break. A separate `business_kpis` call for 11:15 to 12:00 measures checkout impact.

The proof needs traces, DB metrics, and cron logs. The page provides the symptom and the endpoint. The trace's `blocking_pid` and the cron job's `pg_pid` identify the same transaction. The 06:41 DB step and the cron DDL rows establish when the latent fault began. Orders confirm the payment boundary. The changes list and the remaining alerts add context.

## Partial-answer test

The transcript used live results from `find_traces` for failed checkouts, `get_trace` for the 11:24 checkout, `search_logs` for PID 5089, and `business_kpis` for 11:15 to 12:00. The answer blamed the restock as the root cause. It matched the blocking PID, described the two-second reservation timeout, gave the measured impact and pre-payment boundary, and proposed rolling back the sync and verifying recovery. It omitted the migration, the earlier DB slowdown, and the index repair.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Restock-only diagnosis with correct mitigation and impact | 2.50/5 | 1.88/5 | 4.38/10 |

The deterministic checker awarded credit for the timeout, PID, impact, and payment boundary in the trajectory. The outcome earned credit for the lock wait, mitigation, and impact with status. The total was below half.

## Findings

1. **A wide cron search combines two evidence steps** (depth).
   - Evidence: A verified search returned all 341 stock-related cron rows in one result. It included both the index failure and the PID 5089 start and progress records. The shortest proof therefore uses four calls, even though two focused searches are easier to read.
   - Fix: Add a sampled sync-worker trace and use the job log to identify it. Put the evidence that the worker kept its stock writes in one open transaction on the trace. Keep the PID on the failed checkout span and the DDL in cron logs. That would make the worker trace necessary to prove the transaction scope.

2. **The diagnosis was visible before the tool investigation** (blind-solve validity).
   - Evidence: My initial command printed all of `case.json`, including the title and description. The call count describes an evidence reconstruction with an incomplete initial hypothesis. It gives no independent measure of unprimed difficulty.
   - Fix: Select the `input` field before printing the file and repeat the blind solve with a reviewer who has not seen the diagnosis.

### Fairness evidence

| Expected fact | Agent-visible evidence |
| --- | --- |
| Migration 0142 dropped the old index, hit a lock timeout on the concurrent build, left the replacement invalid, and reported warnings. | `search_logs` with `service=cron`, `text=job=catalog_migrations`, and 06:00 to 12:00 shows all four rows. The drop succeeded at 06:41:05.200. The build logged `index_valid=false` at 06:41:35.300. |
| Stock writes became slower at the migration. | `query_metric` for `pg_query_p95_ms` with `db=catalog` and 06:30 to 06:52 shows 4.99 ms at 06:40 and 78.60 ms at 06:41. `get_trace` shows successful stock UPDATEs of 4.57 ms at 06:03 and 53.12 ms at 06:45. Sync progress implies about 73 ms per row for the large run. |
| The restock started at 11:15 under PID 5089, had 42,161 rows to update in one transaction, and kept running. | `search_logs` for `5089` shows the start, the restock CSV, and 32,993 rows at 11:55. That is about 13.7 rows/s and implies about 51 minutes for the full run. Catalog timeout logs continued through 11:59. |
| Stock reservations waited on that transaction and returned 503 after two seconds. Checkout stopped before a charge. | `get_trace` on `b7d0cc85fa05730e7a6803a116813532` names the 2,000 ms wait and blocker PID. `get_order_timeline` on `ord_YP2SRG` ends at `CHECKOUT_FAILED` after the reservation 503. |
| The failure widened and remained active at noon. | `business_kpis` gives 62.14% success across 1,334 attempts from 11:15 to noon. The stock-reserve metric gives 467 failures across that window and 180 of 292 attempts in the last ten minutes. Catalog logs give 462 lock timeouts overall and 18 reservation errors in the final minute. |

All required root-cause facts are available through tools. The seed sets exact modeled execution times for ordinary sync runs. The generated data lets an agent estimate them from row counts and update speed. No query plan is available. The rubric treats a sequential scan as an inference.

### Shortcut checks

| Call | Result |
| --- | --- |
| `list_alerts {}` | Checkout success, Order error rate, and Notification DLQ alerts. |
| `search_logs {"level":"error"}` | 941 matches. The first samples show checkout and stock-reserve failures from 11:15:17. The DDL failure has info severity. |
| `log_patterns {}` | 462 each for Catalog lock waits, reserve failures, and Order checkout failures. Eight sync progress messages point toward the blocker. The result gives no sync start, trace-side PID, or migration. |
| `list_changes {}` | No last-hour changes. The preceding change was the 09:40 Cart Redis-client deploy. |
| `business_kpis {}` | 71.23% checkout success across 1,811 last-hour attempts. The result measures symptoms. |
| `third_party_health {"provider":"stripe"}` | Near-normal latency and zero error logs. |
| `third_party_health {"provider":"carrier"}` | One retry at 11:13 on an already-paid order. |
| `third_party_health {"provider":"email"}` | Three failed sends for one missing mailbox. |
| `search_logs` for `catalog_migrations` or `stock_sku_warehouse_idx` | Both return zero in the default window. The stock-index search widened to 06:00 returns all four migration log rows. |
| `search_logs` for `warehouse_stock_sync` or `bf_restock_2026-11-20.csv` | A targeted search in the last hour reveals the 11:15 workload trigger. The job-name search also shows progress. |
| `search_logs {"service":"cron","text":"migration step","from":"2026-11-19T12:00:00Z"}` | Seven rows name the underlying defect. Read the retry of the prior Catalog migration before concluding which index stayed invalid. |

No default call exposes the underlying trigger or proves the checkout cause. The alerts and changes alone point toward Order or the Cart deploy. They contain no evidence that would let an agent infer the failed stock index. A widened keyword search can expose the DDL in one call. Correlating it to the DB step and the checkout blocker still takes other results.

### Time reasoning

The replacement index failed 4 hours, 49 minutes, and about 25 seconds before the page. The restock started about 16 minutes before the page, roughly 4 hours and 33 minutes after the index failure. The default 11:00 to noon window includes the restock and excludes the migration. Catalog DB latency rose in the 06:41 minute. An early reservation timed out at 10:15 on the routine sync's PID 9296. The sustained checkout failure began after the 11:15 bulk run. Checkout success was 88.34% during 11:15 to 11:25 and 35.27% during 11:50 to noon, as the restock accumulated locks.

### Distractors

| Signal | Check that rejects it |
| --- | --- |
| 11:15 Black Friday restock as the root cause | Match its PID to the checkout wait and match the earlier metric step to failed DDL. The restock explains the timing and scope of the lock storm. |
| 11:36 Order error alert | The failed checkout trace shows successful Order SQL and a failed Catalog stock write. |
| 09:40 Cart Redis-client deploy and the older Catalog deploy | `list_changes` timestamps both. The first sustained DB step is at 06:41 and matches the cron migration. The failed span is a Catalog Postgres write and there is no Cart hop. |
| Newsletter traffic from 10:00 to 10:30 | Gateway health shows the traffic spike with ordinary latency and errors. The tagged newsletter trace shows a 200 product read on the replica. Sustained checkout failures began at 11:15. |
| Catalog garbage collection and the 11:37 p99 spike | `search_logs` for `GC pause` gives a 1.51-second pause. The matching time has a slow product read with HTTP 200. The 11:24 checkout already had a Postgres lock wait and returned 503. |
| Normal-looking aggregate Catalog p95 and DB uptime, connections, disk, and replica lag | `get_service_health` shows Catalog p95 averaging 65.3 ms versus 62 ms normal. `db_health` shows Catalog DB query p95 averaging 83.01 ms versus 5.61 ms normal. The trace isolates the failing stock endpoint. |
| Prior Catalog migration 0141 | Cron shows the first build timed out and its retry built a valid products index. |
| Orders migration 0087 and Catalog stats refresh | The Orders build logs `index_valid=true`. The stats refresh finishes at 06:30:15, and Catalog query p95 is still 4.99 ms at 06:40. |
| Routine cron traffic, including stock-hold expiry, search refresh, cleanup, sitemap, and exchange rates | Match each row by job and outcome. Stock-hold expiry and search refresh repeat before and after the break. Search refresh concerns `products_v3`. The DDL rows name the broken stock lookup index. |
| Node-3 sales report | The report ends at 06:11:40, and `node_cpu_pct` has dropped to 31% at 06:12. The DB step occurs at 06:41. |
| Gateway rate-limit change and PriceGrabber scraper | The recurring 429 trace is for `GET /products` at 11:07. The affected checkout returns 503 after a Catalog stock lock wait. |
| Notification DLQ at 11:51 and the older Notification deploy | The DLQ samples show rejected mailboxes on `delivery.updated`. Consumer lag stays near normal. The checkout trace fails before payment or delivery. |
| Stripe, payment success dip, and carrier timeout | Stripe has zero error logs and normal latency. The checkout trace stops before payment. The carrier retry is on a separate Stripe webhook flow for an already-paid order. |

I investigated Order first because of its error alert. The trace moved the investigation to Catalog. The PID search identified the restock, and the searches for older stock logs and changes tested whether it explained the whole incident. The broad stock search first returned routine expiry lines, and the change search returned the Cart deploy. The migration logs and earlier DB step resolved both leads.

