# Correctness review: stripe-empty-responses

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 2/5 |

The test transcripts are in the reviewer scratchpad (`rev/*.json`). The script `fill-transcript.js` made their tool
results from `data/stripe-empty-responses/`. The scores below come from `check-case.js` (deterministic checks only).

## Findings

1. **A wrong cause gets 9.58/10** (false positive)
   - Evidence: `fp_wrong_cause.json`. Calls: `business_kpis`, `list_changes`, `third_party_health(stripe)`, and
     `get_trace` on the fast, successful trace `58761a412e170ca8a971c086729c5b00`. The answer says "The Order v4.12.0
     deploy triggered the checkout failures", "Stripe latency is normal and Stripe is not failing", and "Redeploy
     v4.11.3 now". Score: 9.58/10 (trajectory 4.58/5, outcome 5.00/5).
   - Fix: see findings 2 to 6. Each one is a part of this result.

2. **`names_stripe_as_cause` accepts a sentence that clears Stripe** (false positive)
   - Evidence: `outcome/tests.js` gives 1 when a sentence has "stripe" and a word such as `latency` or `failing`. It
     does not check for negation. "Stripe latency is normal" and "Stripe is not failing" both give 1 in
     `fp_wrong_cause.json`. `names_empty_response` and `states_ongoing` depend on this item, so they also give 1.
   - Fix: reject the sentence when `negated(s)` is true or when it has `normal`. Require a fault word next to
     "stripe" (`slow`, `degraded`, `empty`, `cause`).

3. **`rejects_order_deploy` misses other words for blame and rollback** (false positive)
   - Evidence: `fp_wrong_cause.json`. "triggered" is not a blame word. "Redeploy v4.11.3" is not a rollback word.
     Score: 1.
   - Fix: add `redeploy`, `downgrade`, `go back to` and `v4\.11\.3` to the rollback pattern. Add `triggered`,
     `led to`, `introduced`, `started` (without negation) to the blame pattern.

4. **`gives_impact_size` counts numbers that are not the impact** (false positive)
   - Evidence: `fp_impact_latency.json`. The answer "Stripe is slow (p95 9,791 ms) and returns empty bodies, so
     checkout is affected." gets `gives_impact_size: 1`. The regex finds `791` after the comma in `9,791`. It also
     accepts any percent from 30 to 70 in the text, for example the 41.7% from the alert in the input.
   - Fix: require the number in a sentence with `checkout`, `order` or `fail`, and not followed by `ms` or `s`.
     Do not let `\b` match after a comma that is part of a number.

5. **`located_failing_hop` accepts a successful trace** (false positive)
   - Evidence: `fp_ok_trace.json`. `get_trace` on `fdaf8bfd94403834593420a8c4623649` (11:43, HTTP 201, Stripe 312 ms)
     gets `located_failing_hop: 1`. `fp_wrong_cause.json` gets 1 in the same way. These traces show a healthy
     Payment to Stripe call.
   - Fix: also require `c.result.status === 'error'`, or a Stripe span over 3000 ms.

6. **`efficiency` gives full credit to a wrong or empty investigation** (false positive)
   - Evidence: `nonsense4.json` (4 calls to `list_services`, answer "I like turtles.") gets `efficiency: 1`, score
     0.83/10. `bad_transcript.json` (wrong cause) gets `efficiency: 1` and `gives_impact_size: 1`, score 3.33/10.
   - Fix: give efficiency credit only when the agent found evidence, for example `parseScore >= 0.5` and
     `whereScore === 1`.

7. **A correct answer that says "the Stripe error rate is fine" loses 3 items** (false negative)
   - Evidence: `fn_fine.json`. It is the good transcript with one change: "The Stripe error rate is fine (0%),
     because the responses are HTTP 200." `clearsStripe` matches "is fine". Score: `names_stripe_as_cause: 0`,
     `names_empty_response: 0`, `states_ongoing: 0`. Total 7.50/10.
   - Fix: do not treat a sentence as a verdict when it names a metric (`error rate`, `5xx`, `status code`). Clear
     Stripe only when the sentence has Stripe as the subject of `healthy`, `fine` or `not the cause`.

