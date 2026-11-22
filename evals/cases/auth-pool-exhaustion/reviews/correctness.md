# Correctness review: auth-pool-exhaustion

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 2/5 |

## Findings

1. **Signup samples show only the failing replica** (cascade)
   - The fault window has 22 stable login and refresh successes with pod attribution. All five signup samples return 503 on the canary. The signup metric remains above zero in some minutes, so the sample gives a narrower view of signup availability.
   - Add one successful signup on the stable pod during the fault.

2. **The grader rewards an empty metric query and misses a failed trace** (false positive, false negative)
   - In `empty-metric`, a query from 10:45:01 to 10:45:15 returns no data points and earns `checked_auth_errors=1`. The single-series branch checks the service label alone. In `wrong-with-facts`, one minute of overlap earns impact credit from the presence of the login KPI. In `waste`, the real Auth 503 trace earns pool-wait credit and zero Auth-error credit. The trace has `root` and `http_status` on the result itself.
   - Check samples from the fault window for elevated errors or 503s on an Auth route, and use the login KPI values when assigning impact credit.

3. **Recovery evidence gets inconsistent credit** (false positive, false negative)
   - The rollback settings log alone earns full credit in `wrong-with-facts`. The Auth health result and two successful canary SQL traces in `success-only` earn zero recovery credit. The config and pool-wait checks still match serialized phrases without requiring the matching service, event time, or failure status. The Users Postgres check accepts a database label without checking capacity or latency.
   - Distinguish the restoration record from measured recovery. Inspect structured fields and credit a relevant health comparison or successful post-rollback canary traces.

4. **Impact, recovery, and efficiency have gaps in the scored requirements** (coverage, false positive)
   - The scored investigation anchors cover the trigger, pool wait, and competing explanations. Recovery and customer impact appear in the suggested path. The deterministic outcome omits both customer scope and action. The full impact anchor in the outcome rubric names login and refresh and omits signup. `distinct-waste` earns full deterministic efficiency after two useful calls and ten irrelevant Stripe checks over distinct minute windows. The judge's efficiency anchor has no evidence prerequisite for the zero-call case.
   - Score impact and recovery evidence in the trajectory, include signup in the impact anchor, and grade whether the follow-up is safe. Require a substantive investigation and count irrelevant calls when scoring efficiency.

## Checked and correct

- The 10:34 and 10:56 change events line up with the Auth settings logs. The canary drops from 12 to two connections while two session listeners remain active. Trace `8bd0e59997bc08dcff6ae97ad5ea01ee` ends at the 250 ms local acquisition deadline before SQL. The gateway propagates 503s for login, refresh, and signup.
- The regenerated data replaces untagged successes inside the window and adds successful canary login and refresh traces after rollback. Traces `69c43730731ae99dffc2e9a01762a93d` and `974858ce6cf4906c73465036106fff5c` both reach Users Postgres. Auth errors fall from 48.896% at 10:55 to 0.348% at 10:56.
- Users Postgres stays available at 9–12 of 100 server connections, with query p95 of 3.11–4.45 ms. Auth errors rise to 45.956–50.709%, gateway errors to 4.558–5.848%, and login success drops to 40.947–51.306%. Refresh errors rise and signups fall. Auth traffic weighting accounts for the different service and gateway error rates.
- Checkout processing has no Auth dependency in the topology. Both sampled checkouts pay, send confirmation, and book a carrier. Checkout and payment KPIs, Redis, order and payment storage, Kafka, carrier traffic, and email metrics stay at baseline. The newsletter ends at 10:30 and cron work adds routine logs.
- Both error alerts fire at 10:39 and resolve at 10:56. Auth p95 stays at 254 ms and triggers its 10:44 latency alert. Gateway p95 crosses its threshold intermittently. The page's 5.00% matches the last minute of the qualifying error window.
- The revised outcome grader gives `wrong-with-facts` 0/5 for blaming newsletter load on Users Postgres. It gives `actual-recovery` 5/5 when the answer describes session watchers keeping handles checked out and errors returning to usual levels. Ten identical Stripe checks in `waste` now earn zero efficiency credit.
- Replaying each fixture call against the regenerated data matched its recorded result. `check-case.js` scores the good fixture 10.00/10, the bad fixture 0.00/10, and both empty checks zero. Alternate transcripts in `data/correctness-recheck/` use actual tool responses. I reviewed the judge prompts by inspection.

## Implementation verification

The scores above describe the independent review snapshot. A stable replica now has a successful signup sample. A post-rollback Auth health check earns full recovery credit. The rollback settings alone earn half credit. The probe that blamed the newsletter earned zero outcome points. The model rubric still judges whether distinct calls waste time.
