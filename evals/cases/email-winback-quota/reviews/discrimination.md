# Discrimination review: email-winback-quota

| Part | Score |
| --- | --- |
| Difficulty | 2/5 |
| False leads | 2/5 |
| Input | 5/5 |
| Depth | 3/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

The agent reads the data through the tools. It does not read `alerts.json` or `events.json` directly.

1. `EmailsFailing` at 11:55. The alert is already resolved at 12:00 (resolved 11:58). `list_alerts` (default, firing) shows only two `DlqGrowing` alerts. `list_alerts` with `state=all` shows three `EmailsFailing`, three `ThirdPartyErrors` (email) and `DlqGrowing` at 10:48, 11:18 and 11:48.
2. The provider looks sick, but is not. `third_party_health` (email): errors up to 65%, latency p95 normal (211 ms against 226 ms). The error log samples show `429 ... rate limit of 600 requests/min exceeded for API key sg_main`.
3. The 429 comes from our own volume. `third_party_requests_per_min` (email) goes from 61 to 1,643 while order traffic is normal.
4. Something other than order emails uses the key. `search_logs` or `log_patterns` for Notification show `winback campaign run started / throttled / run finished` (`job=winback_campaign`, `api_key=sg_main`).
5. The trigger. `list_changes` shows `Turn on winback_campaign job` at 10:38 by marketing. The default one-hour window still shows it as `last_change_before_window`.
6. The impact. `dlq_sample` shows 419 with 429 and 5 with 550. `business_kpis` shows checkout normal. `get_order_timeline` of an order in a run shows `email failed (429)`.

Nominal depth is 5 or 6 steps. Real depth is 2 calls (see Findings 1).

## False leads

- Email provider outage: `ThirdPartyErrors` (email) fires at 63% and the metric reaches 65%. A weak agent stops at "provider unhealthy" and advises to contact the provider. Reject it: latency is normal, and every error is 429 for our key. This is the strongest lead, and the data rejects it well.
- `DlqGrowing` still firing at 12:00 (the only firing alert): A weak agent calls it a poison message or the deleted-user issue. Reject it: `dlq_sample` shows 419 with 429 and only 5 with 550. Lag is normal. `dlq_deleted_users` is part of the noise, so the DLQ has a mix of both.
- Gateway 429 and the 4xx spike (price scraper): `http_4xx_rate` for the gateway reaches 16% at 11:07, and `log_patterns` shows `gateway warn: rate limited`. A weak agent can read it as a rate-limit problem at the gateway. Reject it: it is `GET /products` from one IP, and checkout is normal. A search for "429" shows Notification first, so this lead is weak.
- Newsletter (10:00 to 10:30): visible only if the agent looks at 10:00 to 10:30. Nothing in the symptoms points to it, so no agent has a reason to follow it. The data rejects it (it ends 15 minutes before the first run, email requests do not change).
- Notification OOM restart and the 03:30 deploy: the last OOM is at 09:18, which is outside the incident window. The 03:30 deploy shows only in a 24-hour changes list. Both are far from the symptom and rarely seen.
- `cron_jobs`: routine cron lines. The winback job logs under `notification`, not `cron`. It gives a little clutter, and no wrong cause.

Only the provider and the DLQ leads are real competitors. The other three noise items are far from the first view.

## Test transcripts

Drafts and filled transcripts are in the scratchpad folder `r2-discrimination-email`. Results came from the real tools and `check-case.js` (no `--judge`). The score is the deterministic part only.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak A: `list_alerts` (firing), `third_party_health`, `get_service_health`, `dlq_sample`. Blames a provider outage, advises to contact the provider and restart Notification. | 2.19/5 | 0.42/5 | 2.61/10 |
| Weak B: `search_logs` (errors) and `dlq_sample`. Stops at "429 on sg_main, ask for a higher limit". Never finds the job or the change. | 1.25/5 | 1.04/5 | 2.29/10 |
| Shallow: 2 calls only, `log_patterns` (notification, default window) and `list_changes` (default). Names the job, the change and the fix. | 2.81/5 | 5.00/5 | 7.81/10 |
| Good agent: 11 calls in a different order (KPIs first, metrics, `search_logs` for 429 then winback, 10:00 to 12:00 changes, DLQ, 24-hour changes, one order timeline). Rejects the provider, newsletter and 03:30 deploy. | 5.00/5 | 5.00/5 | 10.00/10 |

The weak agents get less than a third of the points. The good agent gets full points. The separation is large.
The shallow agent shows the gap: two calls get 7.81/10 from the deterministic checks.
Its trajectory score is limited (no burst pattern, no volume, no order impact), but the outcome checks give full points.
The outcome checks read only the final text. A final answer that says the right words gets full points, even when the agent did not check the facts. I wrote the shallow answer with numbers (420 DLQ messages, "replay the 429 messages, not the 550") that those two calls do not show. A real agent would not know them. The deterministic outcome check cannot see this, so the LLM judge must catch it.

## Findings

1. **One or two calls reach the root cause**
   - Evidence: `log_patterns` for Notification (default last hour) shows the 429 with `sg_main` and the `winback_campaign` run, throttle and finish lines in one result. `list_changes` with no arguments returns `Turn on winback_campaign job (Black Friday win-back emails)` by marketing as `last_change_before_window`. The shallow transcript with these two calls got 7.81/10. The change summary names the job and the cause.
   - Fix: Make the cause less direct. Put the winback job lines in a separate service or log field that needs a `job=` search (for example under `cron`, or with a generic message such as `batch send finished`). Word the config change with a neutral summary (for example `Enable marketing scheduler flag`) so that the agent must link the job logs to it. The agent must then combine the volume metric, the job logs and the change list.

2. **The false leads sit outside the default view**
   - Evidence: In the default one-hour window the agent sees only the provider error rate and `DlqGrowing`. The newsletter (10:00 to 10:30), the OOM restart (09:18) and the 03:30 deploy need a wider window and have no link to the symptom. The `dlq_sample` result shows 419 with 429 against 5 with 550 in one call, so the DLQ lead dies fast.
   - Fix: Move the noise next to the runs. For example, add an OOM restart or a Notification deploy close to 10:40 to 11:00, or run the newsletter near 10:40 so that its traffic overlaps the first run. Add a second 429 source with a different key, so that the shared key must be proved. Make the DLQ mix closer (more 550 messages in the runs).

3. **`EmailsFailing` is resolved at the time of the page**
   - Evidence: The alert fired at 11:55 and the data resolves it at 11:58, with the current time at 12:00. `list_alerts` (default, firing) shows only `DlqGrowing`. The input says "for 10m" and reads like a live page.
   - Fix: This is a useful small trap, but it could confuse a correct agent. Keep it only if intended. Otherwise the alert should still fire at 12:00 (the run ends after 12:00).

4. **The outcome checks do not check that the claims are grounded**
   - Evidence: The shallow answer got 12 of 12 on `outcome/tests.js` with two calls, because the checks match words in the answer text. The trajectory score was 2.81/5.
   - Fix: Make the trajectory efficiency item give full points only when the run also checks the volume or the DLQ. Keep the LLM judge on, and add to the outcome prompt that a number or a claim with no tool result as source gets 0.
