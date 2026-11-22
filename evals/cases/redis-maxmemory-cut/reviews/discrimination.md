# Discrimination review: redis-maxmemory-cut

| Part | Score |
| --- | --- |
| Difficulty | 3/5 |
| False leads | 3/5 |
| Input | 5/5 |
| Depth | 4/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

1. `ServiceErrorRateHigh` for cart, 25.2% (`list_alerts`). The gateway alert only repeats it.
2. Cart is sick since 11:10; latency, CPU, pods are normal (`get_service_health` cart). Not a crash or a slow service.
3. Failing route and error: `POST /cart/items`, "OOM command not allowed when used memory > 'maxmemory'" (`log_patterns` cart, or `top_endpoints` + `get_trace` of a failed trace, span `redis HSET cart`).
4. Redis memory is flat at about 640 MB from 11:10, latency normal, `RedisMemoryHigh` not firing (`db_health` redis, or `query_metric redis_memory_used_mb` from 08:00). The result also shows "normal 687.6", so the panel looks fine.
5. Why is the limit so low? `list_changes` with a window that starts before 08:20 shows "Move cart Redis to a smaller instance to cut cost (FIN-212)".
6. Confirm the limit: `search_logs` cart text "redis" around 08:20 shows `host=cart-redis-1g`, `maxmemory_mb=640`, `maxmemory_policy=noeviction`.
7. Impact: `business_kpis` / `compare_windows checkout_attempts_per_min` around 11:10 (28 to 19 per minute).

Six or seven calls, and each one gives the reason for the next. A good agent can skip steps 2 and 6 and still get the cause.

## False leads

- Cart `v2.1.0` deploy at 09:40, "Upgrade Redis client library": a default `list_changes` (last hour) returns it as `last_change_before_window` and nothing else. A weak agent stops there and says "the new Redis client breaks writes". Reject it with `compare_windows` on cart `http_error_rate` (0 for 90 minutes after 09:40), and because the error text is a Redis server message. This is a good lead, but one query rejects it.
- Redis memory looks normal: `db_health` shows 639 MB with "normal 687.6" and `RedisMemoryHigh` is OK. A weak agent says "Redis is fine". Reject it with the flat line at 640, the OOM text, and the 2 GB rule limit versus the 640 MB limit in the "redis connected" log.
- Gateway `ServiceErrorRateHigh`: a weak agent investigates the gateway. Reject it with the 4.6% rate, which is about the cart failures (`top_endpoints` gateway or `find_traces`).
- Newsletter spike 10:00 to 10:30: only seen if the agent looks at gateway or catalog traffic. It ends 40 minutes before the errors and has no errors.
- Midnight `KEYS` job: only seen if the agent searches Redis latency or cart "slow redis" logs. It is 11 hours earlier and has no errors.
- Price scraper, catalog GC, cron jobs: nothing in the cart or Redis path. They only cost calls if the agent looks.

Only the deploy and "Redis looks fine" are met by an agent that follows the alert. The other noise items are far from the symptom. The case has false leads, but they are weak.

## Test transcripts

Real tool results from `fill-transcript.js`. Files are in the scratchpad folder `r2-discrimination-redis`.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak A: `list_alerts`, `get_service_health`, default `list_changes`. Blames `v2.1.0`, rollback and restart. | 0.71/5 | 0.00/5 | 0.71/10 |
| Weak B: follows the cascade to the OOM error and flat memory. Rejects the deploy. Does not look before 11:00. No trigger. "Increase maxmemory". | 2.14/5 | 1.25/5 | 3.39/10 |
| Weak C: two calls only (`list_alerts`, wide `list_changes`). Guesses OOM from the change name. No Redis, log or impact evidence. | 1.43/5 | 4.38/5 | 5.81/10 |
| Good: wide `list_changes` first, then `find_traces`, `search_logs`, memory, deploy check, checkout. Calls in a different order, 8 calls. | 4.29/5 | 5.00/5 | 9.29/10 |

The good transcript got 0 for `checked_oom_error` because `find_traces` only shows `failed_span: gateway: POST /cart/items`, not the OOM text. The agent needs `get_trace` or a log call to see it. This is correct behavior of the grader, and it is a small cost for a good agent that skips the log.

Weak A and Weak B are under half of the points. Weak C is above half, but the judge items (`evidence`, `impact`) are not run here, and they should lower it.

## Findings

1. **The change name gives away the cause**
   - Evidence: `list_changes` over the full day, or `events.json`, shows "Move cart Redis to a smaller instance to cut cost (FIN-212)" at 08:20 on service `cart`. A guess from that line alone (Weak C, 2 calls) names the trigger and the right fix and gets 5.81/10. The deterministic outcome tests only read the answer text. `names_trigger`, `names_faulty_service`, `next_step_raises_limit` and `states_still_active` give credit without a check against tool results. Only `names_memory_limit` (needs the number 640) stayed at 0 for Weak C.
   - Fix: keep the case, but make the judge `evidence` item decisive: an answer with trigger claims and no matching tool result gets a hard cap (for example, total under 5). Optionally make the change text less direct, for example "Cart Redis plan change (FIN-212)", so that the agent must read the "redis connected" logs to learn that the instance is smaller.

2. **One query shows the OOM error**
   - Evidence: `log_patterns {"service":"cart"}` with the default window returns the new pattern "add to cart failed" with the OOM error text, the route (via the trace) and the first time 11:10:02. `db_health redis` then shows memory flat at 639.9 MB. Every agent that reads the cart logs knows "Redis is full" in 2 calls. The real work is only the trigger.
   - Fix: this is fine for a trigger-focused case. To raise difficulty, drop the OOM text from the cart log line and leave it only on the `redis HSET cart` trace span, so the agent must call `get_trace`.

3. **The false leads are weak and mostly invisible**
   - Evidence: only `v2.1.0` shows on the default path, and one `compare_windows` rejects it. The newsletter, `KEYS` job, scraper, GC and cron items sit far from the cart and Redis symptom. The agent meets them only if it looks at the gateway, Redis latency or `cron` logs.
   - Fix: move one more lead close to the 11:10 time, for example a brief catalog or gateway change at 10:50 to 11:05 with a small, harmless effect. Or let the `v2.1.0` deploy come closer to the fault start. Today it is 90 minutes before and is rejected too easily.

4. **Memory "normal" value points the wrong way (good detail, keep it)**
   - Evidence: `db_health` redis reports `normal: 687.6` for `redis_memory_used_mb`, and the current value is 639. A shallow agent can read this as "memory is below normal". The decisive hint is the flat line at 640 and the 08:20 drop.
   - Fix: none. Keep it. The grader already gives only 0.5 for a window that ends before 11:10.

5. **Efficiency item cannot separate a lucky short run from a careful one**
   - Evidence: `efficiency` gives 1 for up to 40 calls and 0 only after 64. Weak C scores 1 on it with 2 calls, because it found a move line.
   - Fix: acceptable. The other six items separate the runs. No change needed unless a minimum call count is wanted.
