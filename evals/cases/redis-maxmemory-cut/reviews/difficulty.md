# Difficulty review: redis-maxmemory-cut

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 4/5 |
| Shortcut resistance | 3/5 |
| Depth | 4/5 |
| Cross-source evidence | 5/5 |
| Time reasoning | 5/5 |
| Partial-answer trap | 5/5 |
| Distractors | 4/5 |
| **Total** | **30/35** |

## Blind solve

18 calls (2 were errors from wrong argument names). About 5 calls were not needed.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | list_alerts {} | Cart and gateway ServiceErrorRateHigh fired at 11:15. No Redis alert. | Cart is the source. |
| 2 | get_service_health cart | Error rate 0 to about 39% from 11:10. Latency, CPU, memory normal. | Errors, not slowness. |
| 3 | top_endpoints cart errors | POST /cart/items 95% errors. Other routes clean. | The write path fails. |
| 4 | get_trace (sample error) | Span `redis HSET cart` fails in 0.5 ms: "OOM command not allowed when used memory > 'maxmemory'". | First hypothesis: Redis is at its memory limit. Cause of the limit unknown. |
| 5 | search_logs cart level=error | 85 "add to cart failed", same OOM error, from 11:10. | Same. |
| 6 | db_health redis | Memory 637 to 640 MB, flat. "normal" 687 MB. Latency normal. | Memory is full but looks normal. Need a trigger. |
| 7 | list_changes (default window) | No changes. Only `last_change_before_window`: cart v2.1.0 "Upgrade Redis client library" 09:40. | Deploy is a candidate. The error comes from the server, so I doubted it. |
| 8 | query_metric (wrong args) | Error. | - |
| 9 | query_metric (wrong args) | Error. | - |
| 10 | search_logs text=maxmemory, 07:00 to 12:00 | Two "redis connected" lines at 08:20: `maxmemory_mb=640`, `maxmemory_policy=noeviction`, host `cart-redis-1g`. | Redis got a 640 MB limit at 08:20. |
| 11 | log_patterns 11:00 to 12:00 | Only the new cart error pattern. Nothing else is new. | No other fault. |
| 12 | query_metric redis_memory_used_mb 08:00 to 12:00 | Drop at 08:20, slow climb, flat at 640 from 11:10. | Memory grew to the limit. Time matches the first errors. |
| 13 | get_runbook RedisMemoryHigh | No runbook. | - |
| 14 | past_incidents | None. | - |
| 15 | business_kpis | Checkout success 96.75%. Lowest minute 85.7%. Payment normal. | Checkout works. |
| 16 | list_services | Cart uses Redis for storage. | - |
| 17 | get_service_health gateway | Gateway error rise starts at 11:10. | Gateway is a symptom. |
| 18 | top_endpoints gateway | Same route, POST /cart/items. | Same. |

I did not run `list_changes` with a wide window. I found the 08:20 move from the log text search. A normal agent
would widen the window after call 7 and find "Move cart Redis to a smaller instance to cut cost (FIN-212)".

Answer: The cart Redis was moved to a smaller instance at 08:20 UTC. The new instance has maxmemory 640 MB with
noeviction. Memory grew to 640 MB at about 11:10 UTC. Redis then rejects writes, so POST /cart/items returns 500
(about 95% of that route, cart error rate about 39%). Customers can not add items. Checkout for existing carts
works. The fault is still active. The deploy v2.1.0 is not the cause. Fix: raise maxmemory (back to the old
instance size, `cart-redis-2g`), then check the error rate. Correct: yes. I could not prove the "fewer checkouts"
claim (see finding 3).

## Shortest path

1. Alert names cart. `top_endpoints` cart errors shows POST /cart/items at 95% errors.
2. `get_trace` on the sample trace (or `search_logs` level=error) shows the OOM error on `redis HSET cart`.
3. The OOM error asks "what changed in Redis?". `list_changes` with a wide window (from 08:00 or earlier)
   shows the 08:20 config change "Move cart Redis to a smaller instance". The default window shows only the
   dead-end deploy.
4. `search_logs` text=`redis connected` with a wide window shows `maxmemory_mb=640`, `noeviction`, host `cart-redis-1g`.
5. `query_metric` redis_memory_used_mb (08:00 to 12:00) shows the plateau at 640 MB from 11:10. This matches the
   limit from step 4 and the first error time.

5 steps. Steps 4 and 5 can swap. An agent can skip step 5 and still be right.

