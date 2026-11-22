# Discrimination review: delivery-schema-break

| Part | Score |
| --- | --- |
| Difficulty | 2/5 |
| False leads | 3/5 |
| Input | 5/5 |
| Depth | 3/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

1. `KafkaLagHigh` for group `delivery` (`list_alerts`, or the input itself).
2. `kafka_lag` shows `delivery` lag 2045 (normal 1) and `dlq_size` 0. The other groups are normal. Only Delivery is stuck.
3. `search_logs service=delivery level=error` shows `failed to process message, will retry`. It has one offset (1854162), one order (`ord_V6WMXG`), `schema_version=2`, a growing `attempt` and the error `cannot unmarshal object into Go struct field OrderPaid.shipping_address of type string`. The first row is at 10:48:19.
4. `list_changes` 10:00 to 12:00 shows one change: Order `v3.4.0` at 10:48, "Structured shipping address for pickup points".
5. Impact: `get_order_timeline ord_V6WMXG` has `event published: order.paid` and no Delivery step. `third_party_health carrier` shows booking calls at 3 per minute (normal 24), with a normal error rate and latency. `business_kpis` shows checkout and payment at about 97%.

Steps 2 and 3 give the cause and the mechanism. Step 4 gives the trigger. Steps 1 to 4 are 3 to 4 tool calls. Step 5 is impact only. Each step needs the alert, not the result of the step before: `search_logs service=delivery` and `list_changes` can run with no earlier result.

A weak agent that fails must miss step 3 or step 4. It must not read the Delivery error logs or the change list. That is easy to avoid only if it follows a false lead first.

## False leads

- Carrier booking calls drop to about 5 per minute (real data, in the fault window): a weak agent says "the carrier stopped accepting bookings" / reject with `third_party_error_rate` (average 0.1%), normal p95 latency, and no carrier error logs. The drop is an effect, because Delivery sends no booking. This is the best lead in the case.
- `ThirdPartyErrors` at 01:05 (96% for the carrier, resolved 01:15, seen in `list_alerts all`): a weak agent links it to the carrier / reject by time (9 hours earlier, resolved) and the normal carrier error rate now.
- `DlqGrowing` for group `notification`, firing since 11:51 (18 minutes after the lag alert, seen in `list_alerts firing`): a weak agent says "Kafka consumers are failing in general" / reject with `dlq_sample` (all 5 messages are `550 mailbox does not exist` on `delivery.updated`, last one hours ago) and `delivery` `dlq_size` 0. The Notification DLQ size is 6 to 7 against a normal 4, so the signal is weak.
- Notification lag spike to 161 at 03:00 (OOM): a weak agent says "Notification leak" / reject by time and lag 1 now.
- Cart `v2.1.0` deploy at 09:40 (`last_change_before_window`): a weak agent blames the latest deploy / reject by time (68 minutes before the first error) and because the Order deploy at 10:48 fits.
- One order in PENDING (`ord_MB8THH`, metric 1, rule limit 5): a weak agent says "stuck orders" / reject by the metric value and its cause (3-D Secure, unrelated to Delivery).
- Restart of Delivery: a weak agent restarts the pods / reject because the logs show the same offset failing, not a pod fault. The pods and HTTP metrics are healthy.

No false lead sits inside the fault window as an error log. In the window, the only error logs are Delivery's 77 rows (checked in `logs.jsonl`). The other leads are old or small, and the clock rejects each in one look. The case has leads, but they are weak, except the carrier drop.

## Test transcripts

