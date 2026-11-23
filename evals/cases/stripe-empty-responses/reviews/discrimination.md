# Discrimination review: stripe-empty-responses

| Part | Score |
| --- | --- |
| Difficulty | 2/5 |
| False leads | 3/5 |
| Input | 5/5 |
| Depth | 2/5 |
| Grader separation | 2/5 |

## Path from symptom to cause

The shortest path to the cause area has 1 step:

1. `search_logs level=error` with the default window. The first line is Payment `failed to parse stripe response`, `stripe_latency_ms=6812`, `error=unexpected end of JSON input`. The next line is Order `checkout failed: payment error`, `upstream_status=502`.

`log_patterns` with no arguments gives the same result (new pattern, 191 lines, 0 before). `third_party_health stripe` with no window also gives it: p95 9233 ms (normal 372 ms), error rate 0%, and the parse error in `error_log_samples`.

The shortest path to the full mechanism (empty HTTP 200 body) and the deploy rejection has 4 steps:

1. `search_logs level=error`: the Payment parse error. It points to Stripe.
2. `find_traces service=payment status=error` 11:20 to 12:00: 18 failed `POST /checkout` traces.
3. `get_trace fc46b5cbd5ea346d7ec2877e99b68b78`: `stripe POST /v1/payment_intents` takes 5.9 s and returns 200 with `body_bytes=0`. Then `parse stripe response` fails. The Order spans take a few ms.
4. `list_changes`: Order v4.12.0 at 11:16. The trace from step 3 rejects it. `top_endpoints order` also shows `GET /orders/:id` p95 7.75 ms on the new version.

A weak agent fails the mechanism if it does not open a trace. It fails the deploy part if it never runs `list_changes`, or if it reads the deploy and stops there.

## False leads

- Order v4.12.0 deploy at 11:16, 4 minutes before the fault: `list_changes` shows only this change in the last hour. `compare_windows` for Order p95 split at 11:16 shows +1798%. A weak agent stops here and rolls back Order. / Reject it: the Order spans in a failed trace are fast, `GET /orders/:id` stays fast, the error is in Payment (not deployed), and Order is normal from 11:18 to 11:20 on the new version.
- New Order warning `unknown field gift_note in checkout request, mapped to gift_message` (51 lines, new, `version=v4.12.0`): it is the third new pattern in `log_patterns`. A weak agent uses it as proof that the deploy is bad. / Reject it: it has no `order_id` link to the failed checkouts, and the failed traces fail in Payment.
- Stripe error rate is 0% and ThirdPartyErrors is `ok`: a weak agent clears Stripe with `third_party_error_rate`. / Reject it: `third_party_latency_p95_ms` steps to over 9 s at 11:20. The trace shows HTTP 200 with `body_bytes=0`.
- Payment and Order alerts fire at the same minute (ServiceErrorRateHigh 11:25, ServiceLatencyHigh 11:30): a weak agent can blame Payment code. / Reject it: Payment has no deploy, and the time is in the Stripe client span.
- Fewer Kafka events, emails and carrier calls: a weak agent can blame Kafka or Notification. / Reject it: they drop by the same count as the failed checkouts, and the consumer lag is normal.
- `stuck_3ds`, order ord_MB8THH in PENDING from 11:26: it looks like a missing Stripe webhook. / Reject it: `orders_stuck_pending_15m` is 1, below the limit of 5. It is one order, not 60% of checkouts.
- `dlq_deleted_users`, DlqGrowing at 11:51: a firing alert in the same hour. / Reject it: it fired 4 times before today and starts 31 minutes after the fault.
- `catalog_gc` and `price_scraper`: Catalog p99 spikes and gateway 429s. / They are far from checkout. They add little.

The deploy and the `gift_note` warning make a good false lead. But the Payment parse error is louder: it is first in the error logs and first in `log_patterns`. Most agents do not need to reject the deploy to name Stripe.

## Test transcripts