Fairness, fact by fact:
- Move at 08:20 and "smaller instance": `list_changes` (wide window), `search_logs` "redis connected".
- 640 MB and noeviction: `search_logs` "redis connected" (wide window).
- Memory reaches the limit at 11:10: `query_metric` redis_memory_used_mb.
- OOM error and POST /cart/items 500: `top_endpoints`, `get_trace`, `search_logs`.
- v2.1.0 is a dead end: `get_trace` (error from the Redis server), and the error starts 90 minutes after the deploy.
- Old size `cart-redis-2g`: `search_logs` "connection lost" at 08:20 (`host=cart-redis-2g`).
- Not visible to any tool: the 2048 MB limit and "RedisMemoryHigh does not fire because it uses the old limit".
  The number 2048 is only in `metrics.json` as a `limit` field and in the labels. No tool prints it.
  "Cart keys live for days" is not visible either. These are side facts, not the root cause. The gate passes.

## Partial-answer test

Transcript: `r2-difficulty-redis/partial.json` in the scratchpad. It has the six default-window calls (alerts,
health, top_endpoints, log_patterns, db_health, business_kpis) and no wide `list_changes` or log search. The
answer says "Redis is full at 640 MB, raise maxmemory", with the OOM error and "still active", but no trigger.
Run without `--judge`.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Default calls only. "Redis full, raise the limit". No trigger. | 2.86/5 | 1.25/5 | 4.11/10 |

The deterministic total is under half. The judge was not run, so the real total may differ. Trajectory alone
is above half, because the OOM error and the memory plateau are easy to find. The outcome part makes the trap work.

## Findings

1. **The proximate cause is one call away** (Shortcut resistance, 3/5)
   - Evidence: `search_logs` with level=error (default window) prints the OOM error with the word "maxmemory" in
     the first result. `top_endpoints` and `get_trace` show it too. `db_health` redis shows memory flat at 640 MB.
     An agent that stops here already has "Redis is full" and the right class of fix. Only the trigger (the
     08:20 move) and the 640 MB setting need a wider window. `list_changes` with default arguments shows only the
     dead-end deploy. `search_logs` text=maxmemory with the default window returns only the error lines, so it
     does not give the trigger.
   - Fix: Make the first error less direct. For example, the cart log and the span could say "write failed:
     redis error" with the OOM text only in a Redis server log line, so that the agent must read Redis memory
     against the limit to learn that the instance is full. Or add a second Redis fault symptom that the agent
     must separate from the memory limit.

2. **Only the deploy competes as a distractor** (Distractors, 4/5)
   - Evidence: v2.1.0 "Upgrade Redis client library" is the only item that is easy to follow. It shows in
     `last_change_before_window` and the name has "Redis". The server-side error text and the 90 minute gap
     reject it. The newsletter (10:00 to 10:30), the KEYS job (00:00), GC and cron are outside the default
     window and produce no errors. The price scraper at 11:07 gives a gateway rate peak (181 req/s) and "rate
     limited" lines three minutes before the errors start. It is a weak lead. The carrier error peak (5.88% at
     11:16) and the Stripe peak (2.44%) are small. The Redis "normal" memory of 687 MB is above the current
     640 MB, so the db_health summary reads as "below normal".
   - Fix: Make a second lead plausible for the error start. For example, add a short cart latency rise or a
     Redis memory spike during the newsletter that recovers, so the agent must show that memory stays at the
     limit. Or give the deploy a visible Redis-related warning log that does not break anything.

3. **Checkout impact is hard to prove** (Blind solve and fairness side facts)
   - Evidence: The expected impact says "about 568 fewer checkouts". `checkout_attempts_per_min` is 22 normal,
     but the newsletter lifts it to 29 to 37 from 10:00 to 11:36, so there is no visible drop at 11:10.
     `business_kpis` shows checkout success 96.75% and no fall in attempts. An agent can state the add-to-cart
     failure from the error rate, but not the checkout loss.
   - Fix: Drop the 568-checkout claim from the labels and the outcome rubric, or move the newsletter away from
     the fault window so that the attempts fall is clear. Also print the Redis `maxmemory` limit in
     `db_health`, or remove the 2048 MB claim from the expected answer.

4. **The blind solve was short for the real cause** (Blind solve, 4/5)
   - Evidence: The OOM mechanism took 4 calls. The first hypothesis (Redis at its limit) was right but
     incomplete, and the trigger took 3 more calls. The 18 calls include 2 errors and about 5 extra calls.
   - Fix: Same as finding 1. If the first result does not name the memory limit, the agent needs more steps to
     reach the hypothesis.
