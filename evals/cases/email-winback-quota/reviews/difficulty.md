# Difficulty review: email-winback-quota

Fairness gate: pass

| Part | Score |
| --- | --- |
| Blind solve | 3/5 |
| Shortcut resistance | 2/5 |
| Depth | 3/5 |
| Cross-source evidence | 4/5 |
| Time reasoning | 2/5 |
| Partial-answer trap | 4/5 |
| Distractors | 3/5 |
| **Total** | **21/35** |

The case is fair but not hard. It does not reach the target. The default `list_changes` call, the default `log_patterns` call, and even `search_logs` with `text: "429"` show the root cause or the trigger. The distractors are mostly outside the default window.

## Blind solve

I read only `input` first. The page: EmailsFailing at 11:55, now 12:00. 22 calls, 14 useful. I had a full answer after call 8.

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | `list_alerts {}` | Only `DlqGrowing` x2 firing. `EmailsFailing` is not in the firing list (the burst ended at 11:58). Rules list. | Something about the notification DLQ. |
| 2 | `business_kpis {}` | Checkout 96.7%, `emails_failed_per_min` max 1067, last 0. | Emails fail in bursts. Checkout is not hurt. |
| 3 | `list_changes {}` | No change in the window. `last_change_before_window`: 10:38 config, notification, "Turn on winback_campaign job (Black Friday win-back emails)", by marketing. | First hypothesis: a new marketing job loads the email provider. |
| 4 | `search_logs level=error` | Notification "email failed 3 times, message moved to DLQ", `429 ... rate limit of 600 requests/min exceeded for API key sg_main`. | The 429 is a key quota. The winback job is the likely user. |
| 5 | `log_patterns {}` | Pattern "winback campaign throttled by email provider, backing off", job=winback_campaign, api_key=sg_main, status 429. | Job and order emails use `sg_main`. Same quota. |
| 6 | `third_party_health provider=sendgrid` | Error: unknown provider. Known: stripe, carrier, email. | No change. |
| 7 | `list_changes` 08:00 to 12:00 | Config change 10:38 and a Redis client deploy on cart at 09:40. Notification deploy at 03:30 is before the window. | Cart deploy is unrelated to emails. |
| 8 | `third_party_health provider=email` | Requests/min normal 61, max 1643. Error rate max 65%. Latency p95 normal (about 211 ms). | Provider is healthy. It only applies the limit. |
| 9 | `search_logs service=cron text=winback` | 0 rows. | The job logs under `notification`, not `cron`. |
| 10 | `query_metric` (wrong args) | Error. | Retry. |
| 11 | `search_logs text=winback` 10:00 to 12:00 | `config reloaded` 10:38 (schedule `15,45 * * * *`, `sg_main`), `run started` 10:45 with 9666 recipients, throttle warning every minute. | Trigger time and schedule proved. |
| 12 | `search_logs service=cron` 09:00 to 12:00 | Routine jobs only (stock holds, sessions, carts). | Cron jobs are unrelated. |
| 13 | `search_logs text=job=winback_campaign level=info` | 3 runs: 9666, 6217, 7164 recipients. Finished 11:02, 11:26, 11:58. `throttled` counts 15550, 9584, 11195. | Next run is at 12:15. |
| 14 | `kafka_lag` | Order, delivery: lag normal. Notification group below that. | No stuck consumer. |
| 15 | `get_runbook EmailsFailing` | No runbook. | None. |
| 16 | `business_kpis {}` (grep) | Same as call 2. | Wasted call. |
| 17 | `dlq_sample group=notification` | Count 424: 419 with 429, 5 with 550 (deleted user). | Impact: about 420 order emails in the DLQ. Replay only the 429 ones. |
| 18 | `past_incidents "email rate limit"` | No incidents. | None. |
| 19 | `list_services` | Notification calls email over HTTP. | Confirms the path. |
| 20 | `query_metric` (wrong args) | Error. | Retry. |
| 21 | `query_metric emails_failed_per_min` 10:30 to 12:00 | 0 until 10:44. About 960 to 1070 at 10:44 to 11:00, 11:14 to 11:24, 11:44 to 11:56. Zero between runs. | Bursts match the runs. |
| 22 | `query_metric third_party_requests_per_min {provider: email}` | About 60 to 80 normal. About 1600 in the same three windows. | The extra load is not order emails. |

Answer: The `winback_campaign` job in Notification, turned on by marketing at 10:38 (config change), runs at :15 and :45 (first run 10:45, then 11:15 and 11:45). It sends 9666, 6217 and 7164 emails with API key `sg_main`, the same key as order emails. The provider allows 600 requests/min per key and returns 429. The provider is healthy. In each run, order emails (received, confirmed, shipped, delivered) fail with 429, retry twice, and about 420 go to the DLQ (419 with 429; the 5 with 550 are deleted users). Many are sent late. Checkout and payment work. Failures stop between the runs. The next run is at 12:15. Fix: pause the job now, replay the 429 DLQ messages, then give the job its own key or a send limit under 600/min, and check for no 429 at 12:15 or 12:45. Correct: yes.

## Shortest path

1. `list_changes {}` (default window). `last_change_before_window` shows the 10:38 config change "Turn on winback_campaign job". This names the trigger at once.
2. `log_patterns {}` (default window). It shows the winback throttle line with `api_key=sg_main` and status 429, next to the order-email 429 lines. The quota and the shared key are visible.
3. `search_logs text=winback`, window 10:00 to 12:00. It shows the 10:38 reload, the schedule, the recipient counts and the run start times.
4. `query_metric third_party_requests_per_min {provider: email}` or `third_party_health email`. It shows 60 up to 1600 per minute in each run and normal between runs. This links the job runs to the failures by time.
5. `dlq_sample group=notification`. It shows about 420 messages (419 with 429, 5 with 550). This gives the impact.

