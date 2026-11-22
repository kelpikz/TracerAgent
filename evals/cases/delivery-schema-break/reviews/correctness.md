# Correctness review: delivery-schema-break

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 3/5 |

## Findings

1. **Rollback alone gets full credit, but it does not fix the fault** (false positive, fact)
   - Evidence: the Delivery error log shows the same message (offset 1854162, `ord_V6WMXG`) retried through 11:59, and 2044 more `order.paid` events (all v2) wait behind it. A rollback of Order does not change these messages. The prompt's own "Correct actions" text says a Delivery fix is also needed. But the `next_steps` anchor in `outcome/prompt.md` gives 1 for "roll back Order, or deploy a Delivery consumer that reads v2", and `recommends_rollback_or_v2_reader` is `rollback || reader`.
   - Test: transcript "Roll back Order to v3.3.2. Then wait and the backlog will drain by itself." (with a correct diagnosis) scores 9/9 on `outcome/tests.js`. "Roll back Order to v3.3.2. The Delivery consumer will then resume and process the backlog." also keeps 9/9. Both are wrong: after the rollback the consumer is still stuck.
   - Fix: a rollback alone is at most 0.5 in `next_steps`. Give 1 only when the answer also has a Delivery consumer that reads v2 (or a converter). Split the test item in two: `recommends_rollback` and `recommends_v2_reader`. Do not credit "the backlog drains after the rollback".

2. **A wrong-cause answer gets 7/9 from the tests** (false positive)
   - Evidence: the answer "The carrier is the root cause ... after the Order deploy at 10:48 UTC. Please wait for the carrier to recover. The Delivery consumer is stuck and orders do not ship, and the lag is still growing. Roll back the Order deploy v3.4.0 to be safe." scores `names_order_deploy` 1, `names_delivery_consumer_stuck` 1, `gives_start_time` 1, `says_orders_not_shipping` 1, `says_fault_still_active` 1, `recommends_rollback_or_v2_reader` 1, `does_not_skip_messages` 1. Only `deploy_changed_the_schema` and `no_false_lead_as_cause` are 0. That is 3.9/5 for the wrong root cause. The file header says an answer with no Order deploy scores below half, but a mere mention of the deploy is enough.
   - Fix: make `names_order_deploy` need a sentence that links the deploy to the Delivery failure (or the schema). Make `gives_start_time` and `recommends_*` need `no_false_lead_as_cause` (not `blamesLead`). The rubric half already scores this answer low, so this is a fix for the test half only.

3. **`does_not_skip_messages` gives 0 to correct answers** (false negative)
   - Evidence (each added to a correct answer, each scored 0):
     - "Let the consumer clear the backlog." (matches `clear the backlog`)
     - "Ignore the DlqGrowing alert, its messages are about deleted mailboxes." (matches `ignore` + `message`)
     - "Acknowledge the alert after the lag drains, then close it." (matches `acknowledge`)
     - "Skip nothing: every message must be read." and "The stuck message must be consumed, not skipped."
   - Fix: limit the skip patterns to the stuck message or the offset (for example `skip the (stuck|bad|failing) message`). Remove `clear the backlog` and `acknowledge` without a message object. Accept "not skipped", "skip nothing".

4. **`does_not_skip_messages` gives 1 to a harmful action** (false positive)
   - Evidence: "Then move the bad message to a dead letter queue by hand." and "Then move the bad message aside and go on." both score 1. The rubric calls these actions skips that lose orders. The pattern needs the literal `dlq`, so `dead letter queue` is missed.
   - Fix: add `move ... (aside|out of the way)` and `dead[- ]letter queue` to the skip patterns.

5. **`says_orders_not_shipping` misses the plain wording** (false negative)
   - Evidence: each of these scores 0 in a correct answer: "No paid order is shipped since 10:49 UTC.", "Paid orders are not getting shipped since 10:49 UTC.", "Nothing ships since 10:49 UTC.", "Customers are charged but their orders are never shipped." The patterns `not (being)? shipped` and `nothing (is)? shipped` are too narrow.
   - Fix: add `no (paid )?orders? (is|are) shipped`, `not getting shipped`, `nothing ships`, `never (be )?shipped`, `no .* booked`.

6. **`says_fault_still_active` misses common wording** (false negative)
   - Evidence: each scores 0: "The lag has not recovered at 12:00." (the `recovered(?! yet)` exclusion removes it), "The fault has not been fixed yet and the backlog is 2045.", "The incident is not over. Lag is 2045 at 12:00 UTC.", "This is an ongoing incident." (`incident` is not in the context list), "As of 12:00 UTC the lag stands at 2045 messages."
   - Fix: add `not (been )?(fixed|over)`, accept `incident`, and remove the `recovered` exclusion when `not|n't|no` comes before it.

