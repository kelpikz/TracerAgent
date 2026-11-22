# Discrimination review: auth-pool-exhaustion

| Part | Score |
| --- | --- |
| Difficulty | 1/5 |
| False leads | 3/5 |
| Input | 5/5 |
| Depth | 2/5 |
| Grader separation | 4/5 |

## Path from symptom to cause

1. Subtract the five-minute evaluation window from the 10:39 page. Run `search_logs` from 10:34 to 10:35 UTC without a service filter. The first row shows the Auth canary applying `max_connections=2`, `session_listener_connections=2`, and `acquire_timeout_ms=250`. The same result shows login and refresh 503s, canary pool acquisition timeouts, and a successful stable Auth request.

The shortest path takes one tool call. The two connection counts explain why the canary ran out of connections. A weak agent can find the 250 ms pool wait and stop before explaining who holds the connections. The first gateway endpoint query points to Auth routes, and the alert query shows the coincident Auth alert at 48.69%. The 10:34 apply and 10:56 revert events make the canary change a strong guess from `alerts.json` and `events.json`. Finding the pool size and listener count still requires the logs.

The input gives `ServiceErrorRateHigh [serious] at 2026-11-20 10:39 UTC` and `http_error_rate{service=gateway} 5.00% > 2% for 5m`. It includes severity, time, rule, measured value, and `Current time: 2026-11-20 12:00 UTC.` The gateway label identifies where the errors appeared. The canary, its settings, and the rollback are absent from the page.

## False leads

- Newsletter traffic rises from 10:00 to 10:30. A weak agent may blame overload after seeing the gateway reach 156 requests/s at 10:08. Compare request rate and 503 onset. The gateway is back near 81 requests/s by 10:34, when the canary failures begin.
- Auth pool timeouts mention Users Postgres. A weak agent may blame server capacity. Check `db_health` during the fault. Users Postgres stays up, average query p95 is 3.78 ms, and connections peak at 12 against a normal count of 10. The failed trace ends before SQL while stable Auth requests still run queries.
- Cron logs show session cleanup at 10:32 and 10:37. A weak agent may infer contention. The jobs finish in 116 and 123 ms. Compare the Auth replicas. The canary alone logs pool timeouts under the new settings.
- The 09:40 Cart deploy upgraded its Redis client. A weak agent searching recent changes might attribute gateway errors to it. The failing samples are account routes, and the failing span is an Auth pool wait.

## Test transcripts

I rebuilt the transcripts with real tool results from freshly generated case data. I ran `check-case.js` on the transcripts under `evals/results/discrimination-review-abc/`. These are deterministic scores.

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent stops at pool exhaustion after alerts, routes, a trace, and change summaries. | 3.21/5 | 1.67/5 | 4.88/10 |
| Good agent starts with alert history and database health, then checks routes, a refresh trace, settings, stable Auth, KPIs, and post-rollback errors. | 5.00/5 | 5.00/5 | 10.00/10 |
| Shortcut searches Auth logs once for `users pool` from 10:30 to 10:57 with `limit=60`. It reports the settings and matching timeouts. | 3.57/5 | 5.00/5 | 8.57/10 |

The weak agent now loses efficiency credit because it skips the settings. Explicit denials, proposed checks, and open questions reused the weak tool path and each earned 0.00/5 for outcome.

## Findings

1. **One log result explains the outage**
   - The onset log includes both the pool cap and listener count. The same minute contains canary failures and a stable success. A wider search also returns the restored pool size at 10:56.
   - Log the configured pool size at rollout. Record occupied connections by holder separately so the investigation has to confirm which clients hold them during the failures.
2. **The one-call answer earns full outcome credit**
   - The shortcut earns 8.57/10 without measuring account impact or observing successful requests after rollback. The recovery check accepts the restored pool setting alone. The canary logs at 10:56:15 and 10:56:18 UTC show HTTP 200 for login and refresh, and the Auth error metric supports the recovery interval.
   - Use account KPIs or error measurements to score the size of customer impact. Require the restored settings and a successful canary request or a post-rollback error comparison for full recovery credit.
