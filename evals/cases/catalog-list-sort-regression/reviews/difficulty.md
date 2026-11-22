# Difficulty review: catalog-list-sort-regression

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 5/5 |
| Shortcut resistance | 2/5 |
| Depth | 2/5 |
| Cross-source evidence | 4/5 |
| Time reasoning | 2/5 |
| Partial-answer trap | 5/5 |
| Distractors | 5/5 |
| **Total** | **25/35** |

## Blind solve

All times are UTC on Nov 20, 2026. Window arguments below abbreviate the ISO timestamps passed to the tool. Whole minutes have zero seconds. `W` means `from=11:00, to=12:00`. `trace_id` values are shown in full. Discovery and call errors count toward the 30-call limit.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `--list` | Found tools for endpoint latency, service metrics, traces, database health, and changes. | |
| 2 | `top_endpoints`, `service=gateway, by=latency, W` | PowerShell stripped JSON quotes. The call returned a parse error. | |
| 3 | `get_service_health`, `service=gateway, W` | The same quoting error blocked this call. | First hypothesis after three invocations. An upstream request path may explain the gateway tail. The page alone leaves the route and cause open. |
| 4 | `top_endpoints`, `service=gateway, by=latency, W` | `GET /products` had 115 samples and 405 ms p95. `POST /checkout` ranked higher at 530 ms p95 across six samples. Product detail p95 was 11.88 ms. | Listing and checkout both warrant a trace check. |
| 5 | `get_service_health`, `service=gateway, W` | Gateway latency rose at 11:12. Traffic had peaked at 181.13 req/s at 11:07, and errors stayed near baseline. | Recent traffic could have affected the tail. |
| 6 | `list_alerts`, `{}` | Catalog and gateway paged at 11:22. Both alerts remained open at noon. | After the first three successful calls, my leading hypothesis was catalog listing contention after the traffic spike. Checkout could have been separate. |
| 7 | `get_service_health`, `service=catalog, W` | Catalog p95 and p99 rose at 11:12. CPU peaked with traffic at 11:07. All three pods stayed ready and none restarted. | The latency rise outlasted the load peak. |
| 8 | `find_traces`, `service=gateway, route=GET /products, min_duration_ms=300, from=11:12, to=11:30, limit=4` | PowerShell split the route value. The call returned a parse error. | |
| 9 | `list_changes`, `W` | Catalog v1.9.0 replaced v1.8.2 in a listing merchandising rollout at 11:12. The prior change was a 09:40 Cart Redis client deploy. | The rollout matched the latency onset. It overtook the traffic hypothesis. |
| 10 | `find_traces`, `service=gateway, route=GET /products, min_duration_ms=300, from=11:12, to=11:30, limit=4` | Found 36 slow list traces. All four shown returned 200. The first took 328.58 ms and ran through gateway and Catalog. | |
| 11 | `db_health`, `db=catalog, W` | Query p95 peaked at 407.3 ms against 5.27 ms normal. Sampled 200 responses showed expensive replica queries for shoes and jackets. Lag stayed below 1 second. | The delay was in a replica query. Database health weakened the lag explanation. |
| 12 | `search_logs`, `service=catalog, from=11:10, to=11:18, limit=12` | At 11:12, v1.9.0 loaded `default_sort=supplier_rank`. The slice also returned pre-rollout shoes and post-rollout books requests. | The new sort could explain the slow query. |
| 13 | `get_trace`, `trace_id=0410e5e2d3e8b68bb20ee077fe0c1c24` | The shoes request spent 323.67 of 328.58 ms in the replica query. The query used `supplier_rank NULLS LAST, id` and `Seq Scan -> top-N heapsort` with 122,400 qualifying rows and 24 results. | The plan explained why large-category listings drove the gateway tail. |
| 14 | `get_trace`, `trace_id=36d6c4ca41606d66a0909e06918b492b` | Shoes took 15.75 ms before rollout. The replica call took 10.46 ms. | |
| 15 | `get_trace`, `trace_id=1d12aaf55db353cc9749dc767483d0fd` | Books still took 10.94 ms after rollout. With the new order, 120 qualifying rows used an index scan and top-N heapsort. | The cost depended on category size and plan. |
| 16 | `business_kpis`, `{}` | Checkout success was 96.74% across 1,811 attempts. No orders stayed pending over 15 minutes. | |
| 17 | `find_traces`, `service=gateway, route=POST /checkout, min_duration_ms=300, W, limit=3` | Found six slow checkout traces. All three shown returned 201. | Checked whether the route ranked highest by p95 shared the listing path. |
| 18 | `search_logs`, `service=catalog, text=product list settings loaded, from=07:00, to=12:00, limit=20` | Returned only the 11:12 load of the new settings. | The previous sort name remained unknown. |
| 19 | `get_trace`, `trace_id=8fbae58bed4f741b870c6fae433b0dbb` | The checkout gateway span took 453.89 ms. Stripe took 422.83 ms, while the Catalog stock reservation took 7.87 ms. | The sampled checkout tail came from a different request path. |
| 20 | `get_trace`, `trace_id=f9c48783362b912ce5b57e0f8471046a` | Jackets used the same replica plan for 87,500 qualifying rows. The query took 323.67 ms and returned 24 rows. | The slow query repeated in another large category. |
| 21 | `query_metric`, `metric=http_requests_per_second, labels={service:gateway}, from=11:05, to=11:20` | The tool requires `name`. My argument returned an error. | |
| 22 | `get_service_health`, `service=gateway, from=11:05, to=11:11:59` | The pre-rollout window topped out at 181.13 req/s and 85.3 ms p95. | The traffic spike did not produce the latency step. |
| 23 | `get_service_health`, `service=gateway, from=11:12, to=11:40` | The later window stayed above 299.8 ms p95 at less than 100 req/s. | The latency held after traffic subsided. |
| 24 | `search_logs`, `service=catalog, text=index, W, limit=12` | No matches. The trace showed the chosen plan. The tool results left physical index definitions unknown. | |

