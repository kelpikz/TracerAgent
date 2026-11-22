# Difficulty review: delivery-schema-break

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 2/5 |
| Shortcut resistance | 2/5 |
| Depth | 2/5 |
| Cross-source evidence | 3/5 |
| Time reasoning | 2/5 |
| Partial-answer trap | 2/5 |
| Distractors | 3/5 |
| **Total** | **16/35** |

## Blind solve

I used 21 calls. I had the full answer after call 4. The other calls were checks of impact and distractors.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `list_alerts` (default) | KafkaLagHigh for group delivery. DlqGrowing for group notification. | Delivery consumer is stuck. |
| 2 | `kafka_lag` (default) | Delivery lag 323 to 2045, normal 1. DLQ for delivery is 0. Other groups normal. | Only delivery is affected. |
| 3 | `list_changes` (default) | `changes` empty. `last_change_before_window`: order v3.4.0 at 10:48, "Structured shipping address for pickup points". | First hypothesis: the Order deploy changed `order.paid` and Delivery cannot read it. |
| 4 | `search_logs` delivery error (default) | Same offset 1854162, order ord_V6WMXG, `schema_version=2`, attempt 18 to 60, "cannot unmarshal object into ... shipping_address of type string". | Confirmed. Hypothesis did not change. |
| 5 | `log_patterns` (default) | Same error is the top pattern, 60 vs 17 before. | Same. |
| 6 | `search_logs` delivery error, 09:00 to 11:00 | First error (attempt 1) at 10:48:19. | Trigger time matches the deploy. |
| 7 | `list_changes` 08:00 to 12:00 | Order deploy 10:48. Cart deploy 09:40. | Cart deploy is not on the path. |
| 8 | `search_logs` text "shipping_address" | Only Delivery lines. No Order producer log. | None. |
| 9 | `business_kpis` | Checkout 96.7%, one stuck order, payment normal. | Checkout and payment are normal. |
| 10 | `stuck_orders` (PENDING) | One order, ord_MB8THH, 34 min. | Not related (1 is below the rule limit of 5). |
| 11 | `get_order_timeline` ord_V6WMXG | Has order.paid published and the confirmation email. Has no Delivery step. | Customer pays and gets the email, but no shipment. |
| 12 | `get_runbook` KafkaLagHigh | No runbook. | None. |
| 13 | `dlq_sample` | 5 old email bounces, "mailbox does not exist". | DlqGrowing is a distractor. |
| 14 | `past_incidents` "schema" | None recorded. | None. |
| 15 | `search_logs` order "order.paid" 10:40 to 10:55 | No lines. | None. |
| 16 | `search_logs` order 10:44 to 10:52 | Only the stuck-orders job and status lines. | None. |
| 17 | `get_service_health` delivery | Healthy. | The consumer is not an HTTP route. |
| 18 | `search_logs` text "schema_version" | Delivery lines only. | None. |
| 19 | `search_logs` text "pickup" | No lines. | None. |
| 20 | `stuck_orders` state PAID | Many old PAID orders from 05:31 on (about 390 min). | Noise. These orders are old and not the same fault. |
| 21 | `query_metric` with wrong argument names | Tool error "Cannot read properties of undefined". | My mistake. |

I did not check the carrier in the blind solve. It was not needed for the cause. I checked it later in the shortcut test (`third_party_health carrier`: 5 requests per minute, normal 24, 0% errors).

Answer: At 10:48 the Order v3.4.0 deploy ("Structured shipping address for pickup points") makes `order.paid` use schema_version 2, where `shipping_address` is an object. The Delivery consumer expects a string. It fails on offset 1854162 (order ord_V6WMXG) and retries in a loop, from 10:48:19. It has no DLQ for this and never reads the later messages. Lag grows from about 0 to 2045 (about 30 orders per minute). Paid orders after 10:48 get no Delivery step, so no shipment. Checkout, payment and the confirmation email are normal. The fault is still active at 12:00. Fix: roll back Order to v3.3.2 or ship a Delivery consumer that reads v2. Then let the backlog drain. Do not skip the message. Correct: yes.

## Shortest path

1. `kafka_lag` shows that only group `delivery` is high and that its DLQ is 0 (lag 2045, normal 1).
2. `search_logs` service delivery, level error shows the parse error, `schema_version=2`, offset 1854162 and the growing attempt count. This is the root cause.
3. `list_changes` shows the Order v3.4.0 deploy at 10:48. It is in `last_change_before_window` in the default call. A wider window shows the same change.
4. `get_order_timeline` ord_V6WMXG shows order.paid and the email, with no Delivery step (impact).
5. `third_party_health` carrier shows about 5 requests per minute against a normal of 24, with 0% errors (carrier healthy, bookings stop).

The root cause needs 3 calls after the page. The full answer needs 5.

## Fairness check

- Root cause (Order v3.4.0, schema v2, object not string): `search_logs` error and `list_changes`.
- Trigger time 10:48 and first error 10:48:19: `list_changes` and `search_logs` with a window that starts before 11:00.
- Retry of the same offset, no DLQ: `search_logs` (offset, attempt) and `kafka_lag` (delivery DLQ 0).
- No shipment, charged, got the email: `get_order_timeline`. Backlog and growth: `kafka_lag`. Carrier call drop and healthy carrier: `third_party_health`.
- Facts only in the labels or the seed: why Notification is not affected (the case already marks it as a bonus, not required). "Do not skip the messages" is a judgment, not data. Neither blocks the gate.

