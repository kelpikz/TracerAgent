# Discrimination review: carrier-booking-deadline

| Part | Score |
| --- | --- |
| Difficulty | 1/5 |
| False leads | 4/5 |
| Input | 5/5 |
| Depth | 2/5 |
| Grader separation | 3/5 |

## Path from symptom to cause

1. Subtract the five-minute evaluation window from the 08:47 page. Run `search_logs` from 08:42 to 08:43 UTC without a service filter. The first row records the Delivery booking client setting `booking_deadline_ms=450` for `POST /shipments`. About 18 seconds later a row records a booking timeout and queued retry with `deadline_ms=450` and `response_received=false`.

The shortest path takes one tool call. A weak agent reads the provider error rate as an outage and misses the link between the applied setting and the client timeout. The obvious `third_party_health` query returns both the error rate and the local timeout samples. It takes the settings log to confirm when the deadline was applied. The two carrier alerts and the 08:42 profile apply and 09:10 restore events make the later client change a strong guess from `alerts.json` and `events.json`. Those files omit the deadline and failure mechanism.

The input gives `ThirdPartyErrors [serious] at 2026-11-20 08:47 UTC` and `third_party_error_rate{provider=carrier} 100.0% > 5% for 5m`. It includes severity, time, rule, measured value, and `Current time: 2026-11-20 12:00 UTC.` The provider label identifies the measured dependency. The page omits Delivery, the profile, and the fix.

## False leads

- Earlier carrier maintenance fired `ThirdPartyErrors` at 01:05 and also delayed bookings. A weak agent may reuse that diagnosis for the later page. Compare the alert windows and inspect a maintenance log. From 01:00 to 01:15 the provider returned HTTP 503. In the later window Delivery cancelled calls and logged that it received no response.
- The carrier error rate reaches 100% at the 08:47 page. A weak agent may infer provider slowness. Check a failed span and the settings logs. The failed `POST /shipments` span ends at the 450 ms client deadline. The mean of minute carrier p95 was 645 ms before rollout. Errors fall after Delivery restores 5,000 ms.
- `delivery.updated` falls while paid orders continue. A weak agent may suspect a Kafka consumer problem. Check Delivery lag and the trace. Lag peaks at two, the dead-letter queue stays empty, and Delivery consumes `order.paid` and persists a retry after the outbound timeout.
- Checkout and payment continue, and the stuck-pending metric stays at zero. A weak agent may conclude every order completed normally. Read a timed-out order timeline. The order reached PAID, received confirmation, and waited for booking until its retry.

## Test transcripts

I rebuilt the transcripts with real tool results from freshly generated case data. I ran `check-case.js` on the transcripts under `evals/results/discrimination-review-abc/`. These are deterministic scores.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent checks the correct alert, provider health, and KPIs. It blames carrier slowness and waits for bookings to catch up. | 2.50/5 | 1.67/5 | 4.17/10 |
| Good agent starts with alert history and Delivery changes, then checks logs, an order, its trace, maintenance, baseline latency, KPIs, and post-recovery errors. | 5.00/5 | 5.00/5 | 10.00/10 |
| Shortcut searches Delivery logs once for `carrier booking` from 08:41 to 09:23 with `limit=16`. It reports the deadline, timeout, restored setting, and queue drain. | 4.17/5 | 5.00/5 | 9.17/10 |

The weak transcript earns fewer than half the points. The one-query shortcut remains within 0.83 points of the good transcript. Explicit denials, proposed checks, and open questions reused the weak tool path and each earned 0.00/5 for outcome.

## Findings

1. **One log search gives almost all of the scored evidence**
   - The same result contains the 450 ms setting, timeout samples, the restored 5,000 ms setting, and the 09:22 record of 548 retries with zero pending. The shortcut earns full outcome credit without examining an order, comparing against maintenance, or verifying the post-rollback error rate.
   - Score a paid order's successful payment or confirmation before its booking wait. Require an error-rate recovery check and a drained queue for full recovery credit. Credit the comparison with maintenance or baseline carrier latency.
2. **The trajectory credits timeout retrieval and alert resolution even when the answer blames the carrier**
   - The weak transcript retrieves local timeout samples from `third_party_health` and receives `checked_client_abort`. It attributes those failures to provider slowness. The alert resolving at 09:10 receives recovery credit without verifying the queue drain at 09:22.
   - Give credit for finding the timeout sample. Score the interpretation in the outcome and distinguish alert clearance from the later end of the backlog.