Scratch files are in `C:\Users\ajith\AppData\Local\Temp\claude\601c041d17df3b6e\1804c860-5be2-4813-ad9c-5a6ae17b6828\scratchpad\r2-discrimination-delivery\` (`weak1.json`, `weak2.json`, `weak3.json`, `good.json`). The results are from real tool output (`fill-transcript.js`) and the deterministic graders only (no `--judge`). Scores are out of 10, from `check-case.js`. The Trajectory and Outcome columns are each out of 5.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent 1: follows the carrier and the Notification DLQ (4 calls: `list_alerts`, `third_party_health`, `kafka_lag`, `get_service_health`). Blames the carrier, says to wait and scale Notification. | 1.88/5 | 0.56/5 | 2.44/10 |
| Weak agent 2: stops at "consumer stuck" (2 calls: `kafka_lag`, `search_logs`). Never checks changes. Says restart, skip the message, move the offset. | 1.56/5 | 1.11/5 | 2.67/10 |
| Weak agent 3: guesses from alerts and changes (3 calls: `list_alerts`, `list_changes`, `kafka_lag`). Names the Order deploy, gives a rollback, never reads the Delivery log. | 1.56/5 | 4.44/5 | 6.00/10 |
| Good agent: different order (9 calls: `list_changes` first, `query_metric`, `search_logs`, `get_order_timeline`, `compare_windows`, `third_party_health`, `list_alerts`, `kafka_lag`, `business_kpis`). Rejects every false lead with evidence. | 5.00/5 | 5.00/5 | 10.00/10 |

Weak agents 1 and 2 get less than half of the points. Weak agent 3 gets 6.0, because the `outcome/tests.js` checks read only the words of the final answer, and it does not check the evidence. The rubric (`outcome/prompt.md`, item 5, evidence) would take points from it in the judge run. The trajectory part is already low (1.56/5).

## Findings

1. **One or two queries give the cause**
   - Evidence: `search_logs service=delivery level=error` returns the offset, `schema_version=2`, the parse error and the 10:48:19 time in the first row. `list_changes 10:00-12:00` returns exactly one change, the Order deploy, and its summary names "shipping address". `kafka_lag` with no arguments already shows `delivery` as the only sick group. The `delivery` service is also the group in the alert, so the agent needs no search to find where to look. Weak agent 2 found the offset and the error in 2 calls.
   - Fix: add a second, plausible change in the 10:00 to 12:00 window (for example a Delivery config change or a Notification or Payment deploy around 10:45 to 10:55), so `list_changes` is not a one-row answer. Reword the Order deploy summary to something that does not name the payload (for example "Pickup point support"). Add a second old retry error from another Delivery topic or an old `delivery` error pattern (for example a short carrier timeout that retried and recovered) so that `search_logs level=error` is not one pattern.

2. **No false lead is strong in the fault window**
   - Evidence: the only error logs after 10:30 are Delivery's. The carrier error rate and latency are flat in the window. The Notification DLQ is 6 to 7 against a normal 4. Every decoy is rejected by one timestamp. The carrier request drop is the one good lead, and a weak agent only follows it if it never reads `kafka_lag` or the logs.
   - Fix: add a noise item with a signal in the 10:30 to 12:00 window that touches Delivery or Kafka, such as a short Delivery pod restart at 10:40 to 10:45 (a restart reads as "the consumer crashed"), a carrier latency bump or a few carrier 5xx near 10:50, or a `PodRestarts` blip for Delivery. It must be real but unrelated, and the data must be able to reject it.

3. **The time order of the final steps is free, so the depth is shallow**
   - Evidence: steps 2, 3 and 4 do not depend on each other. The alert names the group and the group names the log filter. The case has no step where a result changes the next query.
   - Fix: change the alert text or add noise so the first alert does not name `group=delivery` as the only owner (for example alert on the `order.paid` topic lag, or on `delivery.updated` rate drop), or add a decoy consumer group that also lags a little. Then the agent has to find the stuck group from `kafka_lag` and then the offset from the logs.

4. **The outcome checks give a guess most of the points**
   - Evidence: weak agent 3 made 3 calls, never read a Delivery log, wrote a correct-sounding answer and got 4.44/5 on the outcome. The tests check the sentences, not whether the agent saw the evidence. The same agent gets 1.56/5 on the trajectory, so the total is 6.00/10, above half.
   - Fix: make `outcome/tests.js` read the transcript for the evidence of the claims it checks (for example `names_delivery_consumer_stuck` and `gives_start_time` only count when a tool result in the transcript has the parse error or the 10:48 deploy). Or rely on the judge for `evidence` and state that the deterministic outcome score is not a pass or fail by itself.

5. **The trajectory checks give credit for a call, not for the conclusion**
   - Evidence: weak agent 1 blamed the carrier and still got `checked_carrier_healthy` 1 and `showed_orders_not_shipping` 0.5, because the checks only read which tool ran and the window. Its text said "the Delivery consumer cannot keep up" and matched `names_delivery_consumer_stuck` too, with a wrong diagnosis.
   - Fix: this is a small effect (weak agent 1 still gets 2.44/10). If it matters, tighten `names_delivery_consumer_stuck` so it needs the parse or the offset words, and let `checked_carrier_healthy` need a sentence that says the carrier is healthy (the judge already covers it).

6. **The input is good**
   - Evidence: `KafkaLagHigh [serious] at 2026-11-20 11:33 UTC`, rule, value `1276 > 1000 for 10m`, and `Current time: 2026-11-20 12:00 UTC`. It names no service fault, no change, no cause and no fix. It names only the symptom, which the alert itself names.
   - Fix: none.