## Shortcut resistance

- `search_logs level=error` (default) shows the full root cause: the exact parse error, `schema_version=2`, offset, order ID. 60 of 61 error lines are this error.
- `log_patterns` (default) shows the same error as the top pattern.
- `list_changes` (default) shows the trigger. The window is empty, but `last_change_before_window` has the Order deploy and its summary, which names the shipping address.
- `list_alerts` and `kafka_lag` name the group. `business_kpis` and `third_party_health` (stripe, email) show nothing wrong. `third_party_health carrier` shows the booking drop but not the cause.
- An agent that reads only the alerts and the changes can guess the cause: the Order deploy is the only change near the page, and its summary matches the problem.

## Partial-answer test

I wrote two transcripts with real tool results and ran `check-case.js` without `--judge`.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| P1: right cause (Order v3.4.0, schema, stuck offset). Wrong fix: "skip the bad message and move the offset", plus restart. Only 3 calls (`kafka_lag`, `search_logs`, `list_changes`). No impact or carrier check. | 2.81/5 | 3.33/5 | 6.14/10 |
| P2: right service and a good fix (consumer reads the new format), but no deploy found and no trigger. Checked the carrier. | 2.81/5 | 2.22/5 | 5.03/10 |

Both get half or more. Neither is under half. The judge would score P1 lower on `next_steps` (0 for "skip"), but I did not run the judge, as asked. The deterministic `does_not_skip_messages` item is already 0 for P1.

## Findings

1. **A default call shows the root cause** (Shortcut resistance, Blind solve, Depth)
   - Evidence: `search_logs` with `level: "error"` and no other argument returns the parse error with `schema_version=2` and `shipping_address`. `list_changes` with no argument returns the Order deploy in `last_change_before_window`. The deploy summary ("Structured shipping address") matches the error text. I had the answer after 4 calls.
   - Fix: make the deploy summary generic (for example "Refactor order event serialization") so the link needs the log. Add 1 or 2 more real changes in the hours before the page (a Delivery config change, a Notification or Catalog deploy) so the Order deploy is not the only candidate. Make the Delivery error less direct: for example the first line has only the offset and "unmarshal error", and the field name is in a trace span or a second log line. Then the agent must combine two sources.

2. **The trigger is inside the default view** (Time reasoning)
   - Evidence: the deploy is 72 min before "now" and 45 min before the alert. `last_change_before_window` shows it without a wider window. Lag starts 1 minute after the deploy, so cause and effect are close.
   - Fix: move the deploy to at least 2 hours before the page. Make the lag start later (for example only pickup-point orders send v2, and they are rare, so the lag grows slowly and reaches 1000 only near the page). Then the default window shows only the retry loop, and the agent must widen the window to find the first error and the deploy.

3. **Few steps to the cause** (Depth)
   - Evidence: page, then error log, then changes. That is 3 calls to the root cause. Each call gives the reason for the next one.
   - Fix: add one hop. For example the Delivery error does not name the field, and the agent must read the Order publish span (`get_trace`, `schema_version` attribute) to find that the payload changed. Or give Order two deploys, where only the first one changed the schema.

4. **Cross-source need is weak** (Cross-source evidence)
   - Evidence: logs plus changes are enough. The time match (10:48:19 first error against the 10:48 deploy) needs two results, but only if the agent widens the window. The metric, order and carrier sources serve impact only.
   - Fix: as in findings 1 and 2, so that the log and the change cannot be linked without a time match.

5. **Distractors are weak or out of view** (Distractors)
   - Evidence: in the default window only `DlqGrowing` (notification), one stuck PENDING order and the "stuck orders job" pattern are visible. Carrier maintenance (01:00) and the Notification OOM spikes are outside it. The Cart deploy (09:40) shows only in a wider window. No distractor competes with the explicit parse error. The old PAID orders in `stuck_orders state=PAID` (from 05:31) are baseline noise and point nowhere.
   - Fix: choose noise that is active in the last hour: for example a Notification OOM restart or a carrier slow period near 11:30, and a Cart or Catalog deploy shortly before the page. Make one of them also raise lag on a different group, so the agent must reject it with a check.

6. **Partial answers get half or more** (Partial-answer trap)
   - Evidence: P1 (right cause, harmful "skip the message" fix) gets 6.14/10. P2 (consumer fix, no deploy) gets 5.03/10. Many trajectory items are free (lag, parse error, efficiency).
   - Fix: in `outcome/tests.js` give `does_not_skip_messages` and `recommends_rollback_or_v2_reader` more weight, or cap the outcome score when the answer recommends a skip. In `trajectory/tests.js` give credit for the cascade items only when the agent also checks impact (order timeline or carrier), so a short 3-call run scores lower. Make `recommends_rollback_or_v2_reader` need the Order deploy in the same answer, so P2 loses points.

7. **Tool fails on a wrong argument** (minor, not scored)
   - Evidence: `query_metric` with `metric` instead of `name` returns "Cannot read properties of undefined (reading 'length')". The trajectory grader accepts both `name` and `metric`, but the tool crashes on one.
   - Fix: make the tool return a clear error for a missing `name`.