Scores are from the deterministic graders only (`check-case.js` without `--judge`). The review used temporary transcripts that are not in the repo: `weak_deploy.json`, `weak_shallow.json` and `good_alt.json`.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent A (deploy lead): `list_alerts`, `list_changes`, `log_patterns order`, `compare_windows` Order p95 at 11:16, `third_party_health stripe`, `business_kpis`. Blames the deploy and `gift_note`, clears Stripe by error rate, rolls back Order. | 3.75/5 | 1.67/5 | 5.42/10 |
| Weak agent B (shallow): `list_alerts`, `search_logs level=error`, `business_kpis`, `third_party_health stripe`. Names Stripe and the parse error. No trace, no empty body, no deploy check. | 3.75/5 | 3.75/5 | 7.50/10 |
| Good agent: `list_alerts`, `get_service_health payment`, `find_traces payment`, `get_trace` (not the sample trace), `compare_windows` Stripe p95, `list_changes`, `top_endpoints order`, `compare_windows` checkout success. Rejects the deploy with the trace. | 5.00/5 | 5.00/5 | 10.00/10 |
| Fixture `bad_transcript.json` (reference) | 2.50/5 | 0.83/5 | 3.33/10 |
| Fixture `good_transcript.json` (reference) | 5.00/5 | 5.00/5 | 10.00/10 |

Both weak agents get more than half of the points. The target is less than half.

## Findings

1. **One log query gives the cause area**
   - Evidence: `search_logs level=error`, `log_patterns` and `third_party_health stripe` with default arguments all return `failed to parse stripe response` as the first result. The seed no longer logs `content_length` or `stripe_status`, but one call still shows the area.
   - Fix: A real Payment log names its provider, so keep the log. Move the difficulty to the mechanism and the deploy. Put more grader weight on `found_empty_response`, `names_empty_response` and `rejects_order_deploy` (see findings 3 to 6).

2. **The order timeline names the empty body**
   - Evidence: `get_order_timeline ord_V8SH2G` returns `payment failed: empty Stripe response (HTTP 502)`. A real system cannot know that the body was empty. The text comes from `slow_stripe_checkout` in `seed/incidents.py` (line 333). `found_empty_response` gives only 0.5 for this path.
   - Fix: In the seed, change the timeline text to `payment failed (HTTP 502)`. Then only the trace span shows `body_bytes=0`.

3. **The trajectory grader gives points for data the agent rejected**
   - Evidence: Weak agent A gets `checked_stripe_latency: 1` and `found_empty_response: 0.5` from one `third_party_health` call. Then it says "Stripe is not the cause". The 0.5 comes from the parse error in `error_log_samples`.
   - Fix: In `trajectory/tests.js`, count `parseSeen` only for `search_logs`, `log_patterns`, `logs_by_trace` and `get_trace`.

4. **`checked_order_deploy` gives full points for only listing the deploy**
   - Evidence: Weak agent A and the bad fixture get `checked_order_deploy: 1`. Both blame the deploy.
   - Fix: Give 1 only when the run also has evidence against the deploy: a `get_trace` with fast Order spans, `top_endpoints order`, or an Order metric for 11:18 to 11:20. Give 0.5 for `list_changes` alone.

5. **`located_failing_hop` passes on a log search**
   - Evidence: Weak agent B gets `located_failing_hop: 1` from `search_logs level=error`. It never opens a trace.
   - Fix: Count only `get_trace` and `logs_by_trace`. The log search already counts in `found_empty_response`.

6. **`rejects_order_deploy` gives 0.5 when the answer does not mention the deploy**
   - Evidence: Weak agent B never mentions the deploy and gets 0.5. The rubric gives 0 for "never checks the deploy".
   - Fix: In `outcome/tests.js`, give 0 when `mentionsDeploy` is false.

7. **Efficiency is a free point**
   - Evidence: Weak agent A (6 calls) and weak agent B (4 calls) both get `efficiency: 1`.
   - Fix: Multiply efficiency by the mean of the other trajectory items, or give 0 when `found_empty_response` is below 1.

8. **`names_parse_failure` passes with a wrong cause**
   - Evidence: Weak agent A blames the Order request for the parse error and still gets `names_parse_failure: 1`.
   - Fix: Require `namesStripe`, the same way `names_empty_response` does.

Estimate after fixes 3 to 8 (deterministic only): weak agent A about 2.5/10, weak agent B about 5.4/10, good agent 10/10. Weak agent B stays near half because it names the right area. The judge rubric (`found_the_mechanism`, `course_correction`) must give it 0.5 or less on those items.