7. **`no_false_lead_as_cause` penalizes a correct rejection** (false negative)
   - Evidence: adding "The Notification memory leak causes short lag spikes but they drain in minutes, so it is a separate known issue." to a correct answer gives `no_false_lead_as_cause` 0. `memory leak ... causes` matches the blame pattern. The sentence rejects the lead.
   - Fix: skip sentences that contain `separate`, `known issue`, `drain`, or `but` before the causal verb. Or only count a lead as blamed when the sentence says it is "the cause" or "root cause".

8. **Wording gaps in the cause checks** (false negative, small)
   - Evidence: "broke the contract of the order.paid event" scores `deploy_changed_the_schema` 0. "the Delivery consumer rejects it, again and again" scores `names_delivery_consumer_stuck` 0.
   - Fix: add `contract`, `break\w*`, `reject\w*`, `again and again` to the word lists.

9. **Efficiency gives full credit with no evidence** (false positive, small)
   - Evidence: one call to `list_services` scores `efficiency` 1 (0.63/10 total). Three failed calls to an unknown tool also score `efficiency` 1 (0.63/10). A wrong carrier-only investigation (`third_party_health`, `business_kpis`, `kafka_lag`, then "wait for the carrier") scores 4.5/8 on `trajectory/tests.js`: `checked_delivery_lag` 1, `showed_orders_not_shipping` 0.5, `checked_carrier_healthy` 1, `checked_checkout_normal` 1, `efficiency` 1.
   - Fix: count only successful calls, and give `efficiency` 0 when no cause item (`found_order_deploy`, `found_delivery_parse_error`) has credit.

10. **Health checks need only one metric** (false positive, small)
    - Evidence: `query_metric third_party_latency_p95_ms` for the carrier alone gives `checked_carrier_healthy` 1, and `query_metric payment_success_rate` alone gives `checked_checkout_normal` 1. The rubric text says error rate and latency (carrier) and checkout and payment (KPIs).
    - Fix: for the carrier, need the error rate (a `third_party_health` call, or the error-rate metric). Keep the latency as a bonus.

11. **Coverage: some needed facts have no check in `tests.js`** (coverage)
    - Evidence: no test grades the backlog size (about 2,000) or the duration (about 70 minutes), that customers are charged and get the email, that checkout and payment are normal, that the other groups are normal, that the `delivery` group has no DLQ messages, or that the answer says to check that the lag drains and bookings resume. A transcript with "Roll back Cart ... and restart the Delivery pods" scores 1 on `does_not_skip_messages`; only `recommends_rollback_or_v2_reader` is 0. These parts are graded by the rubric only, which is allowed, but the tests half does not cover them.
    - Fix (optional): add `says_checkout_unaffected` and `says_lag_drains_check` items. Add restart-only, cart rollback, and wait-for-carrier to the wrong-action check.

12. **Alert value is one minute old** (cascade, small)
    - Evidence: `KafkaLagHigh` fired_at 11:33 says "1276 > 1000 for 10m". The lag is 1276 at 11:32 and 1298 at 11:33. The lag first passes 1000 at 11:23 (1012), so the fire time (11:23 plus 10 minutes) is correct. The `ThirdPartyErrors` alert uses the same rule (the value of the last minute of the window). The text is also copied into `case.json` `input`.
    - Fix: none needed. Optional: use the value at the fire minute.

13. **DLQ orders are not in `orders.json`** (cascade, small, in the noise item)
    - Evidence: the five orders in the Notification DLQ logs (`ord_G9BAPH`, `ord_V3X3XV`, `ord_47W33Y`, `ord_Z63MSS`, `ord_4FP4Y8`) are not in `orders.json`. An agent that calls `get_order_timeline ord_G9BAPH` gets "not found". This does not touch the Delivery fault, and `orders.json` is a sample.
    - Fix: none needed for this case.

## Checked and correct

