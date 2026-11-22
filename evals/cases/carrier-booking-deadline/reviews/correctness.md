# Correctness review: carrier-booking-deadline

| Part | Score |
| --- | --- |
| Completeness of the cascade | 5/5 |
| Correctness of the checks | 2/5 |

## Findings

1. **Carrier symptom credit can come from the wrong time or from zero samples** (false positive)
   - `wrong-window` queries provider health from 01:00 to the 08:42 boundary. The peak is 95.98% at 01:10 during maintenance, and the grader awards symptom credit. `empty-metric` queries 08:42:01 to 08:42:15, receives no data points, and earns the same credit. Cancellation and setting checks still use unscoped text matches and do not identify the Delivery booking operation or the corresponding event time.
   - Use an in-window measurement or alert and verify its value. Check the operation, service, timestamp, and deadline fields on cancellation and profile evidence.

2. **Impact and recovery checks accept isolated details** (false positive, false negative)
   - In `wrong-window`, one `delivery.updated` point earns booking-impact credit. The 5,000 ms setting alone earns recovery credit. The provided bad fixture earns recovery credit through alert history without checking the retry backlog. In `actual-retries`, provider health after rollback, three successful retry logs, and normal Delivery Kafka lag earn zero trajectory points.
   - Score paid-order delay, disappearance of new cancellations, and retry drain separately. Accept actual retry successes and normal Kafka lag as supporting evidence. A topic change needs a comparison or an order link.

3. **The deterministic outcome does not grade the recommended action** (coverage)
   - The three checks cover the deadline, delayed bookings, and retry recovery. An answer can earn full credit without saying whether checkout and confirmations continued or what to do about potentially duplicate bookings.
   - Score payment and confirmation scope, recovery verification, and the safety of any replay recommendation.

4. **Full trajectory credit can omit recovery verification** (coverage, false positive)
   - The trajectory prompt now correctly asks the agent to confirm that payment and confirmation continued. Its scored investigation anchors still allow full credit without checking both recovery milestones. The outcome prompt covers the two milestones and unsafe replay, but its full impact anchor can be met with a count or a time. `distinct-waste` earns full deterministic efficiency after two useful calls and ten irrelevant Stripe checks over distinct minute windows. The judge anchor leaves the empty investigation eligible under its literal waste limit.
   - Grade the end of new errors and the backlog drain in the trajectory. Use the available time and order count to calibrate full impact credit. Require substantive evidence for positive efficiency and count irrelevant calls as waste.

## Checked and correct

- The profile events and settings logs agree on 450 ms at 08:42 and 5,000 ms at 09:10. Trace `739bba8ae0dacf84237c55fa655d5891` shows Delivery persisting a retry after cancelling `POST /shipments` without a provider response. The Stripe webhook returns 200. The metadata now defines third-party errors to include timeouts.
- Checkout, Stripe, Orders Postgres, and the `order.created`, `payment.succeeded`, and `order.paid` paths continue. Checkout and payment success average 95.84% and 96.19%, matching baseline. All three sampled affected orders pay and receive confirmations. The relative order of the confirmation and booking timeout varies. Existing shipment updates and notifications continue, including the 08:51 delivery update for `ord_TKM3JT`.
- All 548 `order.paid` events in the fault window have corresponding deferred bookings in the model. `delivery.updated` loses 548 events against baseline and regains 548 during recovery. The Delivery Kafka lag stays at 0–2, its DLQ stays empty, and Shipments Postgres stays available. Queue samples show 486 pending at 09:06:59, 318 at 09:14:59, 90 at 09:19:59, and zero at 09:22.
- Retry trace `85b4e77b936a4d43766de415db6cd34c` looks up the order reference, books the shipment, and completes the retry row with the shipment and outbox insert. The correlated `BOOKED` event updates the order ETA and skips the shipping email. The recovery window adds 1,096 carrier calls. Carrier p95 now reflects the call mix, at 450.0–729.4 ms during the fault and 647.7–702.6 ms while retries run.
- The 08:47 page uses the 100% value at 08:46, the last qualifying minute. The error rate is 0% at 09:10 and the page resolves then. The distinct maintenance alert fires at 01:05, resolves at 01:15, and has explicit 503 logs. The good fixture now includes the alert history supporting error clearance.
- The revised outcome grader gives `wrong-window` 0/5 for blaming the earlier maintenance and reporting its drain as recovery. It gives `actual-retries` 5/5 for equivalent wording about the deadline, waiting for the carrier to book shipments, and completing the deferred jobs. Ten identical Stripe checks in `waste` now earn zero efficiency credit.
- Replaying each fixture call against the regenerated data matched its recorded result. `check-case.js` scores the good fixture 10.00/10, the maintenance-focused bad fixture 3.34/10, and both empty checks zero. Alternate transcripts in `data/correctness-recheck/` use actual tool responses. I reviewed the judge prompts by inspection.

## Implementation verification

The scores above describe the independent review snapshot. The empty metric response and the earlier maintenance window earn zero symptom credit. Recovery credit now accounts for both the drop in new errors and the retry drain. The alternate answer about delayed shipments and completed retry jobs earned full outcome credit. The model rubric still judges whether distinct calls waste time.
