Judge the investigation based on the calls and their results. Give a short reason for each score. Accept equivalent evidence in any order.

A direct path takes about six calls. Find failing Auth routes through gateway samples, get the pool-acquire evidence, find the canary settings, check Users Postgres, measure login impact, and verify recovery. A thorough path takes about eleven calls. It can check both alerts, compare before and after, inspect the rollout history and newsletter timing, or check checkout KPIs.

1. **followed_the_cascade**
   - 1. Connects the gateway 503s to Auth routes and a canary pool wait before SQL. Finds that two session listeners hold the two connections after the 10:34 change.
   - 0.5. Finds Auth and a pool wait or a canary change, but leaves the connection between them unproven.
   - 0. Stops at the gateway, guesses, or attributes the errors to another component.
2. **course_correction**
   - 1. Uses tool evidence to separate the local client pool from a Users Postgres capacity problem or the earlier newsletter spike. No detour is needed if the evidence already rules out a lead.
   - 0.5. Checks a plausible false lead but leaves the result unexplained or follows it longer than the evidence warrants.
   - 0. Makes a false lead the diagnosis or leaves a claimed competing explanation untested.
3. **efficiency**
   - 1. At most two wasted calls. A check of the Users database, recent traffic, the affected routes, or the rollback can be useful even when another tool covers part of it.
   - 0.5. Three to six wasted calls and the investigation stays on track.
   - 0. More than six wasted calls, or the investigation stays on an unrelated service such as Delivery or Notification.
