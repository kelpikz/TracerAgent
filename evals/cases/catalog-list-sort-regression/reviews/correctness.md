# Correctness review: catalog-list-sort-regression

| Part | Score |
| --- | --- |
| Completeness of the cascade | 4/5 |
| Correctness of the checks | 2/5 |

## Findings

1. **Some fast post-deploy queries still lack sort attribution** (cascade)
   - The revised data removes the fast baseline samples for the affected categories and adds small-category traces with the new sort. Seven other successful post-deploy list traces still carry only `db=catalog-replica` on the SELECT. For example, trace `fa5b0fbb88bdb461c22924b453bbe793` is a 12.19 ms books request with no sort or version fields.
   - Add the effective sort and version to remaining default-sort traces, or record the cache or explicit sort that explains a different query path.

2. **Empty metric results can earn onset and ongoing credit** (false positive)
   - `empty-metric` asks for Catalog p95 from 11:50:01 to 11:50:15. The tool returns no data points. Both `checked_latency` and `checked_ongoing_latency` award 1 because the result has the Catalog label. The bad fixture also earns ongoing credit from one endpoint aggregate spanning 11:12 to noon. That aggregate cannot establish when the slowdown ended. The alert branch accepts any active `ServiceLatencyHigh`.
   - Require an observed elevated value near the relevant time. Identify the group of alerts by service. Use the final minute or a short recent window to establish current status.

3. **Scope and rollout checks omit relevant context** (false positive, false negative)
   - One checkout point in `baseline-boundary` earns full scope credit even without a comparison. In `db-replica-scope`, a healthy detail metric and a Catalog replica query p95 above 296 ms earn no scope or symptom credit. The plan check now requires a slow Catalog replica span. The rollout check still matches phrases without checking the service, time, or version.
   - Accept comparable detail, stock, or checkout measurements as scope evidence. Check the latency values and the rollout fields. Give scope credit only when the tool results support the conclusion.

4. **Current status and customer scope remain optional in the trajectory rubric** (coverage, false positive)
   - An early trace, the deploy, and normal replication lag can meet both main trajectory anchors without a scope or late-window check. The outcome rubric covers those requirements and the rollback action. The deterministic outcome omits customer scope and action. The zero-call transcript meets the judge efficiency anchor's literal waste limit. `distinct-waste` earns full deterministic efficiency after two useful calls and ten irrelevant Stripe checks over distinct minute windows.
   - Give scope and current-status evidence their own trajectory credit, and score the proposed mitigation and verification. Require substantive evidence for positive efficiency and count irrelevant calls as waste.

5. **The good answer overgeneralizes sampled product detail latency** (fact)
   - The fixture says sampled product details stayed fast. The p95 of the sample is 8.87 ms, but detail trace `57b41e44f47020c4dff03ddfed242cb8` takes 1,520.8 ms during the known 11:37 GC pause. The separate detail p95 metric stays at its 50.8–64.1 ms baseline.
   - State that detail p95 stayed low and attribute the isolated slow detail trace to GC.

## Checked and correct

- Catalog v1.9.0 replaces v1.8.2 at 11:12. The settings log and trace `0410e5e2d3e8b68bb20ee077fe0c1c24` tie `supplier_rank NULLS LAST, id` to a sequential scan and top-N heapsort for a large category. The replica SELECT takes 323.67 ms of the request's 328.58 ms and the route returns HTTP 200. Small-category trace `1d12aaf55db353cc9749dc767483d0fd` shows the same sort with a 120-row index scan.
- Replica query p95 is 296.8–407.3 ms while lag stays at 0.05–0.96 seconds. The extra slow-query count averages about 316 per minute, consistent with the 48% list-traffic share and the 20% affected-list fraction. The product-detail metric now stays on its baseline.
- All six sampled checkouts in the window reach PAID. Stock reservation, checkout, payment, Kafka, carrier, and email metrics remain at baseline. The topology gives browsing no Kafka or provider dependency.
- Catalog and gateway latency alerts fire at 11:22 after ten qualifying minutes and stay active at noon. The page quotes gateway p95 of 385.9 ms from 11:21. The last available minute shows Catalog p95 of 327.7 ms and gateway p95 of 312.2 ms. The earlier 11:08 scraper burst appears as gateway 429s. The 11:37 GC pause raises Catalog p99.
- The revised outcome grader gives `baseline-boundary` 1.67/5 for reporting the ongoing slowdown. It gives zero for claiming GC caused it and putting the scan on unrelated analytics. `late-window` earns 5/5 for equivalent language about the vendor priority, read follower, heap order, and current status. Ten identical Stripe checks in `db-replica-scope` now earn zero efficiency credit.
- Replaying each fixture call against the regenerated data matched its recorded result. `check-case.js` scores the good fixture 10.00/10, the GC-focused bad fixture 2.50/10, and both empty checks zero. Alternate transcripts in `data/correctness-recheck/` use actual tool responses. I reviewed the judge prompts by inspection.

## Implementation verification

The scores above describe the independent review snapshot. Post-deploy list samples now carry their effective sort. Empty metric results earn zero latency and status credit. Detail latency and replica health can earn scope and symptom credit. The sample answer describes detail p95 and the timing of the GC pause separately. The model rubric still judges whether distinct calls waste time.
