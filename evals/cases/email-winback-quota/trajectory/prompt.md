# Grade the investigation

The page is EmailsFailing at 11:55 UTC. The current time is 12:00 UTC.

**What happened.** At 10:38 UTC marketing turns on the `winback_campaign` job in Notification. This is a config change (in the changes list, by `marketing`). The job runs at 10:45, 11:15 and 11:45. It sends 9,666, 6,217 and 7,164 win-back emails. It uses the API key `sg_main`, the same key as the order emails. The email provider allows 600 requests per minute for each key. It returns `429 Too Many Requests` for the rest. Each run lasts 12 to 18 minutes (10:45 to 11:03, 11:15 to 11:27, 11:45 to 11:59).

In each run most order emails fail with 429. Notification tries each one 3 times: the retries come after about 30 s and 2 min. Then it moves the message to the DLQ. Most are sent late. About 420 go to the DLQ. Between the runs, emails are normal. Checkout and payment are normal. The provider is healthy: it only applies the key limit.

Where each fact is in the data:
- Alerts and metrics: `EmailsFailing` fires at 10:55, 11:25 and 11:55. `ThirdPartyErrors` (email) fires in the runs too (10:50, 11:20, 11:50). `DlqGrowing` fires at 10:48 and 11:18. At 12:00 the only firing alert is `DlqGrowing` from 11:51, which also covers the deleted-user DLQ messages. `emails_failed_per_min` and `third_party_error_rate{provider=email}` are high in the runs and near 0 between them.
- Request volume: `third_party_requests_per_min{provider=email}` goes from about 60 to over 1,000 (peak 1,643) in each run. The order counts do not change, so the extra requests are not order emails.
- Logs: Notification logs `email failed, retry n/3` and `email failed 3 times, message moved to DLQ` with `429 Too Many Requests: rate limit of 600 requests/min exceeded for API key sg_main`. It logs the `winback_campaign` lines in service `notification`, not in `cron`: `config reloaded` at 10:38, then `run started` (with the recipient count), a throttle warning each minute, and `run finished`.
- Changes: the config change at 10:38. A `list_changes` call with the default window (the last hour) still shows it as `last_change_before_window`.
- DLQ and KPIs: `dlq_sample` shows about 420 messages with 429 (419 in 10:30 to 12:00). A few have `550 recipient address rejected` (5 in all, 1 in 10:30 to 12:00). A DLQ read of one topic or one run still shows 70 or more messages with 429. `business_kpis` shows `emails_failed_per_min` high and checkout normal. An order in a run (for example `ord_UH4CQ3`, 10:52) has `email failed (429)` in its timeline, then one email that is sent late and one that moves to the DLQ.

**The minimum path** has about 6 calls: `list_alerts` (all, 10:30 to 12:00), `third_party_health` for email (10:30 to 12:00), `search_logs` for `winback_campaign` in Notification, `list_changes` (10:00 to 12:00), `dlq_sample` for Notification, and `business_kpis`.

**The normal path** has about 14 calls. It is the minimum path plus what the agent prompt asks for: `query_metric` for `emails_failed_per_min` and for `third_party_requests_per_min`, `log_patterns` for Notification, `search_logs` for `cron`, `get_service_health` for Notification, `kafka_lag`, `get_order_timeline`, and 2 or 3 calls on the false leads. Do not count these as waste.

**False leads.**
- An email provider outage. The provider is healthy: the latency is normal and the only error is 429 for our key.
- The newsletter from 10:00 to 10:30 UTC. It ends 15 minutes before the first run. It is sent from marketing's own tool, so it is not in the changes list. Email requests do not change at 10:00.
- The Notification deploy at 03:30 UTC (new email template). Emails are normal for 7 hours after it.
- Notification OOM restarts (memory leak). The lag drains in a few minutes. There is no restart in the runs.
- `DlqGrowing` from deleted-user accounts. These have a `550` error, not 429. The 429 messages come from this fault.
- Other cron jobs and the PriceGrabber scraper (429 on `GET /products` at the gateway). They are not related.

Score the agent's reasoning in its messages and in the tool results together. A fact counts as found only when the tool results show it and the agent uses it.

Give a short reason for each score. A transcript with no tool calls gets 0 for each item. Do not lower a score because of the order in which the agent finds the facts.

1. **followed_the_cascade**
   - 1. The agent starts at the alert, finds that emails fail in bursts, finds the 429 rate-limit error, finds that the extra email requests come from the `winback_campaign` job (logs or the request volume), and finds the 10:38 config change. Each step uses a result from the step before. It sees that the job uses the same key as the order emails.
   - 0.5. The agent finds the 429 error and the job, but skips a step (for example it never finds the 10:38 change, or never sees the shared key), or it guesses part of the path.
   - 0. The agent never finds the job, or it jumps to a cause with no path.
2. **course_correction**
   - 1. The agent checks the false leads that its own results show (the provider, the newsletter, the 03:30 deploy, the OOM restarts, the deleted-user DLQ messages), and it gives evidence to reject each one: the provider is healthy, the time does not match, the error is 550 and not 429. Or it rejects the lead with evidence before it follows it. A false lead that the agent never sees needs no reply. A firing `DlqGrowing` alert that the agent lists counts as seen.
   - 0.5. The agent rejects some false leads with evidence and leaves others, or it leaves a lead with no evidence.
   - 0. The agent stays on a false lead as the cause (for example "the provider has an outage"), or it never checks the provider and the answer depends on it.
3. **checked_scope_and_recovery**
   - 1. The agent shows that failures stop between the runs (a window that covers a gap, or the alert history), and that checkout and payment are not affected. It checks the size of the damage with the DLQ or order data.
   - 0.5. The agent checks one of these (the gap between runs, the checkout KPIs, the DLQ), but not the others.
   - 0. None of these.
4. **efficiency**
   - 1. Two or fewer wasted calls, and the agent finds the job or the 10:38 change.
   - 0.5. Three to six wasted calls, but the investigation stays on track.
   - 0. More than six wasted calls, the investigation goes off track, or the agent never finds the job or the change (few calls do not help an agent that does not find the cause).
   Waste is: the same query again with no new purpose, the same fact read from two tools, and calls on unrelated areas after the cause is clear (Stripe, Catalog, Cart, Postgres, carrier health). The calls of the normal path are not waste.
