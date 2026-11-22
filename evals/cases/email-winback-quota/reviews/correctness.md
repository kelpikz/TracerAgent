# Correctness review: email-winback-quota

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 4/5 |

## Findings

1. **Old shipped and delivered emails succeed inside the runs** (cascade)
   - Evidence: `logs.jsonl`, `traces.json`, and `orders.json` have 6 baseline `email sent` rows in the runs. They have no `attempt` field and no 429: `ord_UQFZ6P` 10:47:28, `ord_EYMTRR` 10:57:43, `ord_33YB2X` 10:58:55, `ord_SV5C2L` 11:00:19 (run 1), `ord_SZVW4S` 11:45:55, `ord_QM4J47` 11:49:01 (run 3). Their email spans have no `http_status` (baseline spans). The error rate in these minutes is 52% to 64%, so 6 of 6 first-try successes is very unlikely (about 0.3%). The incident says shipped and delivered emails fail: `dlq_sample` shows 169 `order_shipped` / `order_delivered` messages in the DLQ. Only the orders created in the runs are regenerated (`email_429`). The shipped and delivered emails of older orders are not.
   - Fix: also route the `delivery.updated` emails in the run windows through the 429 logic (spans, logs, timelines). Or remove these 6 baseline rows.

2. **Two DlqGrowing alerts fire at the same time** (cascade)
   - Evidence: `alerts.json` `firing` has `DlqGrowing` from 11:48 (incident) and from 11:51 (`dlq_deleted_users` noise). Both are unresolved and have the same summary. One rule cannot have two open alerts. A real rule would make one alert from 11:48.
   - Fix: merge the overlapping `DlqGrowing` ranges when noise and incident alerts are added. Or move the noise event out of the run.

3. **DLQ count differs by 2 between metric and logs** (cascade)
   - Evidence: `kafka_dlq_size` ends at 424 (6 start + 417 incident + 1 noise). Logs have 419 `moved to DLQ` rows with 429. The 2 extra rows come from the sampled orders `ord_UH4CQ3` and `ord_K6LVQ4`. Their DLQ moves are not counted in `dlq[i]`. The `info` text says 417. The prompts say "about 420 (419)". The tests accept 350 to 480, so no check breaks.
   - Fix: count the sampled order DLQ moves in the metric, or leave them out of the logs. Low priority.

4. **DLQ log order IDs are not in the order sample** (cascade)
   - Evidence: 422 of 424 DLQ log rows have an `order_id` that is not in `orders.json`. `get_order_timeline` on a DLQ sample ID returns "No order ... in the sample". Only `ord_UH4CQ3` and `ord_K6LVQ4` can be followed.
   - Fix: none needed if the tool message is accepted. Or note it in the trajectory prompt as a known dead end.

5. **Noise 550 retries use a different timing** (cascade)
   - Evidence: `ord_G9BAPH` (11:49:16, 11:50:17, 11:51:22) retries about 1 minute apart. The incident says retries come after about 30 s and 2 min. The 550 messages are noise, so this is a small seam.
   - Fix: none needed. Optional.

6. **Natural wording of the shared key gets no credit** (false negative)
   - Evidence: a correct answer with "...with the API key sg_main, which order emails also use." gives `names_shared_key_quota` 0 (total 11/12). `SHARED_KEY` needs "same / shared / one ... key" or "shares ... key". "that order emails also use" and "the key that order emails use too" do not match.
   - Fix: add a pattern such as `key\b[^.]{0,40}\border\s+emails?\b[^.]{0,20}\b(?:also|too|use)`.

7. **A denial word in the same sentence removes credit** (false negative)
   - Evidence: "The winback_campaign job ... turned on at 10:38 UTC by marketing, sends more than 600 requests per minute on the same API key as the order emails, but the provider is healthy and only returns 429 for the key." gives `names_trigger` 0 and `names_faulty_service` 0 (9/12). `DENY` has `healthy`, `normal`, `not`, `no`. Any sentence that names the job and also says "healthy" is dropped. A good answer often says "the provider is healthy" in the cause sentence.
   - Fix: apply `DENY` only to the clause that names the denied lead. Or remove `healthy`, `normal`, `fine` from `DENY` and use them only in `noFalseLead`.