**Answer.** Catalog v1.9.0 deployed at 11:12 and loaded `supplier_rank` as the default listing sort. The Catalog read replica ran `ORDER BY supplier_rank NULLS LAST, id` with a sequential scan and top-N heapsort on large categories. Shoes and jackets spent about 324 ms in SQL for requests that took about 329 ms and returned 200. Shoes took 15.75 ms before the rollout. Books stayed fast with a much smaller qualifying set and an index scan. Gateway p95 rose at 11:12, paged at 385.9 ms at 11:22, and was still high at noon. Sampled product details were fast. The sampled slow checkout spent most of its customer-facing time in Stripe, with a fast stock reservation. Revert the default sort or roll back Catalog to v1.8.2. Verify large-category list latency, gateway and Catalog p95, and replica query p95 and slow-query counts. Before restoring the sort, check the query plan with large-category data and verify the indexing for the filter and order.

**Correct.** The blind answer matched the trigger, mechanism, customer impact, and mitigation in the incident and labels. The first answer used the checkout trace to separate that path. After the blind solve, the before/after KPI comparison also confirmed stable checkout and payment success.

## Shortest path

1. Run `log_patterns {}`. It shows the new 11:12 settings log with `version=v1.9.0` and `default_sort=supplier_rank`. It also shows 96 new slow product-list warnings with the first large-category replica sample and its trace ID.
2. Run `get_trace {trace_id: 0410e5e2d3e8b68bb20ee077fe0c1c24}`. It ties the new order to the replica plan and attributes 323.67 ms of a 328.58 ms customer request to that plan.

Two calls prove the mechanism. The path combines logs and traces. The settings log shows that supplier rank became the default at 11:12. The trace shows what that sort did in a customer request at 11:12:30. Metrics establish the sustained rise, and `list_changes {}` independently confirms the deploy and names v1.8.2 as the rollback version.

## Partial-answer test

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Correct deploy, affected route, and rollback. Calls the mechanism a general replica read regression. | 3.33/5 | 0.00/5 | 3.33/10 |
| Correct default sort and rollback. Claims the replica was waiting to catch up. | 3.33/5 | 3.33/5 | 6.66/10 |

