# Correctness review: redis-maxmemory-cut

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 3/5 |

## Findings

1. **A wrong answer gets `names_trigger` (and then 3 more items)** (false positive)
   - Evidence: `outcome/tests.js`, `TRIGGER` pattern 4 (`the|a|this|that (redis )?(resize|...)`) and the missing check
     for a dismissal. Test transcripts (scratchpad `e13`, `d12`):
     - `e13`: "Redis is full at 640 MB. Nobody knows why. ... Revert the Redis resize." gets `names_trigger` 1,
       `names_memory_limit` 1, and all 3 gated "no wrong claim" items and `states_still_active`. 6 of 8 items, with no
       cause. The code comment says that an action phrase must not count, but "the Redis resize" in an action matches.
     - `d12`: "The v2.1.0 client library upgrade caused it. Infra moved the cart Redis to a smaller instance at 08:20
       with maxmemory 640 MB, but that is not the problem. Roll back v2.1.0." gets `names_trigger` 1,
       `names_memory_limit` 1, `no_harmful_action` 1, `states_still_active` 1 (outcome 3.13/5). The answer blames the
       deploy and rolls it back.
   - Fix: remove pattern 4 or require a past tense verb. Skip a trigger clause that has a dismissal ("not the problem").
     Keep the trigger text out of action sentences.