Cascade (all from `data/delivery-schema-break/`):
- Trigger: `events.json` has the Order `v3.4.0` deploy at 10:48:00 (previous `v3.3.2`, "Structured shipping address for pickup points"). The Order logs show two pods roll (SIGTERM, `starting order v3.4.0`, `ready`) at 10:48:05 to 10:48:51. Order CPU and p95 get the short deploy bump. Order pods stay ready, with no restarts and no error rate change.
- First v2 event: `ord_V6WMXG` is created at 10:48:14, PAID at 10:48:18, `order.paid` published at 10:48:18.799. Its trace `22bcd2f8...` has `kafka publish order.paid` with `schema_version=2`, a Notification consume and email span, and no Delivery span. All 8 later sampled paid orders show the same, and no span from before 10:48:19 has `schema_version`.
- Delivery consumer: 77 error logs from 10:48:19.026 to 11:59:24, all for offset 1854162, `order_id=ord_V6WMXG`, `schema_version=2`, with the exact unmarshal error. The `attempt` count goes 1 to 77. The backoff is 1, 2, 4, 8, 16, 32 s, then 60 s. No `carrier booked` or `carrier timeout` log and no Delivery consume or carrier POST span after 10:48:19.
- Kafka: `kafka_consumer_lag{group=delivery}` is 0 to 3 until 10:48, 23 at 10:49, 1298 at 11:33, and 2045 at 11:59 (about 29 per minute, the same as `order.paid` messages in). The `kafka offsets committed` log lag matches the metric (40 at 10:50, 323 at 11:00). Groups `order` and `notification` stay at 0 to 9. `kafka_dlq_size{group=delivery}` is 0 all day. `kafka_messages_in_per_min{order.paid}` is unchanged, and `delivery.updated` falls from about 35 to about 8 per minute (only the carrier webhooks for older orders are left).
- Carrier: `third_party_requests_per_min{carrier}` falls from 29.0 (09:49 to 10:49) to 5.2 (10:49 to 12:00). The error rate average is 0.11%, with one minute of 8.33% at 10:54 (1 failed call out of 12). Latency is flat (about 680 ms). `ThirdPartyErrors` does not fire in the fault window.
- Unaffected parts, as the prompts say: Delivery HTTP (about 2 req/s), `POST /webhooks/carrier` (11 spans, older orders), Delivery pods ready 2 and no restarts, `get_service_health delivery` healthy. Checkout success 96.8% and payment 97.1% (baseline 97.2%). Stripe, email and `emails_sent_per_min` are normal. The sampled v2 orders all have the `order_confirmed` email.
- Orders: before the deploy `ord_GHFZEN` and `ord_75HZZE` have Delivery steps. After 10:48:14, 8 PAID orders have no Delivery step and have the confirmation email. Their SHIPPED step would come 3 to 9 hours later, after the window.
- Alerts: `KafkaLagHigh` fired 11:33 (lag over 1000 from 11:23, 10 minutes) and has no resolve time. `DlqGrowing` fired 11:51 (Notification DLQ 6 to 7 at 11:51, log "moved to DLQ" for `ord_G9BAPH`, mailbox does not exist). No other rule fires. `OrdersStuckPending` stays ok (1, below 5).
- Noise: `carrier_maintenance` (carrier errors 85 to 96% from 01:00 to 01:14, alert 01:05 to 01:15), `notification_oom`, `stuck_3ds` (`ord_MB8THH`, PENDING from 11:26), `cron_jobs`, and `price_scraper` do not touch the Delivery path. The cart deploy (09:40) is 68 minutes before the first error.
- Facts in both prompts check out: 10:48:19 (19 s after the deploy), offset 1854162, lag 2045 at 11:59, carrier 29 to 5 per minute, tool "normal" 24 per minute, 8.3% at 10:54, `DlqGrowing` since 11:51, stuck-order metric 1, about 70 minutes.

Checks:
- `check-case.js delivery-schema-break`: good fixture 10.00/10, bad fixture 2.67/10, empty transcript 0 for every item. Nonsense prose and keyword lists get 0 on `outcome/tests.js`.
- `trajectory/tests.js` accepts other correct paths. A transcript with `query_metric` for lag (10:40 to 11:40), `search_logs` with `text=unmarshal`, `search_logs` for Order start-up logs, `query_metric` for carrier requests and latency, `payment_success_rate`, and a `get_order_timeline` for `ord_5UW56G` scores 8/8. A transcript with `log_patterns` for Delivery and Order, `compare_windows` for carrier requests, and a `get_trace` of the v2 trace scores 8/8.
- Windows are graded as the prompt says: default-window calls (`kafka_lag` with no window) give 0.5 for the lag, a window that starts at 10:50 gives 0.5, and a Delivery log search with the default window finds the error but gets 0.5 for the start-time match.
- `search_logs` / `log_patterns` / `list_changes` results hold the facts the checks read (error text, `v3.4.0`, `order v3.4.0` start-up logs).
- Wrong-answer checks work for: restart plus skip the message (`does_not_skip_messages` 0), reset the consumer group to latest (0), roll back Cart (`recommends` 0), carrier blame (`no_false_lead_as_cause` 0), and no Order deploy (4/9 or less).
- Correct answers in other words pass: "Release v3.4.0 of the order service ... Revert ... patch the delivery consumer ... Do not delete anything" scores 9/9. Denials of false leads (carrier healthy, DLQ is about deleted mailboxes, cart not on the path, 8.3% is one failed call, do not restart or wait for the carrier) all keep `no_false_lead_as_cause` 1.
