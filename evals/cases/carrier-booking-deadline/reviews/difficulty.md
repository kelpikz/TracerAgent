# Difficulty review: carrier-booking-deadline

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 5/5 |
| Shortcut resistance | 5/5 |
| Depth | 2/5 |
| Cross-source evidence | 3/5 |
| Time reasoning | 2/5 |
| Partial-answer trap | 2/5 |
| Distractors | 5/5 |
| **Total** | **24/35** |

## Blind solve

All times are UTC on Nov 20, 2026. A window means `from` and `to` with ISO timestamps, unless the call explicitly says `start` and `end`. Unlisted arguments used defaults.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `list_alerts`, state=all, start=08:35, end=12:00 | Returned both carrier alerts because the tool ignored the window keys. The 08:47 page resolved at 09:10. | |
| 2 | `third_party_health`, provider=carrier, start=08:35, end=12:00 | The default hour showed normal current latency and one unrelated 11:55 retry. | |
| 3 | `business_kpis`, start=08:35, end=12:00 | The default hour had no stuck pending orders. No incident-window evidence. | Carrier failures likely delayed fulfillment. A client change and a provider problem are both possible. |
| 4 | `third_party_health`, provider=carrier, 08:30–09:30 | Error rate reached 100%. Latency bottomed at 450 ms versus roughly 668 ms normal. Three booking warnings have `deadline_ms=450` and no response. | Suspect a deadline on the client. |
| 5 | `find_traces`, service=delivery, status=error, 08:30–09:30, limit=4 | Three successful payment webhooks contained a failed carrier span with `client context deadline exceeded`. | The caller cancelled outbound booking. |
| 6 | `list_changes`, service=delivery, 06:00–09:30 | Delivery applied a regional profile at 08:42 and restored the standard one at 09:10. | The profile probably set the deadline. |
| 7 | `get_trace`, trace_id=739bba8ae0dacf84237c55fa655d5891 | Payment succeeded and published `order.paid`. The booking failed at exactly 450 ms, then Delivery inserted a retry in Shipments Postgres. | |
| 8 | `get_order_timeline`, order_id=ord_N4VMCY | The order paid, was confirmed and booked on a later retry at 09:10:20. | Confirmed shipping delay after successful checkout. |
| 9 | `search_logs`, service=delivery, text=profile, 08:30–09:30, limit=12 | No results. The settings log uses different wording. | |
| 10 | `business_kpis`, 08:30–09:30 | Checkout and payment averages stayed near 97%, with zero orders stuck pending for 15 minutes. | |
| 11 | `stuck_orders`, state=PAID, older_than_min=15 | Found 31 sampled PAID orders, including the order already booked on retry. | PAID by itself cannot show outstanding bookings. |
| 12 | `search_logs`, service=delivery, text=deadline, 08:15–09:20, limit=15 | `POST /shipments` loaded 450 ms at 08:42 and 5000 ms at 09:10. Warnings reported no response. | The short profile setting is confirmed. |
| 13 | `search_logs`, service=delivery, text=retry, 09:09–09:30, limit=12 | Three sampled retries booked. The queue drain record at 09:22 says 548 retried and zero pending. | Recovery is complete. |
| 14 | `get_order_timeline`, order_id=ord_N8XYNF | Payment and confirmation succeeded. The retry booked at 09:14:21. | |
| 15 | `get_order_timeline`, order_id=ord_6KGQYE | Payment and confirmation succeeded. The retry booked at 09:18:22. | |
| 16 | `query_metric`, metric=booking_retry_queue_depth, 08:30–12:00 | Invalid argument key caused an error. No queue metric evidence. | |

Answer: At 08:42 Delivery applied a regional profile that reduced the booking client deadline from 5000 ms to 450 ms, below normal carrier p95 of about 668 ms. Delivery cancelled requests before getting a response and queued paid orders for shipment booking. Checkout, payment and confirmation continued. The 08:47 page cleared when the deadline returned to 5000 ms at 09:10. The retry drain log recorded 548 retried and zero pending at 09:22. No emergency action remains. Keep the restored setting and verify current retry levels. Correct: yes. The blind answer did not spell out the order-reference lookup used to guard against duplicate shipments.

## Shortest path

1. Run `third_party_health` for carrier from 08:30 to 09:30. The 450 ms timeout warnings, lack of response and carrier p95 of about 668 ms point to a client deadline.
2. Run `search_logs` for `deadline` in Delivery from 08:15 to 09:20. This confirms the `POST /shipments` deadline applied at 08:42 and the previous value restored at 09:10. A broad `log_patterns` search from 08:39 to 09:25 also exposes the first setting and timeout together.
3. For the customer and recovery questions, use `get_order_timeline` on a warning's order ID and `search_logs` for `retry` through 09:30. The order timeline links payment to the delayed booking and the drain record supplies the full count.

## Partial-answer test

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Blames scheduled carrier maintenance and correctly describes the delayed bookings and retry recovery | 4.58/5 | 3.33/5 | 7.91/10 |

The transcript used the alert, historical carrier health, profile change events, one trace, an order timeline and the drain log. It earned trajectory credit for spotting evidence of a client abort even though its answer misattributed that abort to the carrier.

## Findings

1. **The expected cause, customer impact and fix are visible.** The settings logs give both deadlines. The error trace shows the exact cutoff and durable retry insert. Compare it with carrier metrics to confirm the cutoff was shorter than typical responses. `list_changes` supplies the profile names and timestamps. The order timeline shows payment and confirmation followed by late booking. The 09:22 drain log gives the aggregate count. Tracking continued, as shown by a shipment status update at 08:51. The recovered order's retry trace checks for an existing shipment by order reference, receives 404 and books successfully with 201 in 699 ms. These agree with the seed and labels.
2. **The default checks hide both cause and trigger.** Default `list_alerts` and `search_logs` with level=error are empty. Default `log_patterns` and `business_kpis` contain unrelated current activity. The most recent change before the default window is a Cart deploy. Default `third_party_health` for Stripe, carrier and email has no cause or trigger. A default search for `booking_deadline_ms` is empty. In the incident window it finds both settings logs in one call. Alerts and changes in historical windows point to the profile change, but leave its exact setting and failure mode open.
3. **The trigger was five minutes before the page.** The client applied the profile at 08:42 and the first sampled call failed at 08:42:17. Both the trigger and its effect precede the default hour by more than two hours relative to noon. They are close to the page itself. The booking queue grew until 09:10 and drained by 09:22. An older change with delayed activation would test longer cause-to-page reasoning.
4. **The wrong provider explanation earns 7.91/10.** The checker credits a client-side abort that appears in results without checking whether the final answer uses it. Require the applied value and the client-side mechanism for more trajectory credit. Preserve impact and recovery credit where the transcript proves them.
5. **The maintenance alert and booking status are useful distractors.** At 01:00–01:15 the carrier returned real maintenance HTTP 503s. The historical provider logs show those responses and the 08:42 trace shows a local cancellation with no response. Low incident p95 could suggest a healthy provider, but it is clipped at the new 450 ms cutoff. Compare the normal carrier p95 and the successful 699 ms retry. Historical Kafka lag was at most 2 with zero DLQ entries, and the trace shows Delivery persisted the retry, which rejects a stalled consumer. The blind solve tested the PAID backlog, but an already-booked example still had PAID status. Use the explicit booking timeline and drain record to verify recovery. The lone 11:55 timeout belongs to a separate window and uses the normal five-second deadline.