2. **A correct answer with other words for the trigger loses 5 of 8 items** (false negative)
   - Evidence: `TRIGGER` list and `gate()`. Test transcripts, all with the right limit, still-active text, and a
     raise action:
     - `e14`: "the cart Redis was scaled down from 2 GB to 1 GB. maxmemory is 640 MB" gets `names_trigger` 0. The
       outcome score is 2/8 items (1.25/5).
     - `e15b`: "the maxmemory of the cart Redis changed from 2048 MB to 640 MB" gets 0 (the same text with "(cost
       ticket)" gets 1 by luck, through the word "cost").
     - `e16`: "the cart Redis was replaced by a 1 GB node" gets 0.
   - The gate sets `no_noise_as_cause`, `no_deploy_rollback`, `no_harmful_action`, `states_still_active`, and
     `names_memory_limit` to 0 when the trigger is not matched.
   - Fix: add synonyms ("scaled down", "replaced", "went from 2 GB to 1 GB", "changed ... to 640", "downscal", "1 GB
     node"). Better: let `names_memory_limit` and the gated items use "trigger or a 08:20 time with 2048 to 640".

3. **`next_step_raises_limit` is wrong in both directions** (false positive and false negative)
   - Evidence: `ACTION`, `TARGET`, `MODAL`, `IMPERATIVE`. Test transcripts:
     - `d7`: "We should look at the memory limit change and think about it." gets 1. The words "should", "change", and
       "memory limit" match. There is no action to raise the limit.
     - `d6`: "Roll back the Redis resize now. Check the cart errors after." gets 0. The word order "back ... Redis" does
       not match `redis[^.\n]{0,30}\bback\b`, and "resize" is not in `TARGET`.
     - `e16`: "Put the 2 GB node back in service now" gets 0 (`node` and "2 GB node" are not in `TARGET`).
   - Fix: take `change`, `set`, `go`, `put` out of `ACTION` for the MODAL path, or require `rais|increas|restor|revert|
     roll back|move back` for the action. Add `resize|node|2 ?gb` to `TARGET`.

4. **A correct answer can lose `no_noise_as_cause`** (false negative)
   - Evidence: `CAUSE` words ("because") and `NOISE` in one clause with no `DISMISS` word. Test `d8`: "The v2.1.0
     deploy was checked. The errors started at 11:10 because Redis was full, and the v2.1.0 client library works."
     gets `no_noise_as_cause` 0 although the answer rejects the deploy.
   - Fix: require the noise item to be the subject of the cause word, or add "works", "checked", "fine", "ok" to
     `DISMISS`. Or leave this item to the judge.

5. **Weak or free items** (false positive)
   - Evidence: `names_faulty_service` needs only "redis" and one of `memory|limit|full|oom|...`. Any answer that says
     "Redis" and "limit" gets it. `d3` (no trigger, correct limit and action) gets only 1.25/5, which is right. But
     `d4` (trigger text, flush Redis, restart pods) gets 3.75/5 because the "no wrong claim" items are free when the
     answer says nothing wrong.
   - Fix: low priority. Count `names_faulty_service` only with "cart" and an OOM or 640 word. The judge grades the rest.

6. **`checked_checkout_impact` gives full credit for a view that hides the impact** (false positive, coverage)
   - Evidence: `trajectory/tests.js`. `business_kpis` with the default window (11:00 to 12:00) gets 1. The result
     shows `checkout_attempts_per_min` avg 20.72 against `normal` 22, a small drop. The rubric says that the agent
     needs the comparison with the time before 11:10 (28 to 19 per minute, -33%). A single window gives no comparison.
   - Fix: give 1 only for `compare_windows`, or for a `query_metric` or `business_kpis` window that starts before
     11:10. Give 0.5 for a single window in the fault period.

7. **A one-call transcript gets 1.43/10** (false positive, small)
   - Evidence: `d2`: one `list_changes` call (06:00 to 12:00) gets `checked_redis_move_change` 1 and `efficiency` 1.
   - Fix: give `efficiency` credit only when at least the cart error shape and the Redis memory were checked.

8. **`checked_cart_error_shape` misses valid ways to see the symptom** (false negative, small)
   - Evidence: it counts `get_service_health`, `top_endpoints`, `find_traces`, and `query_metric` with a cart label.
     It does not count `search_logs` or `log_patterns` for cart errors, or `query_metric http_error_rate` with no label
     (the result lists every service, with cart at 39.78% max).
   - Fix: add those calls (the log call needs a window that reaches 11:10).

9. **Wrong number in both prompts and in the good transcript** (fact)
   - Evidence: `trajectory/prompt.md` and `outcome/prompt.md` say "`cart_errors_per_min` is about 380 per minute from
     11:20". The data: 385, 437, 450, 382 at 11:20, 11:25, 11:40, 11:59. The average from 11:20 to 11:59 is 408 and the
     maximum is 466. The value "382 at 12:00" is the last point at 11:59. (Other numbers are correct: 19,154 failed
     writes, 11-12 average 319, 25.2% and 4.6% in the alerts, 28 to 18.7 checkout attempts (-33%), 640 MB flat from
     11:10, first error 11:10:02, 95.5% of sampled `POST /cart/items` failed.)
   - Fix: write "about 400 per minute from 11:20 (385 to 466)".

10. **Cart pod log lines do not match the deploy lines** (cascade, small)
    - Evidence: `logs.jsonl`. At 08:20 the pods `cart-72a28` and `cart-f98d4` log "redis connection lost". At 09:40 the
      pods that stop are `cart-f53ed` and `cart-d10d5`. The two new v2.1.0 pods (`cart-726f7`, `cart-fdd6e`) log
      "starting" and "ready" but no "redis connected" line with `maxmemory_mb=640`. New pods must connect to the new
      host. The "redis connected" lines have no `pod` field, but the "connection lost" lines do.
    - Fix: use the same pod names, and add a "redis connected" line for each new v2.1.0 pod at 09:40. The checker
      regexes accept it (the move check only needs the line to exist).

11. **Thin proof that reads and deletes work** (cascade, small)
    - Evidence: the fault window (11:10 to 12:00) has 1 `GET /cart` trace and 1 `DELETE /cart/items/:id` trace, and 2
      successful `POST /cart/items` traces. The claim "`GET /cart` and delete work" rests on 2 traces and 1 log line.
    - Fix: optional. Keep a few more sampled GET and DELETE traces in the fault window.

12. **Coverage of the deterministic checks** (coverage)
    - Evidence: no deterministic check for impact size or "what still works", for the 09:40 dead end, or for "check
      that the errors recover". Only the judge grades them. This is acceptable if the judge runs, but the outcome
      score without the judge has no impact item.
    - Fix: optional. Add an item for the impact (add-to-cart fails, a number in range, or the cart error rate).

## Checked and correct

- Trigger in the data: `events.json` has the 08:20 cart config change "Move cart Redis to a smaller instance to cut cost
  (FIN-212)" by infra and the 09:40 cart v2.1.0 deploy "Upgrade Redis client library". `list_changes` shows both.
- Reconnect logs: at 08:20:23 and 08:20:28 each of the 2 cart pods logs a warn "redis connection lost" (host
  `cart-redis-2g`) and then an info "redis connected" (host `cart-redis-1g`, `maxmemory_mb` 640, `noeviction`). The
  cart has 2 pods (`pods_ready` 2).
- Redis memory: `redis_memory_used_mb` is 612.0 at 08:19, 594.8 at 08:20, 614.6 at 10:00, 637.9 at 11:00, 639.7 at
  11:10, and flat at 639.4 to 639.9 until 11:59. It does not pass 640. The label drop (612 to 595 MB) matches.
- Redis latency: `redis_latency_p95_ms` avg 0.945 in the fault, 0.892 before. Normal. The only spike is 19.6 and 23.8 ms
  at 00:00 and 00:01 (the KEYS job, with 16 "slow redis command" cart logs and 61,492 keys in the job log).
- Errors: `cart_errors_per_min` is 0 at 11:09 and 149 at 11:10, 317 at 11:15, 450 at 11:40, 382 at 11:59. The sum from
  11:10 is 19,154 (the label says 19,150). Cart `http_error_rate` is 13.1% at 11:10 and 25.19% at 11:14 (this is the alert
  text), 39.78% max, 38.9% at 11:59. It is near 0 (avg 0.045, max 0.30) from 09:40 to 11:00, so the deploy is a dead end.
- Cart error identity: 85 logs "add to cart failed" with the OOM text, first at 11:10:02. 85 traces of `POST /cart/items`
  with status 500, and the failed span `redis HSET cart` has the OOM error in 0.5 ms (a normal request also has
  `redis EXPIRE cart`). Each failed trace has a matching cart log and a gateway log (status 500). The 1 earlier cart error
  (16:50 on Nov 19, "redis: i/o timeout after 50ms") is from the baseline.
- `top_endpoints` cart: `POST /cart/items` 85 of 89 sampled (95.5%), the other routes have 0 errors.
- Baseline contradictions: no normal "item added to cart" line is missing from the fault. There are only 2 after 11:10
  (the code samples failed writes only). Cart latency p95/p99, CPU, memory, restarts, and pods are normal.
- Gateway: `http_error_rate` is 0.09 at 11:09, 2.52 at 11:10, 4.59 at 11:14, 7.9 max. Other services stay at their
  baseline. No Postgres, Kafka lag, DLQ, Stripe, carrier, or email error increase in the fault (`kafka_consumer_lag` max 9,
  `kafka_dlq_size` unchanged, `emails_failed_per_min` max 0).
- Checkout cascade: `checkout_attempts_per_min` avg 28.0 (10:30 to 11:10) and 18.7 (11:10 to 12:00), -33%.
  `kafka_messages_in_per_min` for `order.created` and `order.paid` fall 26 to 18, `webhooks_received_per_min` (Stripe) 26 to
  17, Stripe requests 27 to 19, carrier requests 30 to 21, `emails_sent_per_min` 58 to 42. Payment and checkout success rates
  stay near 97% (avg 96.9 and 97.3 against 96.6 and 96.9 before). `orders_stuck_pending_15m` stays 0.
- Alerts: `ServiceErrorRateHigh` for cart and gateway fire at 11:15 (the rule needs 5 minutes, the metric is above 2% from
  11:10 to 11:14 for both). `RedisMemoryHigh` does not fire (the generator uses the 2048 MB limit of the old instance). No
  other alert fires in 24 hours. Both alerts have `resolved_at` null, so the fault is active at 12:00.
- Noise facts in the prompts: newsletter (gateway rps 149 at 10:10, 75 at 09:55, gateway error rate max 0.13 from 10:00 to
  10:30), KEYS job at 00:00 to 00:02, price scraper 429 at :07, orders migration at 03:10, catalog stats refresh at 06:30
  (with "exchange rate provider slow" retries). All are in the logs and metrics.
- Checker run on the fixtures: good transcript 10.00/10 (trajectory 5.00, outcome 5.00). Empty transcript: 0 for every
  item in both files. A nonsense answer ("asdf qwerty lorem ipsum", no tools) gets 0.00/10.
- `d1` (wrong investigation: default windows, blames the v2.1.0 deploy, rolls it back) gets 0.71/10. `d3` (right limit
  and action, no trigger) gets 3.39/10 with outcome 1.25/5, under half, as the case requires.
- `d10` ("errors have stopped, cart is back to normal") gets `states_still_active` 0. `d11` (adds "restart the cart pods")
  gets `no_harmful_action` 0. A flush answer (`d4`) gets `next_step_raises_limit` 0.
- Trajectory items `checked_oom_error`, `checked_redis_memory` (0.5 for a lead-up window only),
  `checked_redis_move_change` (needs 08:20 in `changes`, or the log lines), and `checked_maxmemory_setting` read tool
  results and not the agent text, and accept any tool order. `list_changes` over a window that ends before 08:20 gets 0.
- The expected impact range in the outcome prompt (15,000 to 23,000; -33% and 450 to 570 fewer checkouts) matches the data
  (19,154; 467 from the metric, 568 in the label).