8. **Other correct phrasing is missed** (false negative)
   - Evidence: "Switch off the Black Friday email job now" gives `says_pause_job` 0 (`PAUSE_OBJECT` allows only 2 words before `job`). "Put the campaign on hold" also gives 0.
   - Fix: allow up to 4 words before `job` / `campaign`; add `on hold`.

9. **A keyword list gets full score** (false positive)
   - Evidence: this text has no real sentences, only the facts: "winback_campaign job turned on at 10:38 uses the same key, 429, rate limit 600. Notification winback job. Pause the job. Use a separate key. Replay the DLQ messages with 429. 420 in the DLQ. Checkout works. Every 30 minutes." It gives 12/12. The outcome tests cannot tell this from a real answer. The judge items (`mechanism`, `evidence`) must catch it.
   - Fix: no cheap regex fix. Keep the judge in the final score.

10. **One generic call earns points in the trajectory** (false positive)
    - Evidence: a transcript with only `business_kpis` (default window) scores `checked_burst_pattern` 0.5 and `checked_order_impact` 1. The tool always returns `emails_failed_per_min`, and any call in a run window counts, so the agent does not need to link the result to emails.
    - Fix: for `checked_order_impact`, drop the plain `business_kpis` branch and keep the `email failed (429)` order timeline, or require `emails_failed_per_min.max` above 100 together with checkout success above 90%. Low priority.

11. **A narrow DLQ read gets no full credit** (false negative)
    - Evidence: `checked_dlq_errors` needs 50 or more 429 messages in `dlq_sample`. One topic in one run has 15 to 77 (order.created: 36, 15, 24 in runs 1 to 3). A correct read with a 5-minute window, or one topic and one run, gets 0.5 or 0.
    - Fix: give 1 for 429 messages of 10 or more in `dlq_sample`, or give 0.5 for 10 or more and keep 50 for 1.

12. **Long windows hide the bursts** (false negative)
    - Evidence: `showsSeparateBursts` uses the downsampled points (worst value per bucket, 60 points). A 24 h query has 24-minute buckets, so all three runs merge and `checked_burst_pattern` is 0.5. A 6 h query (6-minute buckets) can also merge the 12 minute gap. Only the alert history or a window of about 3 h or less gives 1.
    - Fix: accept a second query with a short window as a proof, or give 1 when the series max is above 1,000 and the `normal` value is under 100 (the series is not constant).

13. **No deterministic check for the provider health and the shared key in the trajectory** (coverage)
    - Evidence: `trajectory/tests.js` has no item for the provider latency (the provider is healthy), the 550 versus 429 split, or `api_key=sg_main` on the job rows. These are in the judge items `course_correction` and `followed_the_cascade` only. The outcome tests grade the false leads (`no_false_lead_as_cause`), so the final answer is covered.
    - Fix: optional. Add `checked_provider_healthy` (a `third_party_health` or `query_metric` result for email latency in a run window).

## Checked and correct

