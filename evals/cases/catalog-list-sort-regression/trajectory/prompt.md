Judge the investigation based on the calls and their results. Give a short reason for each score. Accept equivalent evidence in any order.

A direct path takes about six calls. Identify the slow list route, inspect a representative trace for the replica query plan, check the Catalog change, and verify checkout scope and current latency. A thorough path takes about eleven calls. Alerts, a Catalog health check, the GC logs, and replication metrics can each answer a separate question.

1. **followed_the_cascade**
   - 1. Connects gateway latency to `GET /products`, then to the replica scan and sort, and ties the query to the 11:12 rollout or its settings log.
   - 0.5. Localizes the problem to Catalog or the replica but skips the query or rollout evidence.
   - 0. Guesses from the page or follows an unrelated route or service.
2. **course_correction**
   - 1. Rules out Catalog GC, scraper traffic, or replication lag with observations. For example, distinguishes intermittent p99 pauses from persistent p95 or shows that the slow replica span is executing a query while replication lag is normal.
   - 0.5. Finds the right direction but gives weak evidence against a credible alternative.
   - 0. Stays with a false lead or depends on an untested competing explanation.
3. **efficiency**
   - 1. At most two wasted calls. Checking the page, affected endpoint, replica health, query plan, and checkout can each be useful.
   - 0.5. Three to six wasted calls and the investigation stays on track.
   - 0. More than six wasted calls, or spends the investigation on unrelated systems such as payment providers or Kafka.