8. **Correct answers with different words get no credit** (false negative)
   - Evidence: `fn_words.json` (good tool calls). "Rolling back Order is pointless" gives `rejects_order_deploy: 0`.
     "about six in ten checkouts fail" gives `gives_impact_size: 0`. "the problem persists at 12:00" gives
     `states_ongoing: 0`. Total 7.50/10.
   - Fix: add `pointless`, `would not help`, `useless` to the negation list. Accept `six in ten`, `3 in 5`, and a
     fraction. Add `persist\w*`, `continuing`, `keeps? failing`, `not over` to the ongoing pattern.

9. **Stripe webhooks drop more than paid orders** (cascade, small)
   - Evidence: `webhooks_received_per_min{provider=stripe}` is 0 at 11:33, but `order.paid` is 7. In 9 minutes of
     the fault, webhooks are more than 5 below `order.paid`. From 11:20 to 12:00 there are 428 webhooks and 459 paid
     orders. In the hour before, the two values are almost equal (1651 and 1646). The cause: the baseline webhook
     count is independent noise, and the code subtracts `fail` from it.
   - Fix: set the webhooks to the paid count (`order.paid`) in each fault minute.

10. **Payment request rate does not drop with the webhooks** (cascade, small)
    - Evidence: `http_requests_per_second{service=payment}` stays at 3.6 to 4.6 req/s. The Stripe webhooks are half
      of Payment traffic and drop by about 20 per minute. The Payment error rate uses the unchanged rate.
    - Fix: optional. Subtract the missing webhooks from the Payment request rate.

11. **Most parse error lines link to no order and no trace** (cascade, small)
    - Evidence: 173 of 191 `failed to parse stripe response` lines have no `trace_id`. Their `order_id` (for example
      `ord_G4Z984` at 11:20:38) is not in `orders.json`. The gateway has no access line for them. Only the 18 sampled
      checkouts link to an order and a trace.
    - Fix: acceptable as sampling. Optional: tell the agent in the prompt that `find_traces` gives the linked IDs.

12. **The 3-D Secure noise checkout has a fast Stripe call without `body_bytes`** (cascade, small)
    - Evidence: trace `479c4343...` at 11:26:17 (`stuck_3ds`, order `ord_MB8THH`) has a Stripe span of 359 ms and no
      `body_bytes`. All 29 incident checkouts have `body_bytes`. 3 of them are also fast, so this is not a
      contradiction.
    - Fix: optional. When the noise checkout falls in the fault window, give it a slow Stripe span and `body_bytes`.

## Checked and correct

- **Cause.** `third_party_latency_p95_ms{provider=stripe}` is 320 to 447 ms from 11:10 to 11:19 (24 h median
  372 ms). It is 9005 to 9791 ms from 11:20 to 11:59. `third_party_error_rate{provider=stripe}` is 0 in the fault.
  `third_party_requests_per_min{provider=stripe}` equals `checkout_attempts_per_min`.
- **Payment.** 191 `failed to parse stripe response` lines from 11:20, 0 before. Fields: `error=unexpected end of
  JSON input`, `stripe_latency_ms` 5000 to 9900. No log says that the body is empty (0 lines). This agrees with the
  prompt. Payment p95 is 9020 to 9806 ms. Error rate is 4.0 to 10.1% (normal 0 to 0.4%).
- **Traces.** 29 incident `POST /checkout` traces from 11:20. 18 fail with 502. Each has a Stripe span of 5.0 to
  9.6 s, `http_status=200`, `body_bytes=0`, then a failed `parse stripe response` span. 11 succeed with `body_bytes`
  1910 to 2578 (8 slow, 3 fast). Order's own DB spans take 7.5 to 16 ms. Baseline checkouts before 11:20 have no
  errors.