- **Trigger.** `events.json` has the config change at 10:38 (notification, by marketing, "Turn on winback_campaign job"). `logs.jsonl` has `config reloaded` at 10:38:02 with `job=winback_campaign`, `enabled=true`, `api_key=sg_main`. `list_changes` with the default window returns it as `last_change_before_window` (no later events).
- **Job runs.** `run started` at 10:45:00, 11:15:00, 11:45:00 with recipients 9,666, 6,217, 7,164. `run finished` at 11:02:45, 11:26:52, 11:58:57 (duration 1080 s, 720 s, 840 s). 41 throttle warnings, one per minute of a run (10:45 to 11:01, 11:15 to 11:25, 11:45 to 11:57). All are in service `notification`. No `winback` rows are in `cron`.
- **Provider volume and errors.** `third_party_requests_per_min{provider=email}` is about 55 before 10:45, then 1,545 to 1,643 (peak 1,643 at 11:22), and back to 49 to 96 between runs. `third_party_error_rate` is 62% to 65% in runs, 0 between. The latency p95 stays at 160 to 260 ms, so the provider is healthy. `emails_sent_per_min` is capped at 600. The sums agree: run 1 sent 10,565 = job 9,666 + 899 order emails; fails 16,688 = 15,550 job throttles + order fails.
- **Failure metric.** `emails_failed_per_min` is 0 between the runs and 958 to 1,067 in them. At 11:01, failed / requests = 435 / 1,035 = 42.0%, the same as `third_party_error_rate`. Checked against `data/baseline`: checkout, payment, orders, Kafka throughput, and CPU are unchanged. Only the email, notification, and noise series differ.
- **Notification cascade.** `kafka_consumer_lag{group=notification}` is 57 to 104 in runs and 0 to 9 between. `notification_event_to_email_p95_s` is about 130 to 178 s in runs and 3 s between (matches retries at 30 s and 2 min). `kafka_dlq_size` goes 6, 186, 284, 424, flat between the runs. The first DLQ rise is at 10:48, 3 minutes after the run start (30 s + 2 min retries).
- **Logs.** 106 `retry 1/3`, 59 `retry 2/3`, and 419 `moved to DLQ` rows carry `429 Too Many Requests: rate limit of 600 requests/min exceeded for API key sg_main`. 1 DLQ row with 550 is in the window (5 in the whole day). Per topic: order.created 75, order.paid 176, delivery.updated 168. Per run: 181, 98, 140. This matches "70 or more for one topic or one run".
- **Sample orders.** `ord_UH4CQ3` (10:52), `ord_K6LVQ4` (11:48), `ord_SMH7K4` (11:55) have 429 timelines. Retry gaps are 30 s and 2 min (10:52:41, 10:53:11, 10:55:10). Traces have matching 429 / 202 spans with the same error text. All orders in the window are PAID, so checkout stays normal.
- **Alerts.** `EmailsFailing` fires at 10:55, 11:25, 11:55 (above 5 for 10 min from 10:45, 11:15, 11:45) and resolves at 11:02, 11:26, 11:58 (first zero minute). `ThirdPartyErrors` fires at 10:50, 11:20, 11:50 (5 min) and resolves at 11:02, 11:26, 11:58. `DlqGrowing` fires at 10:48, 11:18, 11:48 (first growth) and resolves 15 min after the last growth (11:16, 11:40, still open at 12:00). The alert summaries match the metric value of the last minute before the fire time. No checkout, payment, or other rule fires.
- **False leads.** The newsletter (10:00 to 10:30) changes no email metric (`third_party_requests_per_min` differs from baseline only from 10:45). The last OOM restart is at 09:18, so no restart happens in the runs. The 03:30 deploy has no email effect for 7 hours. The 550 DLQ messages are separate from the 429 ones.
- **Prompt facts.** Every number in `outcome/prompt.md` and `trajectory/prompt.md` is in the data: alert times, 9,666 / 6,217 / 7,164, peak 1,643, 419 and 420 DLQ messages, 550 counts (5 all day, 1 in 10:30 to 12:00), `ord_UH4CQ3` at 10:52 and its timeline. The first-try count (1,465) is only in `labels.json`, and the prompt says not to require it. The state at 12:00 is correct (the last run ended at 11:58:57, the next is at 12:15).
- **Checks.** `check-case.js` gives 10.00 for the good transcript, 2.51 for the bad one (provider outage, contact the provider), and 0 for every item with an empty transcript (trajectory and outcome). The checks grade the burst pattern, the volume, the 429 text, the job rows, the trigger, the DLQ, and the impact. They also grade the job, the trigger, the shared key, the pause, the isolation, the 429-only replay, the harmful actions, the DLQ size, checkout, and the recurrence. `HARM` catches "Scale up Notification pods" (`no_harmful_action` 0). A wrong cause (newsletter, provider outage) gets 0 for `no_false_lead_as_cause`. "Checkout is failing" gets 0 for `says_checkout_unaffected`. An answer with no job gets 0 on all items. The efficiency item gives 0 when neither the job nor the change is found.