Both transcripts used actual tool results and ran through `check-case.js --transcript`. The first used Catalog endpoint latency, the change list, and database health. The second added `search_logs {text: supplier_rank}`.

## Findings

1. **The evidence supports the expected cause.** `list_changes` gives the 11:12 deploy and previous version. `search_logs` gives the new default. `get_trace` gives the exact SQL order, plan, row counts, and latency on the replica. The Catalog endpoint check shows 402.65 ms p95 for listings against 62 ms normal, 8.87 ms for details, and 9.22 ms for stock reservation. `get_service_health` and `list_alerts` show the gateway impact and ongoing state. `business_kpis` gives 96.86% versus 96.74% checkout success before and after rollout. Mean payment success was 96.96% versus 97.15%. These comparisons use observed rates. The historical series did not sit at the tool's nominal 100% baseline.
2. **One default call finds the trigger and points straight to the slow trace.** `log_patterns {}` exposes both the settings event and the first slow sample, including its trace ID. `list_changes {}` identifies the rollout on its own. `search_logs {text: supplier_rank}` returns the settings event. Searches for `Product listing merchandising rollout` and `Seq Scan` return no rows. `list_alerts {}` shows the two latency warnings, and `search_logs {level: error}` returns zero rows. `business_kpis {}` and `third_party_health` for `stripe`, `carrier`, and `email` show scope and provider behavior without disclosing the diagnosis. The alerts and the only in-window deploy strongly suggest a Catalog listing rollout regression. The sort and query plan still need evidence. To increase shortcut resistance and depth, keep the plan in the trace and put the setting on a separate diagnostic record that a targeted call can retrieve after inspecting the slow path. Avoid putting both clues in the default log patterns output.
3. **The trigger begins ten minutes before the page.** Catalog p95 jumped from 62.7 ms at 11:11 to 343.1 ms at 11:12, the minute of the rollout. The page fired at 11:22. The effect began immediately and stayed elevated, with 327.7 ms Catalog p95 at 11:59. The default window already covered the deploy and onset. To require time reasoning, seed an earlier deploy with a separately observable delay before the new execution path begins.
4. **A wrong mechanism can earn a majority.** The generic regression answer scored below half, which meets the partial-answer criterion. The answer that correctly named the sort but blamed replica lag earned 6.66/10. The outcome grader awarded points for the sort change and ongoing latency even though `db_health` showed normal lag. Give the evidence for the plan more weight or require it for full credit on the trigger's causal link.
5. **The distractors have specific checks.**
   - **Scraper burst.** `search_logs` for `PriceGrabber` shows three rate-limited requests at 11:07 and 11:08. Gateway health shows that p95 stayed under 86 ms while traffic peaked. p95 jumped at 11:12 after the traffic peak. I considered traffic contention in the blind solve.
   - **Catalog garbage collection.** `search_logs` for `GC pause` shows full pauses at 10:57 and 11:37. Catalog p99 peaked at 757.49 ms at 11:37. `query_metric` puts the sustained p95 rise at 11:12. The slow list trace attributes its time to the query.
   - **Replica lag or resource saturation.** `db_health` shows lag no higher than 0.96 seconds, 32 connections at peak against a normal 24, and disk at about 38%. Query p95 and slow-query counts rose while the slow listing span spent most of its time running SQL.
   - **Checkout or Stripe.** `top_endpoints` puts checkout above listings by sampled p95. The checkout trace shows a 422.83 ms Stripe call, a 7.87 ms stock reservation, and a 201 response. Stripe's hourly p95 average was 374.86 ms against 370.8 ms normal. The before/after KPI check shows stable success rates. I followed the checkout lead long enough to inspect its trace.
   - **Cart Redis client deploy.** The previous deploy was for Cart at 09:40. `db_health {db: redis}` shows p95 averaging 0.94 ms against 0.89 ms normal, and the slow product-list trace goes through Catalog and PostgreSQL.
   - **Carrier retry.** `log_patterns` and `third_party_health {provider: carrier}` show one carrier warning, at 11:55. That was after the latency step. The affected list request never called the carrier.