- **Order.** 191 `checkout failed: payment error` lines (`upstream_status=502`, `status=PAYMENT_FAILED`). Each one
  has the same `order_id` as a parse line. Order p95 is 9050 to 9836 ms. Error rate is 3.4 to 8.7%.
- **Catalog.** 18 `stock released` lines, one for each failed sampled checkout. The order timelines show stock
  reserved, the payment failure, stock released, and `PAYMENT_FAILED`.
- **Deploy dead end.** Order v4.12.0 at 11:16 in `events.json`. The last pod is ready at 11:17:41. Order error rate
  is 0 at 11:18 and 11:19. Order p95 is 508 and 412 ms. Six `GET /orders/:id` traces after the deploy take 5 to
  10 ms. 51 `gift_note` warnings from 11:18:06, and they do not link to failed checkouts.
- **Business.** `checkout_success_rate` is 22.2 to 56.5% from 11:20 (24 h mean 97.2%). 1182 attempts. 457 succeed
  (38.66%), so 725 (61%) do not. 686 (58%) fail because of the incident. These values agree with
  `outcome/prompt.md`. The 85.7% at 11:19 is baseline noise (65 baseline minutes are below 90%).
- **Kafka, emails, carrier.** `order.created`, `payment.succeeded`, `order.paid` drop from about 30 to 6 to 19 per
  minute. `emails_sent_per_min` drops from 53 to 96 to 18 to 45. Carrier requests drop. No failed order has an
  email, PAID, or carrier event. All 11 PAID orders in the fault have 3 such events.
- **Pending orders.** `orders_pending` drops in proportion. `orders_stuck_pending_15m` is 1 from 11:42 (the 3-D
  Secure order from 11:26). OrdersStuckPending does not fire (rule > 5).
- **Unaffected parts.** Gateway p95 stays 67 to 85 ms. Gateway error rate rises to 0.2 to 0.5% (below 2%). Browse,
  login and cart traces are normal.
- **Alerts.** All match the rules. CheckoutSuccessLow and PaymentSuccessLow fire at 11:29 (the condition is true
  from 11:19, and 41.7% is the 11:28 value). ServiceErrorRateHigh fires at 11:25 for Payment (5.1%) and Order
  (4.0%). ServiceLatencyHigh fires at 11:30 for both (normal 353 and 436 ms). DlqGrowing at 11:51 is the noise item.
  ThirdPartyErrors does not fire.
- **Noise.** `dlq_deleted_users` (DLQ 6 to 7 at 11:51), `price_scraper` (429 at 11:07 and 11:08), `catalog_gc` (GC
  pause at 11:37) and `stuck_3ds` are present. They do not change the fault signals.
- **Charges.** "No one is charged" is only in `labels.json`. Both prompts say a charge claim is not required.
- **Checker.** Good transcript 10.00/10. Bad transcript 3.33/10. Empty transcript 0 on all items.
- **`checked_checkout_impact`.** Needs an impact metric in the fault window. A call outside the fault gives 0.5.
- **`checked_stripe_latency`.** Full credit needs a window that sees the 11:20 step. The bad transcript (only the
  Stripe error rate) gets 0.
- **`found_empty_response`.** Full credit needs a `get_trace` result with `body_bytes:0`. The parse error alone
  gives 0.5. No baseline result has these texts.
- **`checked_order_deploy`.** Needs a `list_changes` result with the Order v4.12.0 deploy. The judge item
  `course_correction` grades the rejection.
- **`names_parse_failure`, `names_empty_response`.** Accept `blank`, `zero-length`, `decode`, `unexpected end of
  JSON input` (`fn_words.json` gets 1 on both).
- **Judge prompts.** All facts in `trajectory/prompt.md` and `outcome/prompt.md` are true in the data. The items
  cover the cause, the mechanism, the deploy dead end, the Stripe error-rate dead end, the impact, the ongoing state,
  and the actions. The anchors give 0 to the bad transcript on root cause and next steps.
