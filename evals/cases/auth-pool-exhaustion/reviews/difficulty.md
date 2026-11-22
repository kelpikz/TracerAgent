# Difficulty review: auth-pool-exhaustion

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 5/5 |
| Shortcut resistance | 4/5 |
| Depth | 2/5 |
| Cross-source evidence | 1/5 |
| Time reasoning | 2/5 |
| Partial-answer trap | 2/5 |
| Distractors | 5/5 |
| **Total** | **21/35** |

## Blind solve

All times are UTC on Nov 20, 2026. A window means `from` and `to` with ISO timestamps, unless the call explicitly says `start` and `end`. Unlisted arguments used defaults.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `list_alerts`, state=all, start=10:20, end=12:00 | Auth and gateway error alerts fired at 10:39 and resolved at 10:56. Auth was at 48.69%. | |
| 2 | `top_endpoints`, service=gateway, by=errors, start=10:30, end=10:50 | The unsupported window keys left the query at 11:00–12:00. No sampled endpoint had an error. | |
| 3 | `find_traces`, service=gateway, status=error, start=10:30, end=10:50, limit=4 | The default hour returned only an unrelated 11:55 carrier timeout. | Auth likely caused the resolved gateway spike. The failure mechanism is unknown. |
| 4 | `top_endpoints`, service=gateway, by=errors, 10:20–10:59 | Login, refresh and signup had 22/37, 22/35 and 5/5 sampled errors. | Interactive Auth requests failed. |
| 5 | `get_service_health`, service=auth, 10:20–10:59 | Errors and latency jumped at 10:34. CPU, memory and pod counts stayed steady. | Pod capacity looks healthy. |
| 6 | `find_traces`, service=auth, status=error, 10:20–10:59, limit=4 | Found 49 failed traces. The first login and refresh samples were 503s near 256 ms. | |
| 7 | `search_logs`, service=auth, level=error, 10:20–10:59, limit=8 | Auth canary errors say `users pool acquire timed out`. | The canary could not acquire a Users DB connection. |
| 8 | `list_changes`, service=auth, 08:00–10:59 | The canary session config changed at 10:34 and reverted at 10:56. | The config change likely exhausted the pool. |
| 9 | `get_trace`, trace_id=8bd0e59997bc08dcff6ae97ad5ea01ee | The canary spent 250 ms acquiring a connection and returned 503 before any SQL. | |
| 10 | `search_logs`, service=auth, level=info, 10:20–10:59, limit=12 | The cap was 2 with 2 listener connections. Stable pod sessions succeeded. | The listeners used both slots. |
| 11 | `db_health`, db=users, 10:20–10:59 | Postgres stayed up. Query p95 maxed at 4.77 ms, connections peaked at 12 and there were no slow queries. | The limit was in the application pool. |
| 12 | `business_kpis`, 10:20–10:59 | Login success fell to 40.95% and reached 100% by the end of the window. No orders were stuck pending for 15 minutes. | |
| 13 | `search_logs`, service=auth, text="pool settings", 10:30–11:10 | The rollback at 10:56 restored 12 connections and kept 2 listener connections. | |
| 14 | `get_service_health`, service=auth | Auth was healthy during 11:00–12:00 and ended at 0% 5xx. | Recovery held. |

Answer: At 10:34 Auth cut the canary's local Users Postgres pool from 12 connections to 2. The two session listeners held both slots. Canary login, refresh and signup returned 503 after a 250 ms wait before SQL. Stable pod sessions succeeded and Postgres stayed healthy. Gateway and Auth paged at 10:39. The 10:56 rollback restored 12 slots and cleared the alerts. Keep the restored setting and reserve capacity for interactive requests before retrying the canary. No emergency action remains. Correct: yes.

## Shortest path

1. Run `log_patterns` for 10:30–10:57 without a service filter. It shows the 10:34 settings sample with both counts at 2 and the matching 503 pool timeout on `auth-canary`. This one call establishes the cause and trigger.
2. Run `search_logs` for `pool settings` in the same window to see both cap values and the recovery time. This step adds the rollback evidence. `top_endpoints` and `get_service_health` establish customer scope and current health.

## Partial-answer test

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Blames newsletter load for the canary pool exhaustion and correctly keeps the rollback | 3.93/5 | 1.67/5 | 5.60/10 |

The transcript used the alert, gateway endpoint samples, Auth error logs and change history. The checker gave credit for recovery and for investigating the timeout without testing the workload explanation or finding the listener reservation.

## Findings

1. **The cause fits in one historical log call.** `log_patterns` reports the two connection counts and acquire failure on the same pod. The sampled trace also shows the 250 ms wait before SQL, Postgres metrics reject a database failure, and the change log brackets the fault. The seed and labels agree with these results. For greater depth, put the pool cap and listener occupancy in separately keyed telemetry and use an independent trace or queue gauge to link them.
2. **The default change log gives away the service and rollback.** `list_alerts` has no firing results. `search_logs` with level=error and the default search for `pool settings` are empty. Default `log_patterns`, `business_kpis` and `third_party_health` for Stripe, carrier and email have no causal evidence. Default `list_changes` shows the 10:56 Auth canary revert as the last change before the window. Widening the search for `pool settings` returns both configs. Alerts and changes alone suggest the Auth canary config, with the listener mechanism still unknown. Add another plausible recent Auth change if the goal is to weaken this shortcut.
3. **The five-minute gap is the page threshold.** The config and the first failure both occurred at 10:34. The fault is outside the default 11:00–12:00 window by 26 minutes. The failure starts immediately and ends on rollback. To test longer time reasoning, seed a configuration change whose effect appears later and leave historical evidence for that delay.
4. **The wrong workload explanation earns more than half.** The checker awards near-full trajectory credit for the service, visible pool wait, impact and recovery even though the answer misses the connection cap and both listeners. Tie part of that credit to observing the setting or comparing traffic and failures over the relevant minutes.
5. **Three nearby signals invite different explanations.** The newsletter peaked at 157 gateway req/s at 10:06 and was down to 81 req/s at 10:34, when failures started. Check gateway request rate against Auth error onset. The session-cleanup cron swept sessions regularly in about 100 ms and never aligned with onset or resolution. Compare the cron timestamps with the change and trace. A Users Postgres outage also fits the surface symptom. `db_health` and the failed pre-query acquire reject it. The blind solve did not pursue any of these explanations. It discarded the unrelated 11:55 carrier trace once the tool window was apparent.
