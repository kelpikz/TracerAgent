# Grade the investigation

The page is KafkaLagHigh for group `delivery` at 11:33 UTC. The current time is 12:00 UTC.

**What happened.** At 10:48 UTC the Order `v3.4.0` deploy ("Structured shipping address for pickup points") starts. The new pods publish `order.paid` with `schema_version=2`. In this version `shipping_address` is an object, not a string. The Delivery consumer cannot parse it. It logs `failed to process message, will retry` for the same offset (1854162, order `ord_V6WMXG`), with `schema_version=2` and the error `cannot unmarshal object into Go struct field OrderPaid.shipping_address of type string`. The first error is at 10:48:19, 19 seconds after the deploy. The group `delivery` has no DLQ messages, so the consumer retries the same message for ever, does not move past offset 1854162, and books no shipment. The lag for group `delivery` is near 0 until 10:49. Then it grows with each paid order, to 2045 at 11:59. Carrier booking calls fall from about 29 per minute in the hour before the deploy to about 5 per minute from 10:49. The tools show a normal rate of 24 per minute. The carrier error rate and latency are normal (the average error rate is about 0.1%; at low call counts one failed call can show 8.3% for one minute, at 10:54). The Delivery HTTP metrics are normal, because the consumer is not an HTTP route. Checkout, payment and order emails are normal. The timeline of order `ord_V6WMXG` has the `event published: order.paid` step and the `order_confirmed` email, and it has no Delivery step and no `carrier booked` step. The fault is still active at 12:00.

**Expected path.** The agent follows this chain, in any order of the last steps:
- Step A. The alert is for the `delivery` group. The lag metric shows the start at 10:49 and a lag that never drains. The other groups are normal.
- Step B. The Delivery error logs show one offset that fails again and again, with the parse error.
- Step C. The changes list for 10:00 to 12:00 shows the Order `v3.4.0` deploy at 10:48. The first error is at 10:48:19, so the times match.
- Step D. Impact: an order after the deploy has no Delivery step, or the carrier booking calls fall. Checkout and payment are normal. The carrier is healthy.

Other tools can show the same facts: `query_metric` or `compare_windows` for the lag and for the carrier request rate, `log_patterns` for the Delivery error, and `get_trace` for the v2 `order.paid` publish with no Delivery span. Accept them. The shortest path has 6 calls: `kafka_lag` (10:30 to 12:00), `search_logs` for `delivery` errors, `list_changes` (10:00 to 12:00), `get_order_timeline` for `ord_V6WMXG`, `third_party_health` for `carrier`, `business_kpis`. The normal path has about 20 calls. A good agent that follows its prompt adds `list_alerts`, `get_runbook`, `get_service_health` for a few services, `log_patterns`, `query_metric`, `find_traces`, `get_trace`, `stuck_orders`, `dlq_sample` and a check of the time at which the problem started. Do not count these as waste.

**False leads.**
- The carrier. `ThirdPartyErrors` fired on Nov 20 at 01:05 for the nightly maintenance window (01:00 to 01:15), and it resolved at 01:15. In the fault window the carrier error rate and latency are normal. Booking calls fall because Delivery sends none.
- The Notification memory leak. Notification lag spikes (OOMKilled, drains in minutes) are about every 6 hours. The Notification lag is normal at 12:00.
- `DlqGrowing` for the notification group (firing since 11:51). The messages are `order_shipped` emails to deleted mailboxes (`550 mailbox does not exist`). The `delivery` group has no DLQ messages.
- The stuck order. One order is in PENDING (3-D Secure). The metric is 1, below the rule limit of 5. It is not related.
- The cart `v2.1.0` deploy at 09:40 UTC. It is 68 minutes before the first error, and Cart is not on the path of `order.paid`.
- Restart of Delivery. The consumer is not broken by a pod fault. It fails on the same message.

Score the agent's reasoning in its messages and the tool results together. A step counts as stated only when the agent says it.

Give a short reason for each score. A transcript with no tool calls gets 0 for each item.

1. **followed_the_cascade**
   - 1. The agent moves from the lag alert to the `delivery` group, to the Delivery error logs (the same offset, the parse error), to the Order `v3.4.0` deploy, and links the first error time to the deploy time. Each step uses a result from the step before.
   - 0.5. The agent reaches the Order deploy as the cause, but skips a step (for example it never reads the Delivery error), or it does not link the deploy time to the first error.
   - 0. The agent jumps to a cause with no path, or it stops at "Delivery is stuck" and never reaches the deploy.
2. **course_correction**
   - 1. The agent sees the false leads that appear in its own tool results (the carrier maintenance alert, the Notification lag spikes or DLQ alert, the cart deploy, the stuck order) and gives evidence to reject them: timing, a normal carrier error rate, normal Notification lag, or the DLQ reason. A false lead that the agent never sees needs no reply. A firing alert that the agent lists (`DlqGrowing`) counts as seen.
   - 0.5. The agent rejects some false leads with evidence and leaves others without evidence, or it drops them with no evidence.
   - 0. The agent stays on a false lead as the cause, or it blames the carrier or a restart of Delivery without a check.
3. **efficiency**
   Do not count the calls of the normal path as waste. Waste is: the same query again with no new purpose, the same fact read from two tools, and calls on unrelated areas after the cause is clear (for example the databases, Redis, Catalog, Payment traces or the gateway).
   - 1. Two or fewer wasted calls.
   - 0.5. Three to six wasted calls, but the investigation stays on track.
   - 0. More than six wasted calls, or the investigation goes off track.