5 steps, but the cause is clear after step 2. Steps 3 to 5 only add proof and impact.

## Partial-answer test

I wrote two transcripts with real tool results from the data. Scores are from the deterministic checks of `check-case.js` (no `--judge`), so the outcome part is a lower bound. The rubric items need the judge.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| A: right mitigation, wrong cause. Calls: `list_alerts`, `third_party_health`, `dlq_sample`, `search_logs` errors, `kafka_lag`, `business_kpis`. Answer: "the provider rate-limits `sg_main`, Black Friday volume is the cause, ask the provider to raise the limit, replay the 429 DLQ messages, not the 550 ones." | 3.13/5 | 1.25/5 | 4.38/10 |
| B: right cause, wrong actions. Finds the job and the 10:38 change. Answer says "restart Notification and roll back the 03:30 deploy, contact the provider." | 5.00/5 | 2.08/5 | 7.08/10 |

- Transcript A is the planned trap: the 429 and the DLQ are real, the job is missing. It gets less than half. This passes.
- Transcript B is above half only because the trajectory part rewards the diagnosis. The judge would give `next_steps` 0 for the wrong actions (the `no_harmful_action` check is already 0). I did not run the judge. This is a weak point but not a defect: the diagnosis is right.

## Findings

1. **`list_changes` default names the trigger** (Shortcut resistance, Blind solve, Depth)
   - Evidence: `list_changes {}` with the default window returns `last_change_before_window`: the 10:38 config change "Turn on winback_campaign job (Black Friday win-back emails)" by marketing. The job name is in the title. An agent that reads only the alerts and the changes can guess the cause. I had my first correct hypothesis after call 3.
   - Fix: make the change summary less direct, for example "Update notification job schedules" or "Marketing config bundle 2026-11-20", so that the agent must read the config-reload log to find which job turned on. Or add an unrelated config change after 10:38 so that `last_change_before_window` is not the trigger. Or put the change outside the one-hour look-back by a second, later unrelated change.

2. **Default log calls show the job and the shared key** (Shortcut resistance)
   - Evidence: `log_patterns {}` returns the pattern "winback campaign throttled by email provider, backing off" with `job=winback_campaign`, `api_key=sg_main`, `status=429`. `search_logs text=429` (default window) also returns this line in its samples. `search_logs level=error` shows the quota (600) and the key name. No widening of the window is needed.
   - Fix: change the throttle line so it does not carry the job name and key together. Log it at `debug` or without `api_key`. Show the shared key only in the 10:38 `config reloaded` line, which is outside the default window.

3. **Trigger is only 82 minutes before the page and the effect starts after 7 minutes** (Time reasoning)
   - Evidence: trigger 10:38, first failures 10:44, page 11:55 (current time 12:00). The default window (11:00 to 12:00) holds two full runs (11:15, 11:45), the `run started` log lines and the recipient counts. The agent does not need to widen the window to see the pattern. Only the 10:38 reload log is outside it.
   - Fix: move the job turn-on earlier (for example 08:30 to 09:00, 3 hours before the page) and make the first runs partly benign, or add a day-time trend, so that a one-hour window does not show the job at all. Also remove `last_change_before_window` as a hint (see finding 1).

4. **Distractors are out of the default view** (Distractors)
   - Evidence: the newsletter (10:00 to 10:30), the 03:30 Notification deploy and the cart Redis deploy (09:40) are outside the default window. Notification memory is 267 to 332 MB with no restart in the window. The price scraper 429 lines are at the gateway and do not appear in the default `search_logs text=429` samples (all 20 are notification). Only the deleted-user DLQ messages (`550`, `DlqGrowing` firing at 11:51) are easy to reach. I did not follow any distractor. Each one is rejected by a specific check (provider latency normal and 429 only for our key; 550 versus 429 in `dlq_sample.by_error`; time of the newsletter and the deploy; no restart; gateway 429 is a different service). But the agent has little reason to open them.
   - Fix: choose noise that overlaps the runs. For example, a notification pod restart or a memory spike inside a run, a catalog or gateway 429 burst at :15 or :45, a notification deploy or a rollout at 10:30 to 10:40 (a second change near the turn-on), and a provider status-page style event. Put at least one in the default window and make it look like a cause.

5. **No expected fact is missing from the data** (Fairness, informational)
   - Evidence: root cause, trigger time, schedule, shared key (`config reloaded` line, `api_key=sg_main` on both the job and the order email errors), quota (600/min in the error text), provider health (`third_party_health email`), the run times, the recipient counts, the DLQ count (419 with 429), the 550 split, and the recurrence at 12:15 are all visible through the tools. Only the first-try failure count (about 1,465) is in the labels, and the grader says not to require it.
   - Fix: none.

6. **`list_alerts` default does not show the page alert** (Shortcut resistance, positive)
   - Evidence: `EmailsFailing` and `ThirdPartyErrors` are resolved at 12:00 (burst ended 11:58). The default `state=firing` list shows only `DlqGrowing`, which also fires for the deleted-user noise. This helps the case. The agent must use `state=all` or the metrics to see the bursts.
   - Fix: none. Keep it.
