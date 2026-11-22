"""Incidents: real faults for eval cases.

An incident uses the same overlay model as seed/noise.py (read its docstring). The difference:
an incident is a real fault that needs an action, and it sets `c.info` for the Info tab of the case.

Rules for a new incident (see .claude/skills/create-eval-case/references/seed-incident.md):
- Put the fault at a fixed time in the window (12:00 Nov 19 to 12:00 Nov 20 UTC). Use idx(h, m).
- Show the fault in every service it reaches: metrics, logs, traces, orders, Kafka, emails, alerts.
- Replace baseline samples that would contradict the fault (c.drop_orders_created, c.drop).
- Compute the info text from the values the code makes. Do not type numbers by hand.

generate.py calls build() after the noise items. Each incident has its own random generator.
"""
from noise import Ctx, idx, registry  # noqa: F401  (Ctx: the type of `c`)

ITEMS = []
item = registry(ITEMS)


def build(g, by_key):
    import noise
    return noise.build(g, by_key, ITEMS)


# ---------------------------------------------------------------- helpers
def hm(g, i, sec=0.0):
    """'Nov 20, 08:12 UTC' for a minute index."""
    t = g.at(i, sec)
    return f"{t:%b} {t.day}, {t:%H:%M} UTC"


def span_text(g, i0, i1):
    """'Nov 20, 08:12 to 08:58 UTC'"""
    return f"{hm(g, i0)[:-4]} to {g.at(i1):%H:%M} UTC"


def split(total, parts):
    """Split an integer into `parts` integers that add up to `total`."""
    base, extra = divmod(total, parts)
    return [base + (1 if k < extra else 0) for k in range(parts)]


def pending_checkout(g, t0):
    """A checkout that creates a payment intent and ends in PENDING. The order waits for the Stripe webhook."""
    R = g.R
    tid, spans, tl = g.hexid(32), [], []
    oid, uid = g.order_id(), g.user_id()
    amount, items, pay_id = round(R.uniform(12, 240), 2), R.randint(1, 4), "pay_" + g.hexid(10)
    gw = g.span(spans, tid, None, "gateway", "POST /checkout", t0, http_status=201)
    o0 = g.ms(t0, R.uniform(0.4, 1.5))
    o = g.span(spans, tid, gw, "order", "POST /checkout", o0, http_status=201, order_id=oid, user_id=uid)
    cur = g.run_steps(spans, tid, o, "order", [("pg INSERT orders", "client", 4.5, {"db": "orders"})], o0)
    tl.append((g.ms(o0, cur), "order", "order created (status NEW)", tid))
    c0 = g.ms(o0, cur)
    cs = g.span(spans, tid, o, "catalog", "POST /stock/reserve", c0, http_status=200, order_id=oid, items=items)
    cs["duration_ms"] = g.run_steps(spans, tid, cs, "catalog",
                                    [("pg UPDATE stock", "client", 6, {"db": "catalog"})], c0) + R.uniform(1, 3)
    g.log(g.end(cs), "catalog", "info", "stock reserved", cs, order_id=oid, items=items)
    tl.append((g.end(cs), "catalog", "stock reserved", tid))
    cur += cs["duration_ms"] + 0.5
    p0 = g.ms(o0, cur)
    p = g.span(spans, tid, o, "payment", "POST /payments", p0, http_status=201,
               order_id=oid, payment_id=pay_id, amount=amount, currency="EUR")
    p["duration_ms"] = g.run_steps(spans, tid, p, "payment", [
        ("stripe POST /v1/payment_intents", "client", 330, {"peer": "stripe", "http_status": 200}),
        ("pg INSERT payments", "client", 4, {"db": "payments"}),
    ], p0) + R.uniform(1, 2)
    g.log(g.end(p), "payment", "info", "payment intent created", p, order_id=oid, payment_id=pay_id, amount=amount)
    tl.append((g.end(p), "payment", "payment intent created", tid))
    cur += p["duration_ms"] + 0.5
    cur += g.run_steps(spans, tid, o, "order", [("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})],
                       g.ms(o0, cur))
    o["duration_ms"] = cur + R.uniform(1, 3)
    g.log(g.end(o), "order", "info", "order created", o, order_id=oid, status="PENDING", amount=amount)
    tl.append((g.end(o), "order", "status PENDING", tid))
    gw["duration_ms"] = o["duration_ms"] + R.uniform(0.8, 3)
    g.access_log(gw)
    pub = g.publish(spans, tid, o, "order", "order.created", g.ms(g.end(o), R.uniform(150, 1200)))
    tl.append((g.end(pub), "order", "event published: order.created", tid))
    g.email(spans, tid, pub, "order.created", "order_received", oid, tl)
    g.TRACES.append(spans)
    return {"oid": oid, "uid": uid, "amount": amount, "items": items, "pay_id": pay_id,
            "t0": t0, "end": g.end(gw), "tl": tl}


# ===================================================================== incidents

@item(id="stripe_webhook_secret", title="Stripe webhooks rejected after a secret rotation",
      when="08:12 to 09:06 UTC", looks_like="A Stripe outage, or a slow Order service",
      example="OrdersStuckPending fires. Checkout and payment success rates stay normal. "
              "Payment logs 'webhook rejected: invalid signature' for each Stripe webhook.",
      truth="At 08:12, ops rotates STRIPE_WEBHOOK_SECRET in Payment, but the Stripe dashboard still signs "
            "with the old secret. Payment rejects every Stripe webhook with HTTP 400. Paid orders stay in "
            "PENDING: no payment.succeeded or order.paid events, no confirmation emails, no carrier bookings. "
            "At 08:58, ops rolls back the secret and resends the failed events. The backlog clears by 09:06.")
def stripe_webhook_secret(g, c):
    R = g.R
    s, e, drain = idx(8, 12), idx(8, 58), 8  # bad secret from s, rollback at e, backlog sent over `drain` minutes
    end = e + drain
    reason = "No signatures found matching the expected signature for payload"

    c.event("config", s, "payment", "Rotate Stripe webhook signing secret (STRIPE_WEBHOOK_SECRET)")
    c.event("config", e, "payment", "Roll back STRIPE_WEBHOOK_SECRET to the previous value")
    g.log(g.at(s, 2.1), "payment", "info", "config reloaded", change="STRIPE_WEBHOOK_SECRET rotated")
    g.log(g.at(e, 2.4), "payment", "info", "config reloaded", change="STRIPE_WEBHOOK_SECRET rolled back")

    # ---- metrics
    ok = c.base("kafka_messages_in_per_min", topic="order.created")  # paid checkouts per minute
    hooks = c.base("webhooks_received_per_min", provider="stripe")
    gw_rps = c.base("http_requests_per_second", service="gateway")
    stripe = {"provider": "stripe"}
    backlog = sum(ok[s:e])
    sent = split(backlog, drain)

    queue, pending, stuck, oldest, bad = [], [], [], [], []  # queue: [minute created, orders] oldest first
    for i in range(s, end):
        if i < e:
            queue.append([i, ok[i]])
            # Stripe retries each failed event after about 1, 5 and 30 minutes. The retries fail too.
            retries = sum(ok[m] for m in (i - 1, i - 5, i - 30) if m >= s)
            n_bad = hooks[i] + retries
            c.add("webhooks_received_per_min", stripe, i, retries)
            c.add("webhook_bad_signatures_per_min", stripe, i, n_bad)
            c.add("http_4xx_rate", {"service": "gateway"}, i, 100 * n_bad / (gw_rps[i] * 60))
            bad.append(n_bad)
            gone = ok[i]
            for t in ("payment.succeeded", "order.paid"):
                c.add("kafka_messages_in_per_min", {"topic": t}, i, -c.base("kafka_messages_in_per_min", topic=t)[i])
        else:
            n = sent[i - e]
            c.add("webhooks_received_per_min", stripe, i, n)
            for t in ("payment.succeeded", "order.paid"):
                c.add("kafka_messages_in_per_min", {"topic": t}, i, n)
            left = n
            while left and queue:
                take = min(left, queue[0][1])
                queue[0][1] -= take
                left -= take
                if queue[0][1] == 0:
                    queue.pop(0)
            gone = -n  # these orders now go on: emails, carrier bookings
        # What follows a paid order: confirmation email, carrier booking, delivery.updated event.
        for name, lab in (("emails_sent_per_min", {}),
                          ("third_party_requests_per_min", {"provider": "email"}),
                          ("third_party_requests_per_min", {"provider": "carrier"}),
                          ("kafka_messages_in_per_min", {"topic": "delivery.updated"})):
            c.add(name, lab, i, -min(gone, c.base(name, **lab)[i]))
        p = sum(q[1] for q in queue)
        st = sum(q[1] for q in queue if q[0] <= i - 15)
        pending.append(p)
        stuck.append(st)
        oldest.append(queue[0][0] if queue else None)
        c.add("orders_pending", {}, i, p)
        c.add("orders_stuck_pending_15m", {}, i, st)

    # ---- alerts
    first_bad = next(s + k for k, v in enumerate(bad) if v > 10)
    c.alert("BadWebhookSignatures", "warning", first_bad, e,
            f"webhook_bad_signatures_per_min{{provider=stripe}} {bad[first_bad - s]} > 10")
    c.fire_for("OrdersStuckPending", "critical", "orders_stuck_pending_15m", {}, lambda v: v > 5, 1,
               "orders_stuck_pending_15m {v:.0f} > 5")

    # ---- stuck orders job: warns while orders wait more than 15 minutes
    stuck_from = s + next(k for k, v in enumerate(stuck) if v > 0)
    c.drop.append({"service": "order", "msg": "stuck orders job finished",
                   "from": g.iso(g.at(stuck_from)), "to": g.iso(g.at(end))})
    for i in range(stuck_from, end):
        st = stuck[i - s]
        if st:
            g.log(g.at(i, 0.2), "order", "warn", "stuck orders job finished", pending_over_15m=st,
                  oldest_age_min=i - oldest[i - s], duration_ms=round(g.jit(18, 0.2), 1))
        else:
            g.log(g.at(i, 0.2), "order", "info", "stuck orders job finished", pending_over_15m=0,
                  duration_ms=round(g.jit(18, 0.2), 1))

    # ---- sample orders: baseline samples in the window would show normal payments, so replace them
    c.drop_orders_created(s - 1, e)
    samples, first_trace = [], None
    for m in sorted(R.sample(range(s, e - 1), 12)):
        o = pending_checkout(g, g.at(m, R.uniform(0, 50)))
        tl = o["tl"]
        # Stripe tries at once, then after about 1, 5 and 30 minutes. Each try fails until the rollback.
        for k, wait_s in enumerate([R.uniform(1.5, 6), 60, 300, 1800], 1):
            t = g.ms(o["end"], wait_s * 1000)
            if t >= g.at(e):
                break
            spans = g.request(t, "POST /webhooks/stripe", "payment",
                              [("verify signature", "internal", 0.3, {"_status": "error"})],
                              status=400, level="warn", msg="webhook rejected: invalid signature", err=reason,
                              event_type="payment_intent.succeeded", payment_id=o["pay_id"],
                              order_id=o["oid"], attempt=k)
            first_trace = first_trace or spans[0]["trace_id"]
            tl.append((g.end(spans[1]), "payment", f"Stripe webhook rejected (attempt {k}): invalid signature",
                       spans[0]["trace_id"]))
        # After the rollback, ops resends the failed events. The oldest go first.
        k_min = e + min(drain - 1, (m - s) * drain // (e - s))
        t = g.at(k_min, R.uniform(5, 55))
        spans = g.request(t, "POST /webhooks/stripe", "payment", [
            ("verify signature", "internal", 0.3, {}),
            ("pg UPDATE payments", "client", 4, {"db": "payments"}),
            ("pg INSERT outbox", "client", 2, {"db": "payments"}),
        ], msg="webhook received", event_type="payment_intent.succeeded", payment_id=o["pay_id"],
            order_id=o["oid"], resent=True)
        tid, sv = spans[0]["trace_id"], spans[1]
        tl.append((g.end(sv), "payment", "Stripe webhook (resent): payment_intent.succeeded", tid))
        pub = g.publish(spans, tid, sv, "payment", "payment.succeeded", g.ms(g.end(sv), R.uniform(100, 900)))
        oc = g.consume(spans, tid, pub, "order", "payment.succeeded", R.uniform(20, 400),
                       [("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})])
        g.log(g.end(oc), "order", "info", "order status changed", oc, order_id=o["oid"], status="PAID")
        tl.append((g.end(oc), "order", "status PAID", tid))
        pub = g.publish(spans, tid, oc, "order", "order.paid", g.ms(g.end(oc), R.uniform(100, 900)))
        tl.append((g.end(pub), "order", "event published: order.paid", tid))
        g.email(spans, tid, pub, "order.paid", "order_confirmed", o["oid"], tl)
        dc = g.consume(spans, tid, pub, "delivery", "order.paid", R.uniform(20, 400), [
            ("carrier POST /shipments", "client", 620, {"peer": "carrier", "http_status": 201}),
            ("pg INSERT shipments + outbox", "client", 5, {"db": "shipments"})])
        g.log(g.end(dc), "delivery", "info", "carrier booked", dc, order_id=o["oid"],
              shipment_id="shp_" + g.hexid(8), carrier=R.choice(["DHL", "UPS", "DPD"]))
        tl.append((g.end(dc), "delivery", "carrier booked", tid))
        g.finish_order(o["oid"], o["uid"], o["t0"], o["amount"], o["items"], "PAID", tl)
        samples.append((o, m))

    # ---- info for the eval case page. All values come from the code above.
    a_stuck = next(a for a in c.alerts if a["name"] == "OrdersStuckPending")
    a_bad = next(a for a in c.alerts if a["name"] == "BadWebhookSignatures")
    peak_stuck, peak_at = max((v, s + k) for k, v in enumerate(stuck))
    long_wait = next(o for o, m in samples if m - s < (e - s) // 3)
    t_ = lambda ts: ts[11:16]  # noqa: E731  'HH:MM' from an ISO time
    c.info = {
        "failure": f"Payment rejects every Stripe webhook from {t_(g.iso(g.at(s)))} to {t_(g.iso(g.at(e)))} UTC. "
                   f"{backlog} paid orders stay in `PENDING`. Customers get no confirmation email and the shop "
                   "books no shipments. Checkout itself still works.",
        "trigger": f"At {t_(g.iso(g.at(s)))} UTC, ops rotates `STRIPE_WEBHOOK_SECRET` in Payment. Stripe still signs "
                   "webhooks with the old secret, so the signature check fails with HTTP 400. At "
                   f"{t_(g.iso(g.at(e)))} UTC, ops rolls back the secret and resends the failed events.",
        "affected": [
            {"name": "payment", "kind": "service",
             "impact": "Rejects each Stripe webhook with HTTP 400. Publishes no `payment.succeeded` events."},
            {"name": "stripe", "kind": "provider",
             "impact": "Healthy. Its webhooks fail on the shop side, and it retries them."},
            {"name": "order", "kind": "service",
             "impact": f"Orders stay in `PENDING`. Up to {peak_stuck} orders wait more than 15 minutes."},
            {"name": "notification", "kind": "service",
             "impact": "Sends no `order_confirmed` emails until the backlog is resent."},
            {"name": "delivery", "kind": "service",
             "impact": "Books no shipments until the backlog is resent."},
        ],
        "signals": [
            {"source": "event", "where": "Changes",
             "what": "A `payment` config change rotates the Stripe webhook secret. A second change rolls it back.",
             "when": f"{hm(g, s)} and {hm(g, e)}", "dashboard": "#changes"},
            {"source": "alert", "where": "OrdersStuckPending",
             "what": f"The critical alert fires at {t_(a_stuck['fired_at'])} UTC and clears at "
                     f"{t_(a_stuck['resolved_at'])} UTC.",
             "when": f"Nov 20, {t_(a_stuck['fired_at'])} to {t_(a_stuck['resolved_at'])} UTC", "dashboard": "#changes"},
            {"source": "alert", "where": "BadWebhookSignatures",
             "what": f"The warning fires at {t_(a_bad['fired_at'])} UTC and clears at {t_(a_bad['resolved_at'])} UTC.",
             "when": f"Nov 20, {t_(a_bad['fired_at'])} to {t_(a_bad['resolved_at'])} UTC", "dashboard": "#changes"},
            {"source": "metric", "where": "webhook_bad_signatures_per_min{provider=stripe}",
             "what": f"Goes from 0 to {min(bad)} to {max(bad)} per minute. It grows as Stripe retries. "
                     "It is 0 again after the rollback.",
             "when": span_text(g, s, e), "dashboard": "#deps"},
            {"source": "metric", "where": "orders_stuck_pending_15m",
             "what": f"Rises from 0 at {t_(g.iso(g.at(stuck_from)))} UTC to {peak_stuck} at "
                     f"{t_(g.iso(g.at(peak_at)))} UTC. It is 0 again at {t_(g.iso(g.at(end)))} UTC.",
             "when": span_text(g, stuck_from, end), "dashboard": "#business"},
            {"source": "metric", "where": "kafka_messages_in_per_min{topic=payment.succeeded}",
             "what": "Drops to 0 while `order.created` stays normal. A spike follows when the backlog is resent.",
             "when": span_text(g, s, end), "dashboard": "#deps"},
            {"source": "business", "where": "Checkout and payment success rates",
             "what": "Stay normal. Payment intents are created. This is a dead end for an agent that checks only "
                     "these rates.",
             "when": span_text(g, s, e), "dashboard": "#business"},
            {"source": "log", "where": "webhook rejected: invalid signature",
             "what": f"Search for `invalid signature`. Payment logs a warning with `error: {reason}` for each try.",
             "when": span_text(g, s, e), "dashboard": "#logs"},
            {"source": "trace", "where": "POST /webhooks/stripe",
             "what": "The gateway returns HTTP 400. The `verify signature` span has status error.",
             "when": hm(g, s), "dashboard": f"#traces/{first_trace}"},
            {"source": "order", "where": long_wait["oid"],
             "what": "The timeline shows the order in `PENDING`, the rejected webhook tries, then `PAID` after "
                     "the resend.",
             "when": f"{hm(g, s)} to {t_(g.iso(g.at(end)))} UTC", "dashboard": f"#orders/{long_wait['oid']}"},
        ],
        "expected": {
            "root_cause": f"The {t_(g.iso(g.at(s)))} UTC rotation of `STRIPE_WEBHOOK_SECRET` in Payment does not "
                          "match the secret in Stripe. Payment rejects the webhooks (HTTP 400, invalid signature), "
                          "so orders do not move from `PENDING` to `PAID`. Stripe is healthy.",
            "impact": f"{backlog} orders wait up to {e - s} minutes for `PAID`. Confirmation emails and carrier "
                      "bookings wait too. No payment is lost and checkout success stays normal.",
            "next_steps": "Roll back the secret or set the same secret in Stripe, resend the failed events, and check "
                          "that the stuck orders clear. Update the secret in both places together next time.",
        },
    }


def slow_stripe_checkout(g, t0, stripe_ms, empty):
    """A checkout while Stripe is slow. empty=True: Stripe returns HTTP 200 with an empty body,
    Payment cannot parse it and returns 502, and Order fails the checkout. Stripe makes no payment intent."""
    R = g.R
    tid, spans, tl = g.hexid(32), [], []
    oid, uid = g.order_id(), g.user_id()
    amount, items, pay_id = round(R.uniform(12, 240), 2), R.randint(1, 4), "pay_" + g.hexid(10)
    status = 502 if empty else 201
    gw = g.span(spans, tid, None, "gateway", "POST /checkout", t0, http_status=status)
    o0 = g.ms(t0, R.uniform(0.4, 1.5))
    o = g.span(spans, tid, gw, "order", "POST /checkout", o0, http_status=status, order_id=oid, user_id=uid)
    cur = g.run_steps(spans, tid, o, "order", [("pg INSERT orders", "client", 4.5, {"db": "orders"})], o0)
    tl.append((g.ms(o0, cur), "order", "order created (status NEW)", tid))
    c0 = g.ms(o0, cur)
    cs = g.span(spans, tid, o, "catalog", "POST /stock/reserve", c0, http_status=200, order_id=oid, items=items)
    cs["duration_ms"] = g.run_steps(spans, tid, cs, "catalog",
                                    [("pg UPDATE stock", "client", 6, {"db": "catalog"})], c0) + R.uniform(1, 3)
    g.log(g.end(cs), "catalog", "info", "stock reserved", cs, order_id=oid, items=items)
    tl.append((g.end(cs), "catalog", "stock reserved", tid))
    cur += cs["duration_ms"] + 0.5
    p0 = g.ms(o0, cur)
    p = g.span(spans, tid, o, "payment", "POST /payments", p0, http_status=status,
               order_id=oid, payment_id=pay_id, amount=amount, currency="EUR")
    stripe = ("stripe POST /v1/payment_intents", "client", stripe_ms,
              {"peer": "stripe", "http_status": 200, "body_bytes": 0 if empty else R.randint(1800, 2600),
               "_exact": True})
    if empty:
        p["status"] = o["status"] = gw["status"] = "error"
        p["attrs"]["error"] = "failed to parse stripe response: unexpected end of JSON input"
        o["attrs"]["error"] = "payment returned 502"
        p["duration_ms"] = g.run_steps(spans, tid, p, "payment", [
            stripe, ("parse stripe response", "internal", 0.2,
                     {"_status": "error", "error": "unexpected end of JSON input"})], p0) + R.uniform(1, 2)
        g.log(g.end(p), "payment", "error", "failed to parse stripe response", p, order_id=oid,
              payment_id=pay_id, stripe_latency_ms=round(stripe_ms),
              error="unexpected end of JSON input")
        tl.append((g.end(p), "payment", "payment failed (HTTP 502)", tid))
        cur += p["duration_ms"] + 0.5
        r0 = g.ms(o0, cur)
        rel = g.span(spans, tid, o, "catalog", "POST /stock/release", r0, http_status=200, order_id=oid)
        rel["duration_ms"] = g.run_steps(spans, tid, rel, "catalog",
                                         [("pg UPDATE stock", "client", 6, {"db": "catalog"})], r0) + 1
        g.log(g.end(rel), "catalog", "info", "stock released", rel, order_id=oid, items=items)
        tl.append((g.end(rel), "catalog", "stock released", tid))
        cur += rel["duration_ms"] + 0.5
        cur += g.run_steps(spans, tid, o, "order", [("pg UPDATE orders", "client", 4, {"db": "orders"})],
                           g.ms(o0, cur))
        o["duration_ms"] = cur + R.uniform(1, 3)
        g.log(g.end(o), "order", "error", "checkout failed: payment error", o, order_id=oid,
              status="PAYMENT_FAILED", upstream="payment", upstream_status=502)
        tl.append((g.end(o), "order", "status PAYMENT_FAILED", tid))
        gw["duration_ms"] = o["duration_ms"] + R.uniform(0.8, 3)
        g.access_log(gw)
        g.TRACES.append(spans)
        g.finish_order(oid, uid, t0, amount, items, "PAYMENT_FAILED", tl)
        return {"oid": oid, "trace": tid, "t0": t0}

    p["duration_ms"] = g.run_steps(spans, tid, p, "payment", [
        stripe, ("pg INSERT payments", "client", 4, {"db": "payments"})], p0) + R.uniform(1, 2)
    g.log(g.end(p), "payment", "info", "payment intent created", p, order_id=oid, payment_id=pay_id, amount=amount)
    tl.append((g.end(p), "payment", "payment intent created", tid))
    cur += p["duration_ms"] + 0.5
    cur += g.run_steps(spans, tid, o, "order", [("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})],
                       g.ms(o0, cur))
    o["duration_ms"] = cur + R.uniform(1, 3)
    g.log(g.end(o), "order", "info", "order created", o, order_id=oid, status="PENDING", amount=amount)
    tl.append((g.end(o), "order", "status PENDING", tid))
    gw["duration_ms"] = o["duration_ms"] + R.uniform(0.8, 3)
    g.access_log(gw)
    pub = g.publish(spans, tid, o, "order", "order.created", g.ms(g.end(o), R.uniform(150, 1200)))
    tl.append((g.end(pub), "order", "event published: order.created", tid))
    g.email(spans, tid, pub, "order.created", "order_received", oid, tl)
    g.TRACES.append(spans)

    # The Stripe webhook arrives as normal.
    spans2 = g.request(g.ms(g.end(gw), R.uniform(1500, 6000)), "POST /webhooks/stripe", "payment", [
        ("verify signature", "internal", 0.3, {}),
        ("pg UPDATE payments", "client", 4, {"db": "payments"}),
        ("pg INSERT outbox", "client", 2, {"db": "payments"}),
    ], msg="webhook received", event_type="payment_intent.succeeded", payment_id=pay_id, order_id=oid)
    tid2, sv = spans2[0]["trace_id"], spans2[1]
    tl.append((g.end(sv), "payment", "Stripe webhook: payment_intent.succeeded", tid2))
    pub = g.publish(spans2, tid2, sv, "payment", "payment.succeeded", g.ms(g.end(sv), R.uniform(100, 900)))
    oc = g.consume(spans2, tid2, pub, "order", "payment.succeeded", R.uniform(20, 400),
                   [("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})])
    g.log(g.end(oc), "order", "info", "order status changed", oc, order_id=oid, status="PAID")
    tl.append((g.end(oc), "order", "status PAID", tid2))
    pub = g.publish(spans2, tid2, oc, "order", "order.paid", g.ms(g.end(oc), R.uniform(100, 900)))
    tl.append((g.end(pub), "order", "event published: order.paid", tid2))
    g.email(spans2, tid2, pub, "order.paid", "order_confirmed", oid, tl)
    dc = g.consume(spans2, tid2, pub, "delivery", "order.paid", R.uniform(20, 400), [
        ("carrier POST /shipments", "client", 620, {"peer": "carrier", "http_status": 201}),
        ("pg INSERT shipments + outbox", "client", 5, {"db": "shipments"})])
    g.log(g.end(dc), "delivery", "info", "carrier booked", dc, order_id=oid,
          shipment_id="shp_" + g.hexid(8), carrier=R.choice(["DHL", "UPS", "DPD"]))
    tl.append((g.end(dc), "delivery", "carrier booked", tid2))
    g.publish(spans2, tid2, dc, "delivery", "delivery.updated", g.ms(g.end(dc), R.uniform(100, 900)))
    g.finish_order(oid, uid, t0, amount, items, "PAID", tl)
    return {"oid": oid, "trace": tid, "t0": t0}


@item(id="stripe_empty_responses", title="Stripe returns slow, empty HTTP 200 responses",
      when="11:20 UTC to now (12:00 UTC)", looks_like="A bad Order deploy, or a Kafka or email problem",
      example="CheckoutSuccessLow fires. Checkout spins for 5 to 10 seconds, then fails. The Stripe error rate is "
              "normal. An Order deploy went live 4 minutes before the fault.",
      truth="From 11:20, Stripe POST /v1/payment_intents is slow (p95 about 9 s), and about 60% of its responses "
            "are HTTP 200 with an empty body. Payment cannot parse the body, logs 'failed to parse stripe response', "
            "and returns 502. Order fails the checkout and releases the stock. Stripe makes no payment intent, so "
            "no customer is charged. Fewer paid orders means fewer payment.succeeded and order.paid events, emails "
            "and carrier bookings. The Order v4.12.0 deploy at 11:16 is not related. The fault is still active.")
def stripe_empty_responses(g, c):
    R = g.R
    dep, s, N = idx(11, 16), idx(11, 20), g.MINUTES
    p_empty = 0.6  # share of Stripe calls that return an empty body
    version, previous = "v4.12.0", "v4.11.3"

    # ---- the Order deploy (a dead end). Same rollout shape as the baseline deploys.
    c.event("deploy", dep, "order", "Add gift message field to orders", by="ci-bot",
            version=version, previous=previous, commit=g.hexid(7))
    t = g.at(dep, 5)
    for pod in range(g.SERVICES["order"]["pods"]):
        pt = g.ms(t, 90_000 * pod)
        g.log(pt, "order", "info", "SIGTERM received, draining connections", pod=f"order-{g.hexid(5)}",
              version=previous)
        g.log(g.ms(pt, 3000), "order", "info", f"starting order {version}", pod=f"order-{g.hexid(5)}",
              version=version)
        g.log(g.ms(pt, 6000), "order", "info", "ready, listening on :8080", version=version)
    deploy_done = g.ms(pt, 6000)
    o_p95 = c.base("http_latency_p95_ms", service="order")
    for i in range(dep, dep + 3):
        c.add("cpu_pct", {"service": "order"}, i, 8)
        c.add("http_latency_p95_ms", {"service": "order"}, i, o_p95[i] * 0.15)

    # ---- metrics: one count of failed checkouts per minute, used everywhere
    attempts = c.base("checkout_attempts_per_min")
    stock_fail = c.base("catalog_stock_reserve_failures_per_min")
    ok = c.base("kafka_messages_in_per_min", topic="order.created")  # paid checkouts per minute
    rps = {sv: c.base("http_requests_per_second", service=sv) for sv in ("payment", "order", "gateway")}
    fails = []
    for i in range(s, N):
        fail = g.binom(ok[i], p_empty)
        fails.append(fail)

        def cut(name, n, **lab):
            c.add(name, lab, i, -min(n, c.cur(name, **lab)[i]))

        c.add("checkout_success_rate", {}, i, -100 * fail / attempts[i])
        c.add("payment_success_rate", {}, i, -100 * fail / (attempts[i] - stock_fail[i]))
        for topic in ("order.created", "payment.succeeded", "order.paid", "delivery.updated"):
            cut("kafka_messages_in_per_min", fail, topic=topic)
        cut("webhooks_received_per_min", fail, provider="stripe")
        cut("third_party_requests_per_min", fail, provider="carrier")
        cut("third_party_requests_per_min", 2 * fail, provider="email")
        cut("emails_sent_per_min", 2 * fail)
        pend = c.base("orders_pending")[i]
        c.add("orders_pending", {}, i, round(pend * (ok[i] - fail) / ok[i]) - pend if ok[i] else 0)
        for sv in ("payment", "order", "gateway"):
            c.add("http_error_rate", {"service": sv}, i, 100 * fail / (rps[sv][i] * 60))
        # Stripe: slow for most calls. Its error rate does not change: the empty responses are HTTP 200.
        sp95 = R.uniform(9000, 9800)
        c.add("third_party_latency_p95_ms", {"provider": "stripe"}, i,
              sp95 - c.base("third_party_latency_p95_ms", provider="stripe")[i])
        for sv, extra in (("payment", 15), ("order", 45)):
            for name, k in (("http_latency_p95_ms", 1.0), ("http_latency_p99_ms", 1.06)):
                c.add(name, {"service": sv}, i, (sp95 + extra) * k - c.cur(name, service=sv)[i])

    # ---- alerts (the real rules)
    c.fire_for("CheckoutSuccessLow", "critical", "checkout_success_rate", {}, lambda v: v < 90, 10,
               "checkout_success_rate {v:.1f}% < 90% for 10m")
    c.fire_for("PaymentSuccessLow", "critical", "payment_success_rate", {}, lambda v: v < 90, 10,
               "payment_success_rate {v:.1f}% < 90% for 10m")
    for sv in ("payment", "order"):
        c.fire_for("ServiceErrorRateHigh", "serious", "http_error_rate", {"service": sv}, lambda v: v > 2, 5,
                   f"http_error_rate{{{{service={sv}}}}} {{v:.1f}}% > 2% for 5m")
        normal = sorted(c.base("http_latency_p95_ms", service=sv))[N // 2]
        c.fire_for("ServiceLatencyHigh", "warning", "http_latency_p95_ms", {"service": sv},
                   lambda v, n=normal: v > 2 * n, 10,
                   f"http_latency_p95_ms{{{{service={sv}}}}} {{v:.0f}} ms > 2x normal ({normal:.0f} ms) for 10m")

    # ---- logs: errors are logged for a share of the failures (the rest are in the metrics)
    for k, fail in enumerate(fails):
        i = s + k
        for _ in range(g.binom(fail, 0.25)):
            t0 = g.at(i, R.uniform(0, 59))
            ms_ = R.uniform(5000, 9900)
            oid, pay_id = g.order_id(), "pay_" + g.hexid(10)
            g.log(t0, "payment", "error", "failed to parse stripe response", order_id=oid, payment_id=pay_id,
                  stripe_latency_ms=round(ms_),
                  error="unexpected end of JSON input")
            g.log(g.ms(t0, 15), "order", "error", "checkout failed: payment error", order_id=oid,
                  status="PAYMENT_FAILED", upstream="payment", upstream_status=502)

    # ---- sample checkouts. Tail sampling keeps all failed and slow traces, so there are more than normal.
    c.drop_orders_created(s, N)
    kinds = ["empty"] * 18 + ["slow"] * 8 + ["fast"] * 3
    R.shuffle(kinds)
    samples = []
    for m, kind in zip(sorted(R.sample(range(s, N - 1), len(kinds))), kinds):
        ms_ = {"empty": R.uniform(5000, 9900), "slow": R.uniform(3000, 9000), "fast": R.uniform(280, 450)}[kind]
        o = slow_stripe_checkout(g, g.at(m, R.uniform(0, 50)), ms_, kind == "empty")
        samples.append((kind, o, ms_))
    # Order reads on the new version stay fast: proof that the deploy did not slow Order down.
    for m in sorted(R.sample(range(dep + 2, N - 1), 6)):
        g.request(g.at(m, R.uniform(0, 59)), "GET /orders/:id", "order",
                  [("pg SELECT orders", "client", 3, {"db": "orders"})], msg=None, user_id=g.user_id())
    # A new, harmless warning from the new Order version. It makes the deploy look guilty in log_patterns.
    gift_warns = 0
    for i in range(dep + 2, N):
        for _ in range(g.poisson(1.2)):
            g.log(g.at(i, R.uniform(0, 59)), "order", "warn", "unknown field gift_note in checkout request, "
                  "mapped to gift_message", version=version, client="web-2026.11.3")
            gift_warns += 1

    # ---- info for the eval case page. All values come from the code above.
    total_fail = sum(fails)
    total_att = sum(attempts[s:N])
    succ = c.cur("checkout_success_rate")[s:N]
    a_co = next(a for a in c.alerts if a["name"] == "CheckoutSuccessLow")
    a_pay = next(a for a in c.alerts if a["name"] == "PaymentSuccessLow")
    a_svc = [a for a in c.alerts if a["name"] in ("ServiceErrorRateHigh", "ServiceLatencyHigh")]
    first_fail = next(o for k, o, _ in samples if k == "empty")
    empties = [x for k, _, x in samples if k == "empty"]
    t_ = lambda ts: ts[11:16]  # noqa: E731  'HH:MM' from an ISO time
    base_sp95 = sorted(c.base("third_party_latency_p95_ms", provider="stripe"))[N // 2]
    base_succ = sum(c.base("checkout_success_rate")[:s]) / s
    pct_fail = round(100 * total_fail / total_att)
    c.info = {
        "failure": f"From {t_(g.iso(g.at(s)))} UTC, checkout spins for 5 to 10 seconds and then fails for about "
                   f"{pct_fail}% of attempts. {total_fail} of {total_att} checkouts fail by {t_(g.iso(g.at(N)))} UTC. "
                   "Product pages, login and cart work. The fault is still active.",
        "trigger": f"At {t_(g.iso(g.at(s)))} UTC, Stripe `POST /v1/payment_intents` becomes slow (p95 goes from about "
                   f"{base_sp95:.0f} ms to over 9000 ms). About {round(100 * p_empty)}% of its responses are HTTP 200 "
                   "with an empty body. Payment cannot parse the body and returns 502. Nothing changes in the shop: "
                   f"the Order {version} deploy at {t_(g.iso(g.at(dep)))} UTC is not related.",
        "affected": [
            {"name": "stripe", "kind": "provider",
             "impact": "Slow, and returns empty HTTP 200 responses. Its error rate stays normal."},
            {"name": "payment", "kind": "service",
             "impact": "Logs `failed to parse stripe response` and returns 502. p95 latency is over 9 s."},
            {"name": "order", "kind": "service",
             "impact": "`POST /checkout` waits for Payment, then fails with `PAYMENT_FAILED`. It releases the stock."},
            {"name": "catalog", "kind": "service", "impact": "Releases the reserved stock of each failed checkout."},
            {"name": "notification", "kind": "service", "impact": "Sends fewer emails, because fewer orders are paid."},
            {"name": "delivery", "kind": "service", "impact": "Books fewer shipments, because fewer orders are paid."},
        ],
        "signals": [
            {"source": "alert", "where": "CheckoutSuccessLow, PaymentSuccessLow",
             "what": f"CheckoutSuccessLow fires at {t_(a_co['fired_at'])} UTC and PaymentSuccessLow at "
                     f"{t_(a_pay['fired_at'])} UTC. Both are still firing.",
             "when": f"Nov 20, {t_(a_co['fired_at'])} UTC to now", "dashboard": "#changes"},
            {"source": "alert", "where": "ServiceErrorRateHigh, ServiceLatencyHigh",
             "what": "; ".join(f"{a['name']} for {a['summary'].split(' ')[0]} at {t_(a['fired_at'])} UTC"
                               for a in a_svc) + ". No ThirdPartyErrors alert fires.",
             "when": f"Nov 20, {t_(min(a['fired_at'] for a in a_svc))} UTC to now", "dashboard": "#changes"},
            {"source": "metric", "where": "third_party_latency_p95_ms{provider=stripe}",
             "what": f"Steps from about {base_sp95:.0f} ms to over 9000 ms.",
             "when": f"{hm(g, s)} to now", "dashboard": "#deps"},
            {"source": "metric", "where": "third_party_error_rate{provider=stripe}",
             "what": "Stays normal, because the empty responses are HTTP 200. This is a dead end for an agent "
                     "that checks only the Stripe error rate.",
             "when": f"{hm(g, s)} to now", "dashboard": "#deps"},
            {"source": "metric", "where": "http_error_rate and http_latency_p95_ms for payment and order",
             "what": "The error rate goes above 2% and p95 goes above 9 s in both services.",
             "when": f"{hm(g, s)} to now", "dashboard": "#services"},
            {"source": "business", "where": "checkout_success_rate",
             "what": f"Drops from about {base_succ:.0f}% to {min(succ):.0f}% to {max(succ):.0f}% per minute.",
             "when": f"{hm(g, s)} to now", "dashboard": "#business"},
            {"source": "metric", "where": "kafka_messages_in_per_min, emails_sent_per_min, carrier requests",
             "what": "`order.created`, `payment.succeeded`, `order.paid`, emails and carrier bookings all drop by the "
                     "same count of failed checkouts. These are symptoms, not causes.",
             "when": f"{hm(g, s)} to now", "dashboard": "#deps"},
            {"source": "log", "where": "failed to parse stripe response",
             "what": "A new Payment error with `error: unexpected end of JSON input` and `stripe_latency_ms` of 5 to "
                     "10 s. Order logs `checkout failed: payment error` with `upstream_status=502`. The log does not "
                     "say that the body is empty: the trace shows it.",
             "when": f"{hm(g, s)} to now", "dashboard": "#logs"},
            {"source": "trace", "where": "POST /checkout",
             "what": f"The `stripe POST /v1/payment_intents` span takes {min(empties) / 1000:.1f} to "
                     f"{max(empties) / 1000:.1f} s and returns 200 with `body_bytes=0`. Then `parse stripe response` "
                     "fails. The Order spans are fast.",
             "when": hm(g, s), "dashboard": f"#traces/{first_fail['trace']}"},
            {"source": "order", "where": first_fail["oid"],
             "what": "The timeline shows stock reserved, the payment failure, and `PAYMENT_FAILED`.",
             "when": hm(g, s), "dashboard": f"#orders/{first_fail['oid']}"},
            {"source": "log", "where": "unknown field gift_note in checkout request",
             "what": f"A dead end. A new Order warning from {version} ({gift_warns} lines). It is harmless: the "
                     "request still goes on, and it does not match the failed checkouts.",
             "when": f"{hm(g, dep + 2)} to now", "dashboard": "#logs"},
            {"source": "event", "where": f"Order {version} deploy",
             "what": f"A dead end. The rollout ends at {deploy_done:%H:%M:%S} UTC, and Order is normal on the new "
                     f"version until {t_(g.iso(g.at(s)))} UTC. The time is spent in the Payment to Stripe call, the "
                     "new error is in Payment (not deployed), and `GET /orders/:id` stays normal.",
             "when": hm(g, dep), "dashboard": "#changes"},
        ],
        "expected": {
            "root_cause": f"Stripe is degraded from {t_(g.iso(g.at(s)))} UTC: `POST /v1/payment_intents` is slow "
                          "(p95 over 9 s) and returns HTTP 200 with an empty body. Payment cannot parse it and returns "
                          f"502, so Order fails the checkout. The Order {version} deploy is not the cause.",
            "impact": f"About {pct_fail}% of checkouts fail ({total_fail} of {total_att} from "
                      f"{t_(g.iso(g.at(s)))} to {t_(g.iso(g.at(N)))} UTC). Customers wait 5 to 10 s and see an error. "
                      "No one is charged, because Stripe makes no payment intent. Paid orders, emails and carrier "
                      "bookings drop by the same count. Browse, login and cart work. The fault is still active.",
            "next_steps": "Check the Stripe status page and open a ticket with Stripe. Do not roll back Order. "
                          "Watch checkout success until Stripe recovers. Later, make Payment treat an empty body as a "
                          "fast, clear error, and alert on Stripe latency and parse errors.",
        },
    }


def stock_fail(g, t0, blocking_pid, traced):
    """One checkout that fails because the stock row is locked. The stock UPDATE waits for the row lock and
    hits the 2 s statement timeout. Catalog returns 503, and Order fails the checkout before payment.
    traced=False writes only the log lines (most requests are not sampled)."""
    R = g.R
    oid = g.order_id()
    items = R.randint(1, 4)
    err = "canceling statement due to statement timeout"
    sql = "UPDATE stock SET reserved = reserved + $1 WHERE sku = $2 AND warehouse_id = $3"
    if not traced:
        g.log(g.ms(t0, 1006), "catalog", "warn", "lock wait", db="catalog", wait_event="Lock:transactionid",
              waited_ms=1000, query=sql)
        g.log(g.ms(t0, 2004), "catalog", "error", "stock reserve failed", order_id=oid, items=items, error=err,
              status=503)
        g.log(g.ms(t0, 2011), "order", "error", "checkout failed: stock reservation failed", order_id=oid,
              status="CHECKOUT_FAILED", upstream="catalog", upstream_status=503)
        return None
    tid, spans, tl = g.hexid(32), [], []
    uid = g.user_id()
    amount = round(R.uniform(12, 240), 2)
    gw = g.span(spans, tid, None, "gateway", "POST /checkout", t0, http_status=503)
    o0 = g.ms(t0, R.uniform(0.4, 1.5))
    o = g.span(spans, tid, gw, "order", "POST /checkout", o0, http_status=503, order_id=oid, user_id=uid)
    cur = g.run_steps(spans, tid, o, "order", [("pg INSERT orders", "client", 4.5, {"db": "orders"})], o0)
    tl.append((g.ms(o0, cur), "order", "order created (status NEW)", tid))
    c0 = g.ms(o0, cur)
    cs = g.span(spans, tid, o, "catalog", "POST /stock/reserve", c0, http_status=503, order_id=oid, items=items)
    cs["status"] = o["status"] = gw["status"] = "error"
    cs["attrs"]["error"] = err
    o["attrs"]["error"] = "catalog returned 503"
    cs["duration_ms"] = g.run_steps(spans, tid, cs, "catalog", [
        ("pg UPDATE stock", "client", 2000.0,
         {"db": "catalog", "_exact": True, "_status": "error", "error": err, "wait_event": "Lock:transactionid",
          "blocking_pid": blocking_pid})],
        c0) + R.uniform(1, 3)
    # The blocking pid is only on the traced span (the tracer reads pg_blocking_pids), not in the log.
    g.log(g.ms(c0, 1001), "catalog", "warn", "lock wait", cs, db="catalog", wait_event="Lock:transactionid",
          waited_ms=1000, query=sql)
    g.log(g.end(cs), "catalog", "error", "stock reserve failed", cs, order_id=oid, items=items, error=err, status=503)
    tl.append((g.end(cs), "catalog", "stock reserve failed (HTTP 503): statement timeout", tid))
    cur += cs["duration_ms"] + 0.5
    cur += g.run_steps(spans, tid, o, "order", [("pg UPDATE orders", "client", 4, {"db": "orders"})], g.ms(o0, cur))
    o["duration_ms"] = cur + R.uniform(1, 3)
    g.log(g.end(o), "order", "error", "checkout failed: stock reservation failed", o, order_id=oid,
          status="CHECKOUT_FAILED", upstream="catalog", upstream_status=503)
    tl.append((g.end(o), "order", "status CHECKOUT_FAILED", tid))
    gw["duration_ms"] = o["duration_ms"] + R.uniform(0.8, 3)
    g.access_log(gw)
    g.TRACES.append(spans)
    g.finish_order(oid, uid, t0, amount, items, "CHECKOUT_FAILED", tl)
    return {"oid": oid, "trace": tid, "t0": t0}


@item(id="invalid_stock_index", title="An invalid stock index turns a restock into a checkout outage",
      when="06:41 UTC (cause) to now; checkout fails from 11:15 UTC",
      looks_like="The warehouse restock job, the newsletter spike, the cart deploy, or slow Catalog GC",
      example="CheckoutSuccessLow fires. Order logs 'checkout failed: stock reservation failed'. Payment and "
              "Stripe are healthy. Catalog looks healthy at service level.",
      truth="At 06:41 the catalog_migrations job runs migration 0142. It drops index stock_sku_idx, and the "
            "CREATE INDEX CONCURRENTLY of stock_sku_warehouse_idx fails with a lock timeout, so the new index is "
            "INVALID and is not used. The job reports success with a warning. From then on, each UPDATE stock by "
            "sku has no usable index (about 70 ms, not 3 ms). Nothing alerts. The hourly warehouse_stock_sync job "
            "updates stock rows in one transaction: before 06:41 it took seconds, now it takes about 1 to 2 "
            "minutes. At 11:15 it also applies the Black Friday restock (about 41k rows), which now takes about "
            "50 minutes. It holds row locks on each row it updated. Checkout stock reservations wait for those "
            "locks, time out after 2 s, and Catalog returns 503. Order fails the checkout before payment. The "
            "share of failed checkouts grows as the job locks more rows. The fault is still active.")
def invalid_stock_index(g, c):
    R = g.R
    N, brk, rs = g.MINUTES, idx(6, 41), idx(11, 15)
    HOT_ROWS = 48_000                     # stock rows that checkouts reserve (popular SKUs in all warehouses)
    ok_row_ms, bad_row_ms, reserve_ms = 3.2, 70.0, 70.0
    TIMEOUT_S = 2.05
    sql = "UPDATE stock SET reserved = reserved + $1 WHERE sku = $2 AND warehouse_id = $3"
    sync_sql = "UPDATE stock SET qty = $1 WHERE sku = $2 AND warehouse_id = $3"
    restock_file = "bf_restock_2026-11-20.csv"

    # ---- the migration (the root cause). It is a cron job, so it is not in the changes list.
    # The migration tool logs each step at info level, also a failed one.
    mig = "0142_stock_sku_warehouse_idx"
    t = g.at(brk, 3.4)
    g.log(t, "cron", "info", "migration started", job="catalog_migrations", migration=mig, db="catalog")
    g.log(g.ms(t, 1800), "cron", "info", "migration step", job="catalog_migrations", migration=mig,
          step="DROP INDEX CONCURRENTLY stock_sku_idx", result="ok")
    g.log(g.ms(t, 31_900), "cron", "info", "migration step", job="catalog_migrations", migration=mig,
          step="CREATE INDEX CONCURRENTLY stock_sku_warehouse_idx ON stock (sku, warehouse_id)", result="error",
          error="canceling statement due to lock timeout", index_valid=False)
    g.log(g.ms(t, 32_400), "cron", "info", "migration finished", job="catalog_migrations", migration=mig,
          status="completed_with_warnings", warnings=1, duration_s=32)

    # ---- the hourly warehouse stock sync. One transaction per run: rows stay locked until the commit.
    runs = []
    for h in range(24):
        r = (h * 60 + 15) % N
        rows = round(1500 * g.LOAD[r] * R.uniform(0.9, 1.1))
        restock = R.randint(40_500, 41_800) if r == rs else 0
        total = rows + restock
        row_ms = (bad_row_ms if r >= brk else ok_row_ms) * R.uniform(0.95, 1.05)
        t0s = r * 60 + R.uniform(0.5, 2.0)
        dur = total * row_ms / 1000
        pid = R.randint(3000, 9800)
        runs.append({"r": r, "rows": total, "row_ms": row_ms, "t0s": t0s, "dur": dur, "end": t0s + dur, "pid": pid})
        g.log(g.at(0, t0s), "cron", "info", "warehouse stock sync started", job="warehouse_stock_sync",
              rows=total, source=f"warehouse_api + {restock_file}" if restock else "warehouse_api", pg_pid=pid,
              transaction="single")
        # The job logs its start, its end with the run time, and, for a long run, progress every 5 minutes.
        # The run times show when the job became slow (06:41).
        if t0s + dur < N * 60:
            g.log(g.at(0, t0s + dur), "cron", "info", "warehouse stock sync finished", job="warehouse_stock_sync",
                  rows=total, duration_s=round(dur, 1), pg_pid=pid, status="committed")
        else:
            for k in range(5, int((N * 60 - t0s) // 60) + 1, 5):
                done = min(total, round(k * 60_000 / row_ms))
                g.log(g.at(0, t0s + k * 60), "cron", "info", "warehouse stock sync progress",
                      job="warehouse_stock_sync", rows_done=done, rows_total=total, pg_pid=pid)
    big = next(x for x in runs if x["r"] == rs)
    last_ok = max((x for x in runs if x["r"] < brk), key=lambda x: x["r"])
    first_bad = min((x for x in runs if x["r"] >= brk), key=lambda x: x["r"])

    # For each minute after the break: the run that holds locks, the seconds in which a reservation can wait
    # and time out before that run commits, and the share of hot rows that it has locked.
    hold = {}
    for x in runs:
        if x["r"] < brk:
            continue
        for i in range(x["r"], min(N, int(x["end"] // 60) + 1)):
            lo, hi = max(i * 60, x["t0s"]), min((i + 1) * 60, x["end"])
            if hi <= lo:
                continue
            mid = min(x["end"], i * 60 + 30) - x["t0s"]
            hold[i] = {"run": x, "lo": lo, "hi": hi, "rows": (hi - lo) * 1000 / x["row_ms"],
                       "fail_lo": lo, "fail_hi": min((i + 1) * 60 - TIMEOUT_S, x["end"] - TIMEOUT_S),
                       "p": min(0.95, max(0.0, mid) * 1000 / x["row_ms"] / HOT_ROWS)}

    # ---- metrics: one count of failed checkouts per minute, used everywhere
    attempts = c.base("checkout_attempts_per_min")
    ok = c.base("kafka_messages_in_per_min", topic="order.created")  # paid checkouts per minute
    base_sf = c.base("catalog_stock_reserve_failures_per_min")
    pay_ok = c.base("payment_success_rate")
    rps = {sv: c.base("http_requests_per_second", service=sv) for sv in ("order", "catalog", "gateway", "payment")}
    fails = [0] * N
    for i in range(brk, N):
        L = g.LOAD[i]
        h = hold.get(i)
        q95 = c.base("pg_query_p95_ms", db="catalog")[i]
        c.add("pg_query_p95_ms", {"db": "catalog"}, i, g.jit(78 * (0.9 + 0.2 * L), 0.08) - q95)
        c.add("pg_slow_queries_per_min", {"db": "catalog"}, i, attempts[i] + (round(h["rows"]) if h else 0))
        c.add("http_latency_p95_ms", {"service": "order"}, i, g.jit(reserve_ms, 0.15))
        if not h or h["fail_hi"] <= h["fail_lo"]:
            continue
        frac = (h["fail_hi"] - h["fail_lo"]) / 60
        fail = g.binom(ok[i], h["p"] * frac)
        fails[i] = fail
        if not fail:
            continue

        def cut(name, n, **lab):
            c.add(name, lab, i, -min(n, c.cur(name, **lab)[i]))

        c.add("checkout_success_rate", {}, i, -100 * fail / attempts[i])
        c.add("catalog_stock_reserve_failures_per_min", {}, i, fail)
        tries = attempts[i] - base_sf[i]              # payment attempts without the incident
        bad = (100 - pay_ok[i]) * tries / 100         # declines and errors stay the same
        c.add("payment_success_rate", {}, i, (100 - 100 * bad / (tries - fail) if tries > fail else 100) - pay_ok[i])
        for topic in ("order.created", "payment.succeeded", "order.paid", "delivery.updated"):
            cut("kafka_messages_in_per_min", fail, topic=topic)
        cut("webhooks_received_per_min", fail, provider="stripe")
        cut("third_party_requests_per_min", fail, provider="stripe")
        cut("third_party_requests_per_min", fail, provider="carrier")
        cut("third_party_requests_per_min", 2 * fail, provider="email")
        cut("emails_sent_per_min", 2 * fail)
        pend = c.base("orders_pending")[i]
        c.add("orders_pending", {}, i, round(pend * (ok[i] - fail) / ok[i]) - pend if ok[i] else 0)
        # No POST /payments and no Stripe webhook for a failed checkout. The webhook also goes through Gateway.
        c.add("http_requests_per_second", {"service": "payment"}, i, -2 * fail / 60)
        c.add("http_requests_per_second", {"service": "gateway"}, i, -fail / 60)
        for sv in ("order", "catalog", "gateway"):
            c.add("http_error_rate", {"service": sv}, i, 100 * fail / (c.cur("http_requests_per_second", service=sv)[i] * 60))
        for sv, p95_at, p99_at in (("order", 0.05, 0.01), ("catalog", 1.0, 0.01)):
            share = fail / (rps[sv][i] * 60)
            if share > p95_at:
                c.add("http_latency_p95_ms", {"service": sv}, i,
                      g.jit(2080, 0.02) - c.cur("http_latency_p95_ms", service=sv)[i])
            if share > p99_at:
                c.add("http_latency_p99_ms", {"service": sv}, i,
                      max(0, g.jit(2150, 0.02) - c.cur("http_latency_p99_ms", service=sv)[i]))
            p95, p99 = c.cur("http_latency_p95_ms", service=sv)[i], c.cur("http_latency_p99_ms", service=sv)[i]
            if p99 < p95 * 1.02:  # the same requests: p99 is never below p95
                c.add("http_latency_p99_ms", {"service": sv}, i, p95 * g.R.uniform(1.02, 1.05) - p99)

    # Each Stripe webhook publishes payment.succeeded within a second, and Order then publishes order.paid.
    # The incident removes the same checkouts from webhooks and events, so the running gap between them must
    # stay as in the baseline. Add a webhook only where a cut at zero made the gap smaller.
    gap = 0
    for i in range(N):
        def diff(get):
            return get("webhooks_received_per_min", provider="stripe")[i] - max(
                get("kafka_messages_in_per_min", topic=t)[i] for t in ("payment.succeeded", "order.paid"))
        gap += diff(c.cur) - diff(c.base)
        if gap < 0:
            c.add("webhooks_received_per_min", {"provider": "stripe"}, i, -gap)
            gap = 0

    # ---- alerts (the real rules)
    c.fire_for("CheckoutSuccessLow", "critical", "checkout_success_rate", {}, lambda v: v < 90, 10,
               "checkout_success_rate {v:.1f}% < 90% for 10m")
    for sv in ("order", "catalog", "gateway"):
        c.fire_for("ServiceErrorRateHigh", "serious", "http_error_rate", {"service": sv}, lambda v: v > 2, 5,
                   f"http_error_rate{{{{service={sv}}}}} {{v:.1f}}% > 2% for 5m")
    for sv in ("order", "catalog"):
        normal = sorted(c.base("http_latency_p95_ms", service=sv))[N // 2]
        c.fire_for("ServiceLatencyHigh", "warning", "http_latency_p95_ms", {"service": sv},
                   lambda v, n=normal: v > 2 * n, 10,
                   f"http_latency_p95_ms{{{{service={sv}}}}} {{v:.0f}} ms > 2x normal ({normal:.0f} ms) for 10m")

    # No slow query logs: Postgres logs only queries over 250 ms, and each stock update takes about 70 ms.
    # The slowdown shows only in the Catalog DB metrics and in the span times.

    # ---- the failed checkouts. One record for each counted failure: a few have a full trace and an order
    # timeline, the rest have only their log lines. Each one waits on the run that holds the locks.
    recs = [(i, R.uniform(hold[i]["fail_lo"], hold[i]["fail_hi"])) for i in range(brk, N) for _ in range(fails[i])]
    early = [k for k, (i, _) in enumerate(recs) if i < rs]
    late = [k for k, (i, _) in enumerate(recs) if i >= rs and i < N - 1]
    traced = set(early[:3]) | set(R.sample(late, min(16, len(late))))
    failed = []
    for k, (i, s) in enumerate(recs):
        o = stock_fail(g, g.at(0, s), hold[i]["run"]["pid"], k in traced)
        if o:
            failed.append((i, o))

    # ---- the paid checkouts. Baseline sample orders after the break have a fast stock UPDATE, so make them
    # again at the same times with the slow UPDATE. They keep the normal flow (payment, emails, shipping).
    # A baseline order keeps its payment result (a declined card stays declined).
    olds = sorted((o["created_at"], o["status"] == "PAYMENT_FAILED") for o in c.base_orders
                  if g.at(brk) <= o["created_at"] < g.at(N))
    c.drop_orders_created(brk, N)
    for t0, declined in olds:
        g.checkout(t0, decline=declined, stock_ms=reserve_ms)
    # A sampled Stripe webhook must not land in a minute where the webhook count is 0.
    for o in g.ORDERS:
        for e in o["timeline"]:
            if e["event"].startswith("Stripe webhook"):
                w = round((e["ts"] - g.at(0)).total_seconds()) // 60
                if 0 <= w < N and c.cur("webhooks_received_per_min", provider="stripe")[w] < 1:
                    c.add("webhooks_received_per_min", {"provider": "stripe"}, w, 1)

    # ---- info for the eval case page. All values come from the code above.
    t_ = lambda ts: ts[11:16]  # noqa: E731  'HH:MM' from an ISO time
    hhmm = lambda i: t_(g.iso(g.at(i)))  # noqa: E731
    a_co = next(a for a in c.alerts if a["name"] == "CheckoutSuccessLow")
    a_other = [a for a in c.alerts if a["name"] != "CheckoutSuccessLow"]
    succ = c.cur("checkout_success_rate")
    sf = c.cur("catalog_stock_reserve_failures_per_min")
    late_att = sum(attempts[rs:N])
    late_fails, early_fails = sum(fails[rs:N]), sum(fails[brk:rs])
    obs_sf = round(sum(sf[rs:N]))
    kpi = sum(a * s for a, s in zip(attempts[rs:N], succ[rs:N])) / late_att
    last10_sf = round(sum(sf[N - 10:N]))
    last10_att = sum(attempts[N - 10:N])
    early_min = sorted({hhmm(i) for i in range(brk, rs) if fails[i]})
    ff_m, first_fail = next((m, o) for m, o in failed if m >= rs)
    last_prog = max(k for k in range(5, int((N * 60 - big["t0s"]) // 60) + 1, 5))
    prog_rows = round(last_prog * 60_000 / big["row_ms"])
    ok_min = big["rows"] * ok_row_ms / 1000 / 60
    q_before = sorted(c.base("pg_query_p95_ms", db="catalog")[:brk])[brk // 2]
    q_after = sorted(c.cur("pg_query_p95_ms", db="catalog")[brk:rs])[(rs - brk) // 2]
    base_succ = sum(c.base("checkout_success_rate")[:brk]) / brk
    impact = (f"The sustained outage starts at {hhmm(rs)} UTC. From {hhmm(rs)} to {hhmm(N)} UTC, {obs_sf} of "
              f"{late_att} checkout attempts fail on the stock reservation ({round(100 * obs_sf / late_att)}%), of "
              f"which {late_fails} are lock timeouts from this fault (the rest is the normal rate). Checkout success over "
              f"the window is {kpi:.1f}% (it was about {base_succ:.0f}%). In the last 10 minutes {last10_sf} of "
              f"{last10_att} attempts fail on the stock reservation ({round(100 * last10_sf / last10_att)}%). The "
              "share grows while the job runs, with ups and downs from minute to minute. Customers wait about 2 s "
              "and see an error. A failed checkout never reaches Payment, so nobody is charged for it. For each "
              "failed checkout there is no paid order, two fewer emails and no carrier booking. Product pages, "
              "login and cart work.")
    if early_fails:
        impact += (f" Before the outage, {early_fails} checkout{'s' if early_fails > 1 else ''} also failed during the short hourly sync run at "
                   f"{', '.join(early_min)} UTC.")
    c.info = {
        "failure": f"From {hhmm(rs)} UTC, checkout fails more and more often: the stock reservation waits 2 s and "
                   f"fails. {obs_sf} of {late_att} checkout attempts fail on the stock reservation by {hhmm(N)} UTC, "
                   f"{round(100 * last10_sf / last10_att)}% in the last 10 minutes. Nobody is charged for them. "
                   "Product pages, login and cart work. The fault is still active.",
        "trigger": f"At {hhmm(brk)} UTC the `catalog_migrations` job runs migration `{mig}`. It drops index "
                   "`stock_sku_idx`, and `CREATE INDEX CONCURRENTLY stock_sku_warehouse_idx` fails with a lock "
                   "timeout. The new index is INVALID, so `UPDATE stock` by SKU has no usable index (most likely a "
                   "sequential scan; the data has no query plan). The job is a cron job, so it is not in the changes "
                   f"list, and it logs the failed step at info level. At {hhmm(rs)} UTC the hourly "
                   f"`warehouse_stock_sync` job applies the Black Friday restock ({big['rows']:,} rows in one "
                   "transaction). It holds a row lock on each row it updates until it commits.",
        "affected": [
            {"name": "catalog_migrations", "kind": "job",
             "impact": f"Migration `{mig}` leaves index `stock_sku_warehouse_idx` INVALID (`index_valid=false`) "
                       "and reports `completed_with_warnings`."},
            {"name": "Catalog Postgres", "kind": "database",
             "impact": f"Query p95 goes from about {q_before:.0f} ms to about {q_after:.0f} ms at {hhmm(brk)} UTC. "
                       "Slow queries on `stock` go up. Replication lag is normal."},
            {"name": "warehouse_stock_sync", "kind": "job",
             "impact": f"Each row takes about {bad_row_ms:.0f} ms, not {ok_row_ms} ms. The {hhmm(rs)} UTC run "
                       f"(`pg_pid` {big['pid']}) needs about {big['dur'] / 60:.0f} minutes (about {ok_min:.0f} "
                       f"minutes at the speed before {hhmm(brk)} UTC). Its last progress line, at "
                       f"{t_(g.iso(g.at(0, big['t0s'] + last_prog * 60)))} UTC, shows {prog_rows:,} of "
                       f"{big['rows']:,} rows. It has not finished at {hhmm(N)} UTC."},
            {"name": "catalog", "kind": "service",
             "impact": "`POST /stock/reserve` waits for row locks and returns 503 after the 2 s statement "
                       "timeout. Product pages are normal, so service-level metrics look almost normal."},
            {"name": "order", "kind": "service",
             "impact": "Fails the checkout with `CHECKOUT_FAILED` before payment. Error rate and p95 go up."},
            {"name": "payment", "kind": "service",
             "impact": "Healthy. It gets fewer payment requests and Stripe webhooks, because checkouts fail "
                       "before payment."},
            {"name": "notification", "kind": "service",
             "impact": "Sends two fewer emails for each failed checkout."},
            {"name": "delivery", "kind": "service", "impact": "Books one fewer shipment for each failed checkout."},
        ],
        "signals": [
            {"source": "alert", "where": "CheckoutSuccessLow",
             "what": f"The critical alert fires at {t_(a_co['fired_at'])} UTC and is still firing.",
             "when": f"Nov 20, {t_(a_co['fired_at'])} UTC to now", "dashboard": "#changes"},
            {"source": "alert", "where": "Other alerts from this fault",
             "what": "; ".join(f"{a['name']} ({a['summary'].split(' ')[0]}) at {t_(a['fired_at'])} UTC"
                               for a in a_other) + ". No Payment, Stripe or Postgres alert fires.",
             "when": f"Nov 20, {hhmm(rs)} UTC to now", "dashboard": "#changes"},
            {"source": "log", "where": "checkout failed: stock reservation failed",
             "what": "Order logs this error with `upstream=catalog` and `upstream_status=503`. Catalog logs "
                     "`stock reserve failed` with `canceling statement due to statement timeout`, one for each "
                     "lock timeout from this fault (the metric also counts the few normal stock failures).",
             "when": f"{hm(g, rs)} to now", "dashboard": "#logs"},
            {"source": "trace", "where": "POST /checkout",
             "what": "The `pg UPDATE stock` span in Catalog takes 2000 ms with `wait_event=Lock:transactionid` and "
                     f"`blocking_pid={big['pid']}`, and fails. Order stops before payment. Only the trace has the "
                     "blocking pid.",
             "when": hm(g, ff_m), "dashboard": f"#traces/{first_fail['trace']}"},
            {"source": "order", "where": first_fail["oid"],
             "what": "The timeline shows the stock reserve failure and `CHECKOUT_FAILED`. There is no payment.",
             "when": hm(g, ff_m), "dashboard": f"#orders/{first_fail['oid']}"},
            {"source": "log", "where": "lock wait",
             "what": f"Catalog logs `lock wait` (no pid). The failed span has `blocking_pid={big['pid']}`, and the "
                     f"`warehouse_stock_sync` start line at {hhmm(rs)} UTC has the same `pg_pid` and "
                     "`transaction=single`.",
             "when": f"{hm(g, rs)} to now", "dashboard": "#logs"},
            {"source": "log", "where": "job=warehouse_stock_sync",
             "what": "Each run logs its start (rows, `pg_pid`, `transaction=single`) and its end (`duration_s`). "
                     f"The {hhmm(last_ok['r'])} UTC run takes {last_ok['dur']:.1f} s for {last_ok['rows']} rows, the "
                     f"{hhmm(first_bad['r'])} UTC run takes {first_bad['dur']:.0f} s for {first_bad['rows']} rows. "
                     f"The {hhmm(rs)} UTC run has {big['rows']:,} rows "
                     "and logs progress every 5 minutes (about 14 rows/s). It has not finished. Busy routine cron "
                     "jobs (for example `stock_hold_expiry` every minute) fill a wide cron search.",
             "when": "Nov 19, 12:15 UTC to now", "dashboard": "#logs"},
            {"source": "trace", "where": "pg UPDATE stock span",
             "what": f"In checkout traces the `pg UPDATE stock` span takes about {reserve_ms:.0f} ms from "
                     f"{hhmm(brk)} UTC (a few ms before). Postgres logs only queries over 250 ms, so there are no "
                     "slow query logs for these updates. The data has no plan: the agent must link the time to the "
                     "migration.",
             "when": f"{hm(g, brk)} to now", "dashboard": "#logs"},
            {"source": "metric", "where": "pg_query_p95_ms{db=catalog}, pg_slow_queries_per_min{db=catalog}",
             "what": f"Query p95 steps from about {q_before:.0f} ms to about {q_after:.0f} ms at {hhmm(brk)} UTC. "
                     "Slow queries go from near 0 to about one for each checkout, and much higher during sync runs.",
             "when": f"{hm(g, brk)} to now", "dashboard": "#deps"},
            {"source": "log", "where": "job=catalog_migrations",
             "what": f"The root cause. At {hhmm(brk)} UTC, `migration step` with `result=error` for `CREATE INDEX "
                     "CONCURRENTLY stock_sku_warehouse_idx` and `index_valid=false`, after the `DROP INDEX "
                     "stock_sku_idx` step. The job then logs `completed_with_warnings`. All lines are at info "
                     "level, among many routine cron lines.",
             "when": hm(g, brk), "dashboard": "#logs"},
            {"source": "business", "where": "checkout_success_rate",
             "what": f"About {base_succ:.0f}% before. From {hhmm(rs)} UTC it falls, to {min(succ[rs:N]):.0f}% in "
                     "the worst minute. Stripe and Payment health stay normal; the payment success KPI has short dips in some minutes.",
             "when": f"{hm(g, rs)} to now", "dashboard": "#business"},
            {"source": "event", "where": "Changes",
             "what": "A dead end. No catalog change since the v1.8.2 deploy on Nov 19. The last change is the cart "
                     "v2.1.0 deploy (Redis client) at 09:40 UTC, and cart is healthy.",
             "when": f"{hm(g, brk)} to now", "dashboard": "#changes"},
            {"source": "log", "where": "Other cron jobs",
             "what": "Dead ends. The orders migration `0087_orders_add_gift_note` at 03:10 UTC works "
                     "(`index_valid=true`). The catalog stats refresh finishes at 06:30 UTC, 11 minutes before "
                     "the step. The routine jobs run all day.",
             "when": "Nov 20, 03:10 and 06:30 UTC", "dashboard": "#logs"},
            {"source": "metric", "where": "Newsletter traffic, Catalog GC pauses",
             "what": "Dead ends. The newsletter spike ends at 10:30 UTC, 45 minutes before the failures. Its "
                     "Catalog requests are reads on the replica. GC pauses are 1 minute every 40 minutes and touch "
                     "product pages.",
             "when": "Nov 20, 10:00 to 12:00 UTC", "dashboard": "#services"},
        ],
        "expected": {
            "root_cause": f"Migration `{mig}` (cron job `catalog_migrations`, {hhmm(brk)} UTC) dropped "
                          "`stock_sku_idx`, and its `CREATE INDEX CONCURRENTLY` failed with a lock timeout, so "
                          "`stock_sku_warehouse_idx` is INVALID. `UPDATE stock` by SKU has no usable index and takes "
                          "about 70 ms. The hourly `warehouse_stock_sync` job runs in one transaction. At "
                          f"{hhmm(rs)} UTC it starts the Black Friday restock ({big['rows']:,} rows, `pg_pid` "
                          f"{big['pid']}), which now needs about {big['dur'] / 60:.0f} minutes (an estimate from the "
                          "progress rate) and holds row locks. "
                          "Checkout stock reservations wait for the locks (`blocking_pid` on the span = the sync "
                          "`pg_pid`) and "
                          "time out after 2 s, so Catalog returns 503 and Order fails the checkout. The restock is "
                          "only the load that exposes the broken index.",
            "impact": impact,
            "next_steps": f"Now: stop the running `warehouse_stock_sync` job and end its transaction (`pg_pid` "
                          f"{big['pid']}, for example `pg_terminate_backend({big['pid']})`; `pg_cancel_backend` cancels "
                          "only the current statement, so check that the transaction rolled back). Check that the "
                          "locks are released, the lock waits stop and checkout success recovers. Then drop the INVALID index, run `CREATE INDEX "
                          "CONCURRENTLY` on `stock (sku, warehouse_id)` again, and check that it is valid and that "
                          "stock updates are fast again. Then run the restock again. Later: make the migration job "
                          "fail on errors, alert on invalid indexes, and commit the sync in small batches. Do not "
                          "roll back cart, and do not treat the newsletter as the cause.",
        },
    }


# ---------------------------------------------------------------- shared helpers for the next incidents
def minute_of(g, t):
    """Minute index of a datetime."""
    return int((t - g.at(0)).total_seconds() // 60)


def cut(c, name, i, n, **lab):
    """Take n from a count metric at minute i, but not below zero."""
    c.add(name, lab, i, -min(n, c.cur(name, **lab)[i]))


def offsets_logs(g, c, group, i0):
    """Replace the 'kafka offsets committed' lines of a consumer group from minute i0 with the new lag values."""
    c.drop.append({"service": group, "msg": "kafka offsets committed", "from": g.iso(g.at(i0)), "to": g.iso(g.END)})
    lag = c.cur("kafka_consumer_lag", group=group)
    for i in range(i0 + (-i0) % 10, c.N, 10):
        g.log(g.at(i, g.R.uniform(1, 9)), group, "info", "kafka offsets committed", group=group, lag=round(lag[i]))


def lost_checkouts(g, c, i, lost):
    """Remove `lost` checkout attempts at minute i (customers who never start a checkout) from every count."""
    att = c.cur("checkout_attempts_per_min")[i]
    ok = c.cur("kafka_messages_in_per_min", topic="order.created")[i]
    lo = round(lost * ok / att) if att else 0                   # of them, the ones that would have been paid
    cut(c, "checkout_attempts_per_min", i, lost)
    for topic in ("order.created", "payment.succeeded", "order.paid", "delivery.updated"):
        cut(c, "kafka_messages_in_per_min", i, lo, topic=topic)
    cut(c, "third_party_requests_per_min", i, lost, provider="stripe")
    cut(c, "webhooks_received_per_min", i, lo, provider="stripe")
    cut(c, "third_party_requests_per_min", i, lo, provider="carrier")
    cut(c, "third_party_requests_per_min", i, 2 * lo, provider="email")
    cut(c, "emails_sent_per_min", i, 2 * lo)
    pend = c.cur("orders_pending")[i]
    c.add("orders_pending", {}, i, round(pend * (ok - lo) / ok) - pend if ok else 0)
    c.add("http_requests_per_second", {"service": "order"}, i, -lost / 60)
    c.add("http_requests_per_second", {"service": "payment"}, i, -(lost + lo) / 60)
    c.add("http_requests_per_second", {"service": "gateway"}, i, -(lost + lo) / 60)
    return lo


# ---------------------------------------------------------------- order.paid schema v2 stops Delivery
@item(id="order_paid_schema_v2", title="An Order deploy stops the Delivery consumer",
      when="10:48 UTC (deploy) to now; KafkaLagHigh from about 11:30 UTC",
      looks_like="A carrier outage, the Notification memory leak, the deleted-user DLQ messages, or a stuck pod",
      example="KafkaLagHigh fires for group delivery. Checkout, payment and emails are normal. Delivery logs "
              "'failed to process message, will retry' for the same order.paid offset again and again.",
      truth="At 10:48 the Order v3.4.0 deploy starts to publish order.paid with schema version 2: "
            "shipping_address is now an object (for pickup points), not a string. The Delivery consumer cannot "
            "parse it. It retries the same offset forever and has no DLQ for parse errors, so it books no "
            "shipment for any order paid after the deploy. Lag for group delivery grows with each paid order. "
            "Checkout, payment and the order emails are normal, because Notification reads only the order ID. "
            "The fault is still active. Roll back Order (or deploy a Delivery consumer that reads v2), then "
            "process the backlog. Do not skip the messages, or the orders never ship.")
def order_paid_schema_v2(g, c):
    R = g.R
    N, dep = g.MINUTES, idx(10, 48)
    old_v, new_v = "v3.3.2", "v3.4.0"
    topic, group = "order.paid", "delivery"
    err = "json: cannot unmarshal object into Go struct field OrderPaid.shipping_address of type string"

    # ---- the deploy (the trigger): change event, rolling restart logs, a short CPU bump like a baseline deploy
    c.event("deploy", dep, "order", "Structured shipping address for pickup points", by="ci-bot",
            version=new_v, previous=old_v, commit=g.hexid(7))
    ready = []
    for pod in range(g.SERVICES["order"]["pods"]):
        pt = g.at(dep, 5 + 40 * pod)
        g.log(pt, "order", "info", "SIGTERM received, draining connections", pod=f"order-{g.hexid(5)}", version=old_v)
        g.log(g.ms(pt, 3000), "order", "info", f"starting order {new_v}", pod=f"order-{g.hexid(5)}", version=new_v)
        g.log(g.ms(pt, 6000), "order", "info", "ready, listening on :8080", version=new_v)
        ready.append(g.ms(pt, 6000))
    p95o = c.base("http_latency_p95_ms", service="order")
    for k in range(3):
        c.add("cpu_pct", {"service": "order"}, dep + k, 8)
        c.add("http_latency_p95_ms", {"service": "order"}, dep + k, p95o[dep + k] * 0.15)

    # ---- sample orders. Orders that start after the first new pod is ready get a v2 order.paid event.
    # Delivery never consumes it: no carrier booking, no delivery.updated. Payment and emails stay normal.
    def checkout_v2(t0, declined):
        n_tr, n_log = len(g.TRACES), len(g.LOGS)
        g.checkout(t0, decline=declined)
        if declined:
            return None
        o = g.ORDERS[-1]
        o["timeline"] = [e for e in o["timeline"] if e["service"] != "delivery"]
        o["status"] = "PAID"
        for sp in g.TRACES[n_tr:]:
            sp[:] = [x for x in sp if x["service"] != "delivery"]
            for x in sp:
                if x["name"] == f"kafka publish {topic}":
                    x["attrs"]["schema_version"] = 2
        g.LOGS[n_log:] = [e for e in g.LOGS[n_log:] if e["service"] != "delivery"]
        pub = next(e["ts"] for e in o["timeline"] if e["event"] == f"event published: {topic}")
        return {"oid": o["order_id"], "pub": pub,
                "trace": next(e["trace_id"] for e in o["timeline"] if e["event"] == "status PAID")}

    olds = sorted((o["created_at"], o["status"] == "PAYMENT_FAILED") for o in c.base_orders
                  if g.at(dep) <= o["created_at"] < g.END)
    c.drop_orders_created(dep, N)
    v2_from = g.ms(ready[0], 1000)
    for t0, declined in olds:
        if t0 < v2_from:
            g.checkout(t0, decline=declined)
    first = checkout_v2(g.ms(ready[0], R.uniform(2000, 6000)), False)   # the first v2 event: the consumer stops here
    stuck = [first]
    for t0, declined in olds:
        if t0 >= v2_from:
            o = checkout_v2(t0, declined)
            if o:
                stuck.append(o)
    t1 = first["pub"]
    s = minute_of(g, t1) + 1                   # first full minute with no Delivery progress
    off0 = R.randint(1_840_000, 1_880_000)     # offset of the first v2 event

    # ---- metrics: Delivery consumes nothing from s. Lag = all order.paid events since then.
    paid = c.base("kafka_messages_in_per_min", topic=topic)
    backlog = 0
    for i in range(s, N):
        backlog += paid[i]
        c.add("kafka_consumer_lag", {"group": group}, i, backlog)
        lab = {"provider": "carrier"}
        n0 = c.cur("third_party_requests_per_min", **lab)[i]
        n1 = max(n0 - round(paid[i] * 1.05), g.poisson(2) + 1)        # tracking calls stay
        c.add("third_party_requests_per_min", lab, i, n1 - n0)
        c.add("third_party_error_rate", lab, i,
              g.rate(g.binom(n1, 0.004), n1) - c.cur("third_party_error_rate", **lab)[i])
        cut(c, "kafka_messages_in_per_min", i, paid[i], topic="delivery.updated")
        c.add("cpu_pct", {"service": "delivery"}, i, R.uniform(0.5, 1.5))     # the retry loop is cheap

    # ---- logs: Delivery retries the same message with backoff (1 s, 2 s, ... up to 60 s)
    t, k, wait = g.ms(t1, R.uniform(30, 300)), 1, 1.0
    while t < g.END:
        g.log(t, "delivery", "error", "failed to process message, will retry", group=group, topic=topic,
              offset=off0, order_id=first["oid"], schema_version=2, attempt=k, error=err)
        t, k, wait = g.ms(t, wait * 1000 + R.uniform(5, 60)), k + 1, min(60.0, wait * 2)
    offsets_logs(g, c, group, s)

    # ---- alert (the real rule)
    c.fire_for("KafkaLagHigh", "serious", "kafka_consumer_lag", {"group": group}, lambda v: v > 1000, 10,
               "kafka_consumer_lag{{group=delivery}} {v:.0f} > 1000 for 10m")

    # ---- info. All values come from the code above.
    a = next(x for x in c.alerts if x["name"] == "KafkaLagHigh")
    lag = c.cur("kafka_consumer_lag", group=group)
    n_paid = round(sum(paid[s:N]))
    carr_c = sum(c.cur("third_party_requests_per_min", provider="carrier")[s:N]) / (N - s)
    carr_before = sum(c.base("third_party_requests_per_min", provider="carrier")[s - 60:s]) / 60
    hhmm = lambda i: g.iso(g.at(i))[11:16]  # noqa: E731
    t1s = g.iso(t1)[11:19]
    c.info = {
        "failure": f"From {hhmm(s)} UTC, Delivery books no shipment. {n_paid} paid orders wait in the "
                   f"`{topic}` topic at {hhmm(N)} UTC (lag {round(lag[N - 1])}). Checkout, payment and the order "
                   "emails work, so customers see a paid order with no shipping. The fault is still active.",
        "trigger": f"At {hhmm(dep)} UTC the Order `{new_v}` deploy (\"Structured shipping address for pickup "
                   f"points\") starts. From {t1s} UTC the new pods publish `{topic}` with `schema_version=2`, where "
                   "`shipping_address` is an object. The Delivery consumer cannot parse it, retries the same "
                   f"offset ({off0}) forever and has no DLQ for parse errors.",
        "affected": [
            {"name": "order", "kind": "service",
             "impact": f"Deploy `{new_v}` changes the `{topic}` payload. Checkout and the order API are healthy."},
            {"name": "delivery", "kind": "service",
             "impact": f"The `{group}` consumer is stuck on offset {off0} (order `{first['oid']}`). HTTP metrics "
                       "are normal, because the consumer is not an HTTP route."},
            {"name": "carrier", "kind": "provider",
             "impact": f"Booking calls stop: about {carr_before:.0f} requests per minute in the hour before, about "
                       f"{carr_c:.0f} after (the rest are tracking calls). The carrier is healthy."},
            {"name": "notification", "kind": "service",
             "impact": "Not affected. Order confirmation emails are sent. No new `delivery.updated` events come "
                       "for these orders, so there are no shipping emails later."},
        ],
        "signals": [
            {"source": "alert", "where": "KafkaLagHigh",
             "what": f"The serious alert for group `{group}` fires at {a['fired_at'][11:16]} UTC and is still "
                     "firing.", "when": f"Nov 20, {a['fired_at'][11:16]} UTC to now", "dashboard": "#changes"},
            {"source": "metric", "where": f"kafka_consumer_lag{{group={group}}}",
             "what": f"Near 0 until {hhmm(s)} UTC, then it grows with each paid order, to {round(lag[N - 1])} at "
                     f"{hhmm(N - 1)} UTC. It never drains. The other groups are normal.",
             "when": f"{hm(g, s)} to now", "dashboard": "#deps"},
            {"source": "log", "where": "failed to process message, will retry",
             "what": f"Delivery logs this error for `offset={off0}`, `schema_version=2` and the same `order_id` "
                     f"each time, with `{err}`. The `attempt` count grows.",
             "when": f"Nov 20, {t1s} UTC to now", "dashboard": "#logs"},
            {"source": "event", "where": "Changes",
             "what": f"Order `{new_v}` deploy at {hhmm(dep)} UTC: \"Structured shipping address for pickup "
                     "points\". It is the only change near the start. The cart deploy at 09:40 UTC is not related.",
             "when": hm(g, dep), "dashboard": "#changes"},
            {"source": "metric", "where": "third_party_requests_per_min{provider=carrier}",
             "what": f"Falls from about {carr_before:.0f} to about {carr_c:.0f} per minute at {hhmm(s)} UTC. The "
                     "carrier error rate and latency are normal.", "when": f"{hm(g, s)} to now", "dashboard": "#deps"},
            {"source": "order", "where": first["oid"],
             "what": f"The first order with a v2 event. The timeline has `event published: {topic}` and the "
                     "confirmation email, with status PAID. There is no `carrier booked` step.", "when": hm(g, minute_of(g, t1)),
             "dashboard": f"#orders/{first['oid']}"},
            {"source": "trace", "where": f"kafka publish {topic}",
             "what": "The publish span has `schema_version=2`. There is no Delivery consumer span.",
             "when": hm(g, minute_of(g, t1)), "dashboard": f"#traces/{first['trace']}"},
            {"source": "business", "where": "Checkout and payment",
             "what": "Checkout and payment success rates, Stripe and email are normal. The fault does not show "
                     "in business KPIs.", "when": f"{hm(g, s)} to now", "dashboard": "#business"},
            {"source": "metric", "where": "Dead ends",
             "what": "Notification lag spikes are the known memory leak (OOMKilled, drains in minutes). The "
                     "DlqGrowing alerts are for deleted user accounts in the notification group. The carrier "
                     "errors at 01:00 UTC are the nightly maintenance window.",
             "when": "Nov 19, 12:00 to Nov 20, 12:00 UTC", "dashboard": "#deps"},
        ],
        "expected": {
            "root_cause": f"The Order `{new_v}` deploy at {hhmm(dep)} UTC changes the `{topic}` event to schema v2 "
                          "(`shipping_address` is an object). The Delivery consumer cannot parse it, retries the "
                          f"same offset ({off0}) forever, and books no shipment. Lag for group `{group}` grows.",
            "impact": f"From {hhmm(s)} UTC, no paid order gets a carrier booking: {n_paid} orders by "
                      f"{hhmm(N)} UTC, and the number grows with each paid order. "
                      "Customers are charged and get the confirmation email, but their orders do not ship and get "
                      "no tracking. Checkout, payment and emails work.",
            "next_steps": f"Roll back Order to `{old_v}` to stop new v2 events. Then deploy a Delivery consumer "
                          "that reads v2 (or a converter) so it processes the stuck messages, and check that the "
                          "lag drains and carrier bookings start again. Do not skip or delete the messages, or "
                          "the orders never ship. Later: add a DLQ for parse errors and a schema compatibility "
                          "check in CI.",
        },
    }


# ---------------------------------------------------------------- a smaller Redis rejects cart writes
@item(id="redis_maxmemory_cut", title="A smaller Redis instance rejects cart writes",
      when="08:20 UTC (resize) to now; add-to-cart fails from about 11:10 UTC",
      looks_like="The cart deploy with the new Redis client, the newsletter traffic, or the midnight KEYS job",
      example="ServiceErrorRateHigh fires for cart. Cart logs 'add to cart failed' with a Redis OOM error. "
              "Redis memory is flat. RedisMemoryHigh does not fire.",
      truth="At 08:20 infra moves the cart Redis to a smaller instance to cut cost. The new instance has "
            "maxmemory 640 MB and the policy noeviction. Cart keys live for days, so memory grows with traffic. "
            "At about 11:10 used memory reaches 640 MB and Redis rejects writes with 'OOM command not allowed'. "
            "POST /cart/items fails with 500. Reads and deletes still work. Fewer customers start a checkout. "
            "RedisMemoryHigh does not fire, because the rule uses the 2048 MB limit of the old instance. "
            "The cart v2.1.0 deploy at 09:40 (new Redis client) is not the cause. The fault is still active. "
            "Set maxmemory back to 2048 MB (or move back to the old instance size).")
def redis_maxmemory_cut(g, c):
    R = g.R
    N, cfg = g.MINUTES, idx(8, 20)
    MAX, POLICY, ADDS = 640, "noeviction", 0.42      # ADDS: share of cart requests that are POST /cart/items
    shrink = R.uniform(16, 20)                       # the copy to the new instance has no fragmentation
    old_host, new_host = "cart-redis-2g.internal:6379", "cart-redis-1g.internal:6379"
    err = "OOM command not allowed when used memory > 'maxmemory'."

    # ---- the trigger: a config change, and the cart pods reconnect to the new instance
    c.event("config", cfg, "cart", "Move cart Redis to a smaller instance to cut cost (FIN-212)", by="infra")
    for pod in range(g.SERVICES["cart"]["pods"]):
        t = g.at(cfg, R.uniform(20, 40))
        g.log(t, "cart", "warn", "redis connection lost, reconnecting", pod=f"cart-{g.hexid(5)}", host=old_host)
        g.log(g.ms(t, R.uniform(800, 2000)), "cart", "info", "redis connected", host=new_host,
              redis_version="7.2.4", maxmemory_mb=MAX, maxmemory_policy=POLICY)

    # ---- Redis memory: a small drop at the move, then growth with traffic until it reaches maxmemory
    mem = c.base("redis_memory_used_mb")
    full = None
    for i in range(cfg, N):
        v = mem[i] - shrink
        if full is None and v >= MAX - 0.5:
            full = i
        if full is not None:
            v = MAX - R.uniform(0.05, 0.6)
        c.add("redis_memory_used_mb", {}, i, v - mem[i])
    assert full is not None, "Redis never reaches maxmemory"

    # ---- failed writes: few at first (expired keys free some space), then most of them
    fails, lost = [0] * N, [0] * N
    att0 = c.base("checkout_attempts_per_min")
    for i in range(full, N):
        p = min(0.9, 0.3 + 0.07 * (i - full)) * R.uniform(0.96, 1.04)
        r = c.base("http_requests_per_second", service="cart")[i]
        f = g.binom(round(r * 60 * ADDS), p)
        fails[i] = f
        c.add("cart_errors_per_min", {}, i, f)
        c.add("http_error_rate", {"service": "cart"}, i, 100 * f / (r * 60))
        gw = c.cur("http_requests_per_second", service="gateway")[i]
        c.add("http_error_rate", {"service": "gateway"}, i, 100 * f / (gw * 60))
        lost[i] = g.binom(att0[i], 0.45 * p)      # customers who cannot fill a cart do not check out
        lost_checkouts(g, c, i, lost[i])

    # Each Stripe webhook publishes payment.succeeded within a second, and Order then publishes order.paid.
    # Keep the running gap between them as in the baseline (see invalid_stock_index).
    gap = 0
    for i in range(N):
        def diff(get):
            return get("webhooks_received_per_min", provider="stripe")[i] - max(
                get("kafka_messages_in_per_min", topic=t)[i] for t in ("payment.succeeded", "order.paid"))
        gap += diff(c.cur) - diff(c.base)
        if gap < 0:
            c.add("webhooks_received_per_min", {"provider": "stripe"}, i, -gap)
            gap = 0

    # ---- logs and traces: a sample of the failed writes (about 1 to 3 a minute)
    first_trace = None
    for i in range(full, N):
        for _ in range(min(fails[i], 1 + g.poisson(0.7))):
            sp = g.request(g.at(i, R.uniform(0, 59.5)), "POST /cart/items", "cart",
                           [("redis HSET cart", "client", 0.4, {"db": "redis", "_status": "error", "error": err})],
                           status=500, level="error", msg="add to cart failed", err=err, user_id=g.user_id(),
                           product_id=g.product_id(), qty=R.randint(1, 3))
            first_trace = first_trace or sp[0]["trace_id"]

    # ---- alerts (the real rules). RedisMemoryHigh uses 85% of the 2048 MB limit, so it stays OK.
    for sv in ("cart", "gateway"):
        c.fire_for("ServiceErrorRateHigh", "serious", "http_error_rate", {"service": sv}, lambda v: v > 2, 5,
                   f"http_error_rate{{{{service={sv}}}}} {{v:.1f}}% > 2% for 5m")

    # ---- info. All values come from the code above.
    hhmm = lambda i: g.iso(g.at(i))[11:16]  # noqa: E731
    a_cart = next(a for a in c.alerts if "service=cart" in a["summary"])
    a_gw = [a for a in c.alerts if "service=gateway" in a["summary"]]
    n_fail, n_lost = sum(fails), sum(lost)
    m_before, m_after = mem[cfg - 1], mem[cfg] - shrink
    er = c.cur("http_error_rate", service="cart")
    er_last = sum(er[N - 10:N]) / 10
    att_b = sum(att0[full:N]) / (N - full)
    att_c = sum(c.cur("checkout_attempts_per_min")[full:N]) / (N - full)
    c.info = {
        "failure": f"From {hhmm(full)} UTC, Redis rejects cart writes. {n_fail:,} add-to-cart requests fail with "
                   f"HTTP 500 by {hhmm(N)} UTC (cart error rate about {er_last:.0f}% in the last 10 minutes). "
                   f"Checkout attempts fall from about {att_b:.0f} to about {att_c:.0f} per minute. Checkout "
                   "success rate stays normal. The fault is still active.",
        "trigger": f"At {hhmm(cfg)} UTC infra moves the cart Redis to a smaller instance (\"Move cart Redis to a "
                   f"smaller instance to cut cost\"). The cart pods reconnect to `{new_host}` and log "
                   f"`maxmemory_mb={MAX}` and `maxmemory_policy={POLICY}`. Memory grows with traffic and reaches "
                   f"{MAX} MB at {hhmm(full)} UTC.",
        "affected": [
            {"name": "Redis", "kind": "database",
             "impact": f"Used memory drops from {m_before:.0f} MB to {m_after:.0f} MB at the move, then grows and "
                       f"stays flat at about {MAX} MB from {hhmm(full)} UTC. Writes fail with `{err}`. Latency is "
                       "normal."},
            {"name": "cart", "kind": "service",
             "impact": "`POST /cart/items` returns 500 for most requests. `GET /cart` and deletes work."},
            {"name": "gateway", "kind": "service", "impact": "Its error rate goes up with the cart errors."},
            {"name": "order", "kind": "service",
             "impact": f"About {n_lost} fewer checkout attempts. Checkout success rate is normal."},
        ],
        "signals": [
            {"source": "alert", "where": "ServiceErrorRateHigh",
             "what": f"Fires for cart at {a_cart['fired_at'][11:16]} UTC"
                     + (f" and for gateway at {a_gw[0]['fired_at'][11:16]} UTC" if a_gw else "")
                     + ". RedisMemoryHigh stays OK.", "when": f"{hm(g, full)} to now", "dashboard": "#changes"},
            {"source": "log", "where": "add to cart failed",
             "what": f"Cart logs this error with `{err}` on the `redis HSET cart` step.",
             "when": f"{hm(g, full)} to now", "dashboard": "#logs"},
            {"source": "trace", "where": "POST /cart/items",
             "what": "The `redis HSET cart` span fails with the OOM error in about 1 ms.",
             "when": hm(g, full), "dashboard": f"#traces/{first_trace}"},
            {"source": "metric", "where": "redis_memory_used_mb",
             "what": f"Flat at about {MAX} MB from {hhmm(full)} UTC. The metric limit shows 2048 MB, the old "
                     f"instance, so the panel looks far from full. Small drop at {hhmm(cfg)} UTC.",
             "when": f"{hm(g, cfg)} to now", "dashboard": "#deps"},
            {"source": "log", "where": "redis connected",
             "what": f"At {hhmm(cfg)} UTC each cart pod logs `redis connection lost, reconnecting` and then "
                     f"`redis connected` with `host={new_host}`, `maxmemory_mb={MAX}`, `maxmemory_policy={POLICY}`.",
             "when": hm(g, cfg), "dashboard": "#logs"},
            {"source": "event", "where": "Changes",
             "what": f"Config change at {hhmm(cfg)} UTC by infra: \"Move cart Redis to a smaller instance to cut "
                     "cost\". The cart v2.1.0 deploy at 09:40 UTC (\"Upgrade Redis client library\") is a dead "
                     "end: the errors start more than 90 minutes later and the error comes from the Redis server.",
             "when": f"{hm(g, cfg)} and Nov 20, 09:40 UTC", "dashboard": "#changes"},
            {"source": "business", "where": "checkout_attempts_per_min",
             "what": f"Falls from about {att_b:.0f} to about {att_c:.0f} per minute. Checkout and payment success "
                     "rates stay normal.", "when": f"{hm(g, full)} to now", "dashboard": "#business"},
            {"source": "metric", "where": "Dead ends",
             "what": "The newsletter spike (10:00 to 10:30 UTC) ends with no errors. The midnight KEYS job raises "
                     "Redis latency for 2 minutes with no errors. Redis latency is normal during the fault.",
             "when": "Nov 20, 00:00 to 12:00 UTC", "dashboard": "#deps"},
        ],
        "expected": {
            "root_cause": f"The cart Redis was moved to a smaller instance at {hhmm(cfg)} UTC: `maxmemory` is now "
                          f"{MAX} MB with `maxmemory-policy {POLICY}`. Memory grows with traffic and reaches the "
                          f"limit at {hhmm(full)} UTC. Redis then rejects writes with `OOM command not allowed`, so "
                          "`POST /cart/items` fails.",
            "impact": f"From {hhmm(full)} UTC, {n_fail:,} add-to-cart requests fail (most of them in the last "
                      f"minutes; about {er_last:.0f}% of all cart requests). About {n_lost} fewer checkouts start. "
                      "Customers can see and empty their cart but cannot add items. Checkout and payment for "
                      "existing carts work. The fault is still active.",
            "next_steps": "Raise `maxmemory` back to 2048 MB (or move back to the larger instance), then check "
                          "that cart writes and the error rate recover. Do not roll back the cart deploy. Later: "
                          "set a TTL policy or an eviction policy for cart keys, and make RedisMemoryHigh use the "
                          "real maxmemory.",
        },
    }


# ---------------------------------------------------------------- a marketing email job uses the email rate limit
@item(id="winback_email_quota", title="A marketing email job uses up the email rate limit",
      when="10:38 UTC (job turned on); bursts at 10:45, 11:15 and 11:45 UTC",
      looks_like="An email provider outage, the Notification memory leak, the deleted-user DLQ messages, "
                 "or the newsletter",
      example="EmailsFailing and ThirdPartyErrors (email) fire in bursts. Notification logs '429 Too Many "
              "Requests'. Order emails fail or come late, and some go to the DLQ.",
      truth="At 10:38 marketing turns on the winback_campaign job in Notification. It runs every 30 minutes "
            "(10:45, 11:15, 11:45) and sends thousands of win-back emails as fast as it can, with the same email "
            "API key as the order emails. The provider allows 600 requests per minute for the key and returns "
            "429 for the rest. In each run, most order emails fail. Notification retries each one 2 times (after "
            "about 30 s and 2 min) and then moves it to the DLQ. Between runs, emails are normal. The provider is "
            "healthy. Pause the job, move it to its own key or a send limit, and replay the DLQ messages from "
            "this fault (not the deleted-user messages).")
def winback_email_quota(g, c):
    R = g.R
    N, cfg = g.MINUTES, idx(10, 38)
    starts = [idx(10, 45), idx(11, 15), idx(11, 45)]
    sizes = [R.randint(9300, 9900), R.randint(6200, 6700), R.randint(7000, 7500)]
    QUOTA, JOB_RATE, KEY, TPL = 600, 1500, "sg_main", "bf_winback"
    err = f"429 Too Many Requests: rate limit of {QUOTA} requests/min exceeded for API key {KEY}"

    # ---- the trigger
    c.event("config", cfg, "notification", "Turn on winback_campaign job (Black Friday win-back emails)",
            by="marketing")
    g.log(g.at(cfg, 2.4), "notification", "info", "config reloaded", job="winback_campaign", enabled=True,
          schedule="15,45 * * * *", api_key=KEY, template=TPL)

    # ---- one minute at a time: order emails (new tries and retries) and the job share the key's limit
    T = c.base("third_party_requests_per_min", provider="email")      # new order emails in each minute
    r1, r2 = [0] * (N + 3), [0] * (N + 3)                             # retry 2/3 and retry 3/3 queues
    q, dlq, t_fail, f_new_l, runs = {}, [0] * N, [0] * N, [0] * N, []
    rem = 0
    for i in range(starts[0], N):
        if i in starts:
            rem = sizes[starts.index(i)]
            runs.append({"start": i, "size": rem, "throttled": 0})
        J = min(JOB_RATE, rem)
        tot = T[i] + r1[i] + r2[i] + J
        share = min(1.0, QUOTA / tot)
        q[i] = 1 - share
        ok_n, ok1, ok2 = (g.binom(n, share) for n in (T[i], r1[i], r2[i]))
        if share < 1:                                   # never more than the key limit in one minute
            ok_n, ok1, ok2 = (min(x, QUOTA) for x in (ok_n, ok1, ok2))
        okj = max(0, min(g.binom(J, share), QUOTA - ok_n - ok1 - ok2)) if share < 1 else J
        f_new, f1, f2 = T[i] - ok_n, r1[i] - ok1, r2[i] - ok2
        r1[i + 1] += f_new
        r2[i + 2] += f1
        dlq[i], t_fail[i], f_new_l[i] = f2, f_new + f1 + f2, f_new
        if J:
            rem -= okj
            run = runs[-1]
            run["throttled"] += J - okj
            if rem <= 0:
                run["end"] = i + 1
        fails = f_new + f1 + f2 + J - okj
        sent = ok_n + ok1 + ok2 + okj
        lab = {"provider": "email"}
        c.add("third_party_requests_per_min", lab, i, tot - T[i])
        c.add("third_party_error_rate", lab, i, 100 * fails / tot - c.base("third_party_error_rate", **lab)[i])
        c.add("third_party_latency_p95_ms", lab, i, -c.base("third_party_latency_p95_ms", **lab)[i] * 0.3 * q[i])
        c.add("emails_failed_per_min", {}, i, fails - c.base("emails_failed_per_min")[i])
        c.add("emails_sent_per_min", {}, i, sent - c.base("emails_sent_per_min")[i])
        waiting = r1[i + 1] + r2[i + 1] + r2[i + 2]
        if waiting:
            c.add("kafka_consumer_lag", {"group": "notification"}, i, waiting)
            p95 = c.base("notification_event_to_email_p95_s")[i]
            c.add("notification_event_to_email_p95_s", {}, i,
                  (g.jit(150, 0.06) if f_new > 0.05 * T[i] else g.jit(40, 0.15)) - p95)
    total_dlq = 0
    for i in range(starts[0], N):
        total_dlq += dlq[i]
        c.add("kafka_dlq_size", {"group": "notification"}, i, total_dlq)

    # ---- job logs
    for run in runs:
        s0, e0 = run["start"], run.get("end", N)
        g.log(g.at(s0, 0.6), "notification", "info", "winback campaign run started", job="winback_campaign",
              recipients=run["size"], api_key=KEY, template=TPL)
        for i in range(s0, min(e0, N)):
            if q[i] > 0:
                g.log(g.at(i, R.uniform(40, 59)), "notification", "warn",
                      "winback campaign throttled by email provider, backing off", job="winback_campaign",
                      api_key=KEY, status=429)
        if e0 < N:
            g.log(g.at(e0 - 1, R.uniform(30, 59)), "notification", "info", "winback campaign run finished",
                  job="winback_campaign", sent=run["size"], throttled=run["throttled"], duration_s=(e0 - s0) * 60)

    # ---- order email logs (a sample): first and second failures, and each move to the DLQ
    tpls = ["order_received", "order_confirmed", "order_confirmed", "order_shipped", "order_delivered"]
    topic_of = {"order_received": "order.created", "order_confirmed": "order.paid",
                "order_shipped": "delivery.updated", "order_delivered": "delivery.updated"}
    for i in range(starts[0], N):
        for n, msg, lvl in ((f_new_l[i], "email failed, retry 1/3", "warn"),
                            (r1[i] - (r1[i] and g.binom(r1[i], 1 - q[i])), "email failed, retry 2/3", "warn")):
            for _ in range(g.binom(n, 0.08)):
                g.log(g.at(i, R.uniform(0, 59)), "notification", lvl, msg, template=R.choice(tpls),
                      order_id=g.order_id(), error=err)
        for _ in range(dlq[i]):
            tp = R.choice(tpls)
            g.log(g.at(i, R.uniform(0, 59)), "notification", "error", "email failed 3 times, message moved to DLQ",
                  template=tp, order_id=g.order_id(), error=err, group="notification", topic=topic_of[tp])
    offsets_logs(g, c, "notification", starts[0])

    # ---- sample orders during the runs: their emails get 429 and are retried
    orig = g.email

    def email_429(spans, tid, pub, topic, template, oid, tl):
        t = g.ms(g.end(pub), R.uniform(20, 400))
        if q.get(minute_of(g, t), 0) == 0:
            return orig(spans, tid, pub, topic, template, oid, tl)
        cs = g.span(spans, tid, pub, "notification", f"kafka consume {topic}", t, kind="consumer", topic=topic)
        tk, delays = g.ms(t, R.uniform(0.4, 1.5)), [R.uniform(28_000, 32_000), R.uniform(115_000, 125_000)]
        for k in range(3):
            fail = R.random() < q.get(minute_of(g, tk), 0)
            sp = g.span(spans, tid, cs, "notification", "email POST /v3/mail/send", tk,
                        max(5, g.jit(35 if fail else 210, 0.25)), status="error" if fail else "ok", kind="client",
                        peer="email", template=template, http_status=429 if fail else 202,
                        **({"error": err} if fail else {}))
            if not fail:
                g.log(g.end(sp), "notification", "info", "email sent", cs, template=template, order_id=oid,
                      attempt=k + 1)
                tl.append((g.end(sp), "notification", f"email sent: {template}", tid))
                break
            if k < 2:
                g.log(g.end(sp), "notification", "warn", f"email failed, retry {k + 1}/3", cs, template=template,
                      order_id=oid, error=err)
                tl.append((g.end(sp), "notification", f"email failed (429), retry {k + 1}/3", tid))
                tk = g.ms(tk, delays[k])
            else:
                g.log(g.end(sp), "notification", "error", "email failed 3 times, message moved to DLQ", cs,
                      template=template, order_id=oid, error=err, group="notification", topic=topic)
                tl.append((g.end(sp), "notification", f"email moved to DLQ: {template}", tid))
        cs["duration_ms"] = (g.end(sp) - t).total_seconds() * 1000 + R.uniform(0.5, 2)

    wins = [(r["start"] - 1, min(N, r.get("end", N) + 3)) for r in runs]
    olds = sorted((o["created_at"], o["status"] == "PAYMENT_FAILED") for o in c.base_orders
                  if any(g.at(a) <= o["created_at"] < g.at(b) for a, b in wins))
    for a, b in wins:
        c.drop_orders_created(a, b)
    # older orders whose shipped or delivered email falls in a run: make them again with the same 429 logic
    inrun = lambda t: any(g.at(a) <= t < g.at(b) for a, b in wins)  # noqa: E731
    later = [o for o in c.base_orders if o["order_id"] not in c.drop_orders
             and any(e["event"].startswith("email sent") and inrun(e["ts"]) for e in o["timeline"])]
    for o in later:
        c.drop_orders.append(o["order_id"])
        c.drop_traces += [e["trace_id"] for e in o["timeline"] if e["trace_id"] and e["trace_id"] not in c.drop_traces]
    late = sorted((o["created_at"], o["status"] == "PAYMENT_FAILED") for o in later)
    n0 = len(g.ORDERS)
    g.email = email_429
    try:
        for t0, declined in olds:
            g.checkout(t0, decline=declined)
        n1 = len(g.ORDERS)
        for t0, declined in late:
            g.checkout(t0, decline=declined)
    finally:
        g.email = orig
    hit = [o for o in g.ORDERS[n0:n1] if any("(429)" in e["event"] for e in o["timeline"])]

    # ---- alerts (the real rules)
    c.fire_for("EmailsFailing", "warning", "emails_failed_per_min", {}, lambda v: v > 5, 10,
               "emails_failed_per_min {v:.0f} > 5 for 10m")
    c.fire_for("ThirdPartyErrors", "serious", "third_party_error_rate", {"provider": "email"}, lambda v: v > 5, 5,
               "third_party_error_rate{{provider=email}} {v:.0f}% > 5% for 5m")
    # The noise item dlq_deleted_users fires DlqGrowing at 11:51 and it stays open. One rule has one open alert,
    # so the last run adds no second one.
    open_dlq = idx(11, 51)
    for run in runs:
        d = [i for i in range(run["start"], min(N, run.get("end", N) + 4)) if dlq[i]]
        if d and not d[0] <= open_dlq <= d[-1] + 15:
            c.alert("DlqGrowing", "warning", d[0], d[-1] + 15, "kafka_dlq_size{group=notification} grew in 15m")

    # ---- info. All values come from the code above.
    hhmm = lambda i: g.iso(g.at(i))[11:16]  # noqa: E731
    a_ef = [a for a in c.alerts if a["name"] == "EmailsFailing"]
    a_tp = [a for a in c.alerts if a["name"] == "ThirdPartyErrors"]
    first_try_fail, n_dlq = sum(f_new_l), total_dlq
    run_txt = "; ".join(f"{hhmm(r['start'])} to {hhmm(r['end']) if 'end' in r else 'now'} UTC, "
                        f"{r['size']:,} emails" for r in runs)
    req = c.cur("third_party_requests_per_min", provider="email")
    er = c.cur("third_party_error_rate", provider="email")
    peak_req, peak_er = max(req[starts[0]:N]), max(er[starts[0]:N])
    base_req = sum(T[starts[0] - 60:starts[0]]) / 60
    ex = hit[0] if hit else None
    c.info = {
        "failure": f"In each run of the new `winback_campaign` job ({run_txt}) the email provider returns 429 for "
                   f"most sends. {first_try_fail:,} order emails fail on the first try. Most are sent later on a "
                   f"retry (30 s to 2.5 min late), {n_dlq} fail 3 times and go to the notification DLQ. Between "
                   "runs, emails are normal. Checkout and payment are normal.",
        "trigger": f"At {hhmm(cfg)} UTC marketing turns on the `winback_campaign` job in Notification (config "
                   f"change \"Turn on winback_campaign job\"). It runs at :15 and :45 and sends with the same API "
                   f"key (`{KEY}`) as the order emails, up to {JOB_RATE:,} requests per minute. The key allows "
                   f"{QUOTA} per minute.",
        "affected": [
            {"name": "winback_campaign", "kind": "job",
             "impact": f"Runs: {run_txt}. It logs `winback campaign throttled by email provider, backing off` "
                       "each minute of a run."},
            {"name": "email", "kind": "provider",
             "impact": f"Requests go from about {base_req:.0f} to up to {peak_req:,.0f} per minute, and the error "
                       f"rate up to {peak_er:.0f}% (all 429). The provider is healthy: it applies the key limit."},
            {"name": "notification", "kind": "service",
             "impact": f"Order emails fail with 429, are retried 2 times, and {n_dlq} go to the DLQ. Consumer lag "
                       "and email delay go up during each run."},
        ],
        "signals": [
            {"source": "alert", "where": "EmailsFailing",
             "what": "Fires at " + ", ".join(f"{a['fired_at'][11:16]}" for a in a_ef) + " UTC, once in each run.",
             "when": f"{hm(g, starts[0])} to now", "dashboard": "#changes"},
            {"source": "alert", "where": "ThirdPartyErrors (email), DlqGrowing",
             "what": "ThirdPartyErrors for email fires at " + ", ".join(a["fired_at"][11:16] for a in a_tp)
                     + " UTC. DlqGrowing fires in the first two runs. The open DlqGrowing alert from "
                     f"{hhmm(open_dlq)} UTC covers the last run (the deleted-user DLQ messages also fire it).",
             "when": f"{hm(g, starts[0])} to now", "dashboard": "#changes"},
            {"source": "metric", "where": "third_party_requests_per_min{provider=email}",
             "what": f"About {base_req:.0f} per minute before {hhmm(starts[0])} UTC. In each run it jumps to more "
                     f"than 1,000. The order counts (order.created, order.paid) stay normal, so the extra sends "
                     "are not order emails.", "when": f"{hm(g, starts[0])} to now", "dashboard": "#deps"},
            {"source": "metric", "where": "third_party_error_rate{provider=email}, emails_failed_per_min",
             "what": f"High only in the runs (up to {peak_er:.0f}%), near 0 between them. The bursts start at "
                     ":45 and :15.", "when": f"{hm(g, starts[0])} to now", "dashboard": "#deps"},
            {"source": "log", "where": "429 Too Many Requests",
             "what": f"Notification logs `email failed, retry n/3` and `email failed 3 times, message moved to "
                     f"DLQ` with `{err}`.", "when": f"{hm(g, starts[0])} to now", "dashboard": "#logs"},
            {"source": "log", "where": "job=winback_campaign",
             "what": f"`config reloaded` at {hhmm(cfg)} UTC (`enabled=true`, `api_key={KEY}`). Each run logs "
                     "`run started` with the recipient count, a throttle warning each minute, and `run finished`.",
             "when": f"{hm(g, cfg)} to now", "dashboard": "#logs"},
            {"source": "event", "where": "Changes",
             "what": f"Config change at {hhmm(cfg)} UTC by marketing: \"Turn on winback_campaign job\". The "
                     "Notification deploy at 03:30 UTC is a dead end: emails are normal for 7 hours after it.",
             "when": hm(g, cfg), "dashboard": "#changes"},
            *([{"source": "order", "where": ex["order_id"],
                "what": "A sample order in a run. Its timeline shows `email failed (429)` and a retry.",
                "when": hm(g, minute_of(g, ex["created_at"])), "dashboard": f"#orders/{ex['order_id']}"}]
              if ex else []),
            {"source": "metric", "where": "Dead ends",
             "what": "The deleted-user DLQ messages have a 550 error, not 429. The Notification OOM restarts drain "
                     "in a few minutes. The newsletter (10:00 to 10:30 UTC) is sent by marketing's own tool and "
                     "ends before the first run.", "when": "Nov 20, 00:00 to 12:00 UTC", "dashboard": "#deps"},
        ],
        "expected": {
            "root_cause": f"The `winback_campaign` job (turned on at {hhmm(cfg)} UTC by marketing) sends thousands "
                          f"of emails in each run with the same API key as the order emails. The provider limits "
                          f"the key to {QUOTA} requests per minute and returns 429, so order emails fail during each "
                          "run. The provider itself is healthy.",
            "impact": f"Runs: {run_txt}. {first_try_fail:,} order emails (received, confirmed, shipped, delivered) fail on the "
                      f"first try; most arrive 30 s to 2.5 min late, {n_dlq} go to the DLQ and are not sent. It "
                      "happens again every 30 minutes while the job is on. Checkout, payment and delivery work.",
            "next_steps": "Pause the `winback_campaign` job now. Then replay the DLQ messages from this fault (429 "
                          "errors, not the 550 deleted-user messages). Before it runs again, give it its own API key "
                          "or provider, or a send limit well under the key limit. Check that 429s stop at the next "
                          ":15 or :45.",
        },
    }


@item(id="auth_pool_exhaustion", title="Two session listeners exhaust the Auth canary pool",
      when="10:34 to 10:56 UTC", looks_like="Newsletter traffic or a Users Postgres outage",
      example="The gateway returns 503 on login and token refresh.",
      truth="A canary config cuts the Auth pool from 12 connections to 2. The two existing session listeners "
            "hold both connections. Interactive requests time out acquiring a connection until rollback.")
def auth_pool_exhaustion(g, c):
    start, end = idx(10, 34), idx(10, 56)
    original, reduced, listeners, timeout = 12, 2, 2, 250
    pod = "auth-canary"
    auth, gateway = {"service": "auth"}, {"service": "gateway"}
    c.event("config", start, "auth", "Apply session settings to Auth canary", rollout="canary")
    c.event("config", end, "auth", "Revert Auth canary session settings", rollout="canary")
    for minute, size in ((start, reduced), (end, original)):
        g.log(g.at(minute), "auth", "info", "users pool settings applied", pod=pod, db="users",
              max_connections=size, session_listener_connections=listeners, acquire_timeout_ms=timeout)

    routes = ("POST /auth/login", "POST /auth/refresh", "POST /auth/signup")
    rps_auth = c.base("http_requests_per_second", **auth)
    rps_gw = c.base("http_requests_per_second", **gateway)
    err_auth = c.base("http_error_rate", **auth)
    login_success = c.base("auth_login_success_rate")
    auth_p95 = c.base("http_latency_p95_ms", **auth)
    auth_p99 = c.base("http_latency_p99_ms", **auth)
    gw_p95 = c.base("http_latency_p95_ms", **gateway)
    for trace in c.base_traces:
        root = trace[0]
        if root["name"] in routes and g.at(start) <= root["start"] < g.at(end):
            c.drop_traces.append(root["trace_id"])
    first_error = None
    for i in range(start, end):
        requests = round(rps_auth[i] * 60)
        failed = round(requests * g.R.uniform(0.46, 0.51))
        share = failed / requests
        c.add("http_error_rate", auth, i, 100 * share - err_auth[i])
        c.add("http_error_rate", gateway, i, (100 * share - err_auth[i]) * rps_auth[i] / rps_gw[i])
        c.add("auth_login_success_rate", {}, i, -login_success[i] * share)
        c.add("auth_token_refresh_errors_per_min", {}, i, round(failed * 0.40))
        c.add("auth_signups_per_min", {}, i, -round(c.base("auth_signups_per_min")[i] * share))
        c.add("http_latency_p95_ms", auth, i, timeout + 4 - auth_p95[i])
        c.add("http_latency_p99_ms", auth, i, timeout + 6 - auth_p99[i])
        # Auth timeouts take up about 5% of gateway traffic. The tail can reach the timeout.
        c.add("http_latency_p95_ms", gateway, i, (timeout + 6 if share * rps_auth[i] / rps_gw[i] > 0.05
                                              else 101) - gw_p95[i])
        for route in routes[:2] + (routes[2:] if i % 4 == 0 else ()):
            spans = g.request(g.at(i, g.R.uniform(2, 57)), route, "auth",
                              [("users pool acquire", "internal", timeout,
                                {"db": "users", "_exact": True, "_status": "error", "error": "acquire timeout"})],
                              status=503, msg="users pool acquire timed out", level="error", pod=pod, db="users")
            first_error = first_error or spans[0]["trace_id"]
        # Sample the unchanged pool too. A canary fault should allow successful requests.
        g.request(g.at(i, 58), routes[i % 2], "auth",
                  [("pg SELECT account session", "client", 3, {"db": "users"})],
                  msg="session request succeeded", pod="auth-stable")

    signups = c.cur("auth_signups_per_min")
    signup = next((i for i in range(start, end) if signups[i] > 0), None)
    if signup is not None:
        g.request(g.at(signup, 52), "POST /auth/signup", "auth",
                  [("bcrypt hash", "internal", 75, {}), ("pg INSERT users", "client", 5, {"db": "users"})],
                  status=201, msg="user signed up", pod="auth-stable")
    g.request(g.at(end, 15), "POST /auth/login", "auth",
              [("pg SELECT users", "client", 3, {"db": "users"}), ("bcrypt verify", "internal", 70, {})],
              msg="login ok", pod=pod)
    g.request(g.at(end, 18), "POST /auth/refresh", "auth",
              [("pg SELECT sessions", "client", 3, {"db": "users"})], msg="token refreshed", pod=pod)

    for labels in (gateway, auth):
        service = labels["service"]
        c.fire_for("ServiceErrorRateHigh", "serious", "http_error_rate", labels, lambda v: v > 2, 5,
                   f"http_error_rate{{{{service={service}}}}} {{v:.2f}}% > 2% for 5m")
    for labels in (gateway, auth):
        service = labels["service"]
        baseline = g.SERVICES[service]["p95"] if service == "auth" else 70
        c.fire_for("ServiceLatencyHigh", "warning", "http_latency_p95_ms", labels, lambda v: v > 2 * baseline, 10,
                   f"http_latency_p95_ms{{{{service={service}}}}} {{v:.0f}}ms > 2x normal for 10m")

    page = next(a for a in c.alerts if a["name"] == "ServiceErrorRateHigh" and "gateway" in a["summary"])
    lo, hi = min(c.cur("auth_login_success_rate")[start:end]), max(c.cur("auth_login_success_rate")[start:end])
    c.info = {
        "failure": "Some customers receive 503 when signing in, refreshing a session, or creating an account.",
        "trigger": f"At {hm(g, start)} the Auth canary applies a {original}-to-{reduced} connection pool change. "
                   f"The existing {listeners} session listeners hold both connections.",
        "affected": [
            {"name": "auth", "kind": "service", "impact": "Interactive requests on the canary time out waiting for its local pool."},
            {"name": "gateway", "kind": "service", "impact": "Passes the Auth 503 responses back to customers."},
            {"name": "Users Postgres", "kind": "database", "impact": "Available, with normal query latency and available server connections."},
        ],
        "signals": [
            {"source": "alert", "where": "ServiceErrorRateHigh", "what": page["summary"],
             "when": span_text(g, start + 5, end), "dashboard": "#changes"},
            {"source": "trace", "where": "Auth request", "what": "The wait fails before the first Postgres query.",
             "when": span_text(g, start, end), "dashboard": f"#traces/{first_error}"},
            {"source": "log", "where": "users pool settings applied", "what": "Canary logs show the two active listeners and both pool sizes.",
             "when": span_text(g, start, end), "dashboard": "#logs"},
            {"source": "metric", "where": "auth_login_success_rate", "what": f"Minute rates range from {lo:.0f}% to {hi:.0f}% during the fault.",
             "when": span_text(g, start, end), "dashboard": "#services"},
            {"source": "event", "where": "Auth canary", "what": "The rollout and rollback bracket the errors. The newsletter spike ends before the first 503s.",
             "when": span_text(g, start, end), "dashboard": "#changes"},
        ],
        "expected": {
            "root_cause": f"The {hm(g, start)} Auth canary config caps the local Users Postgres pool at {reduced}. "
                          f"Both connections are held by session listeners, so acquisition times out after {timeout} ms.",
            "impact": f"Login, refresh and signup can return 503 from {span_text(g, start, end)}. "
                      "The other Auth replica and the checkout processing path stay healthy.",
            "next_steps": f"The {hm(g, end)} rollback restores {original} connections and clears the incident. "
                          "Keep the rollback, verify login and refresh recovery, and reserve pool capacity for requests before retrying the rollout.",
        },
    }


@item(id="catalog_list_sort_regression", title="Product lists slow down after default sort changes",
      when="11:12 UTC to now", looks_like="Catalog garbage collection or replica lag",
      example="Catalog and gateway p95 rise. Product lists still return HTTP 200.",
      truth="A Catalog deploy changes the default list order to supplier_rank. Large category queries scan and "
            "sort on the read replica. Product details and stock writes retain their previous query paths.")
def catalog_list_sort_regression(g, c):
    start, end = idx(11, 12), c.N
    version, prior = "v1.9.0", "v1.8.2"
    order_by = "supplier_rank NULLS LAST, id"
    c.event("deploy", start, "catalog", "Product listing merchandising rollout", by="ci-bot",
            version=version, previous=prior, commit=g.hexid(7))
    g.log(g.at(start), "catalog", "info", "product list settings loaded", version=version, default_sort="supplier_rank")
    cat, gw, db = {"service": "catalog"}, {"service": "gateway"}, {"db": "catalog"}
    large_categories = {"shoes": 122_400, "jackets": 87_500}
    small_lists = []
    for trace in c.base_traces:
        root = trace[0]
        if root["name"] != "GET /products" or root["start"] < g.at(start):
            continue
        service_span = next((span for span in trace if span["service"] == "catalog"), None)
        if service_span is None:
            continue  # A gateway rate limit never reaches Catalog.
        category = service_span["attrs"]["category"]
        c.drop_traces.append(root["trace_id"])
        if category not in large_categories:
            small_lists.append((root["start"], category))
    base_metrics = [
        ("http_latency_p95_ms", cat, 1.06), ("http_latency_p99_ms", cat, 1.28),
        ("http_latency_p95_ms", gw, 1.01),
        ("pg_query_p95_ms", db, 1.00),
    ]
    series = [(name, labels, scale, c.base(name, **labels)) for name, labels, scale in base_metrics]
    first_slow = None
    for i in range(start, end):
        cost = g.R.uniform(295, 410)
        for name, labels, scale, base in series:
            c.add(name, labels, i, round(cost * scale, 1) - base[i])
        request_count = round(c.base("http_requests_per_second", **cat)[i] * 60)
        # The slower path affects the large categories, about one in five list reads.
        c.add("pg_slow_queries_per_min", db, i, round(request_count * 0.48 * 0.20))
        for category, qualifying_rows in large_categories.items():
            spans = g.request(g.at(i, g.R.uniform(1, 56)), "GET /products", "catalog",
                              [("pg SELECT products (replica)", "client", cost,
                                {"db": "catalog-replica", "_exact": True, "order_by": order_by,
                                 "plan": "Seq Scan -> top-N heapsort", "version": version,
                                 "qualifying_rows": qualifying_rows, "rows_returned": 24})],
                              msg="slow product list query", level="warn", db="catalog", target="catalog-replica",
                              duration_ms=round(cost), category=category, qualifying_rows=qualifying_rows)
            first_slow = first_slow or spans[0]["trace_id"]
        if i % 3 == 0:
            g.request(g.at(i, 57), "GET /products/:id", "catalog",
                      [("pg SELECT product (replica)", "client", 4, {"db": "catalog-replica"})],
                      msg="product viewed", product_id=g.product_id())
    small_lists.extend((g.at(i, 59), "books") for i in range(start, end, 8))
    for ts, category in small_lists:
        g.request(ts, "GET /products", "catalog",
                  [("pg SELECT products (replica)", "client", 9,
                    {"db": "catalog-replica", "order_by": order_by, "plan": "Index Scan -> top-N heapsort",
                     "version": version, "qualifying_rows": 120, "rows_returned": 24})],
                  msg="listed products", category=category, count=24)

    for labels, baseline in ((gw, 70), (cat, g.SERVICES["catalog"]["p95"])):
        service = labels["service"]
        c.fire_for("ServiceLatencyHigh", "warning", "http_latency_p95_ms", labels, lambda v: v > 2 * baseline, 10,
                   f"http_latency_p95_ms{{{{service={service}}}}} {{v:.1f}}ms > 2x normal for 10m")
    page = next(a for a in c.alerts if "gateway" in a["summary"])
    latency = c.cur("http_latency_p95_ms", **cat)[start:end]
    c.info = {
        "failure": "Large product category lists load slowly and continue returning HTTP 200.",
        "trigger": f"The Catalog {version} rollout at {hm(g, start)} sets the default list order to `{order_by}`.",
        "affected": [
            {"name": "catalog", "kind": "service", "impact": "Slow GET /products for large categories. Product details and stock reservations remain healthy."},
            {"name": "Catalog read replica", "kind": "database", "impact": "Large categories incur a sequential scan and top-N sort. Replication lag stays normal."},
            {"name": "gateway", "kind": "service", "impact": "Gateway p95 rises as it waits for product list responses."},
        ],
        "signals": [
            {"source": "alert", "where": "ServiceLatencyHigh", "what": page["summary"],
             "when": span_text(g, start + 10, end), "dashboard": "#changes"},
            {"source": "event", "where": "Catalog deploy", "what": f"Merchandising rollout of {version}.",
             "when": hm(g, start), "dashboard": "#changes"},
            {"source": "trace", "where": "GET /products", "what": f"The replica span spends most of the request doing `{order_by}`.",
             "when": span_text(g, start, end), "dashboard": f"#traces/{first_slow}"},
            {"source": "metric", "where": "Catalog HTTP p95", "what": f"The minute p95 stays between {min(latency):.0f} and {max(latency):.0f} ms. GC only adds brief p99 spikes.",
             "when": span_text(g, start, end), "dashboard": "#services"},
            {"source": "business", "where": "Checkout and payment", "what": "Checkout and payment KPIs stay at their baseline.",
             "when": span_text(g, start, end), "dashboard": "#business"},
        ],
        "expected": {
            "root_cause": f"Catalog {version} changed the default product list sort at {hm(g, start)}. "
                          f"The read replica scans and sorts large categories for `{order_by}`, driving up latency.",
            "impact": f"Large product category lists take hundreds of milliseconds, from {span_text(g, start, end)} and ongoing. "
                      "Product detail, stock, checkout and payment are unaffected.",
            "next_steps": f"Revert the sort setting or roll back Catalog to {prior}. Verify list and replica latency return to baseline. "
                          "Check the query plan on large categories before restoring the new order.",
        },
    }


def delayed_carrier_checkout(g, t0, retry_at, deadline):
    """Keep normal payment and emails, and move the booking to a separate retry trace."""
    log_start = len(g.LOGS)
    g.checkout(t0, decline=False)
    order = g.ORDERS[-1]
    booked = next(row for row in g.LOGS[log_start:] if row["msg"] == "carrier booked")
    oid, shipment = order["order_id"], booked["shipment_id"]
    payment_trace = next(spans for spans in reversed(g.TRACES) if spans[0]["trace_id"] == booked["trace_id"])
    original = next(s for s in payment_trace if s["name"] == "kafka consume order.paid" and s["service"] == "delivery")
    published = next(s for s in payment_trace if s["name"] == "kafka publish order.paid")
    payment_trace[:] = [s for s in payment_trace if s["service"] != "delivery"]
    g.LOGS[log_start:] = [row for row in g.LOGS[log_start:] if not (
        row["trace_id"] == booked["trace_id"] and row["service"] == "delivery")]
    delivery = g.consume(payment_trace, published["trace_id"], published, "delivery", "order.paid", 80, [
        ("carrier POST /shipments", "client", deadline,
         {"peer": "carrier", "_exact": True, "_status": "error", "error": "client context deadline exceeded"}),
        ("pg INSERT booking retry", "client", 4, {"db": "shipments"}),
    ])
    g.log(g.end(delivery), "delivery", "warn", "carrier booking timed out, retry queued", delivery,
          target="carrier", order_id=oid, deadline_ms=deadline, response_received=False)

    trace, tid = [], g.hexid(32)
    retry = g.span(trace, tid, None, "delivery", "retry carrier booking", retry_at, kind="internal", order_id=oid)
    retry["duration_ms"] = g.run_steps(trace, tid, retry, "delivery", [
        ("carrier lookup by order reference", "client", 125, {"peer": "carrier", "http_status": 404}),
        ("carrier POST /shipments", "client", 620, {"peer": "carrier", "http_status": 201}),
        ("pg INSERT shipment + outbox and complete retry", "client", 5, {"db": "shipments"}),
    ], retry_at)
    update = g.publish(trace, tid, retry, "delivery", "delivery.updated", g.ms(g.end(retry), 150))
    update["attrs"].update(order_id=oid, shipment_id=shipment, status="BOOKED")
    g.consume(trace, tid, update, "order", "delivery.updated", 60,
              [("pg UPDATE order shipment ETA", "client", 4, {"db": "orders"})])
    g.consume(trace, tid, update, "notification", "delivery.updated", 70,
              [("skip shipping email for booking update", "internal", 1, {"shipment_status": "BOOKED"})])
    g.log(g.end(retry), "delivery", "info", "carrier booked after retry", retry,
          order_id=oid, shipment_id=shipment, carrier=booked["carrier"], eta=booked["eta"])
    order["timeline"] = [row for row in order["timeline"] if row["ts"] != g.end(original)]
    order["timeline"] += [
        {"ts": g.end(delivery), "service": "delivery", "event": "booking timed out, retry queued", "trace_id": published["trace_id"]},
        {"ts": g.end(retry), "service": "delivery", "event": f"carrier booked after retry, ETA {booked['eta']}", "trace_id": tid},
    ]
    order["timeline"].sort(key=lambda row: row["ts"])
    g.TRACES.append(trace)
    return order, published["trace_id"]


def carrier_latency_samples(count, reference_p95):
    """Represent normal calls around the minute's baseline p95 for a mixed percentile."""
    return [reference_p95 * (0.75 + 0.25 * (j + 1) / count) for j in range(count)]


def carrier_p95(samples):
    return round(sorted(samples)[int(0.95 * len(samples))], 1)


@item(id="carrier_booking_deadline", title="Delivery cancels bookings before the carrier can respond",
      when="08:42 to 09:10 UTC; retries drain by 09:22 UTC", looks_like="Carrier maintenance or an outage",
      example="Carrier error rate rises. Checkout succeeds, but paid orders wait for a booking.",
      truth="Delivery uses a new 450 ms client deadline for booking requests. Calls time out before receiving a "
            "response. Restoring the previous 5000 ms deadline clears new errors and lets queued bookings drain.")
def carrier_booking_deadline(g, c):
    start, restore, end = idx(8, 42), idx(9, 10), idx(9, 22)
    normal, deadline = 5000, 450
    c.event("config", start, "delivery", "Apply regional carrier client profile", profile="regional")
    c.event("config", restore, "delivery", "Restore prior carrier client profile", profile="standard")
    for minute, timeout in ((start, deadline), (restore, normal)):
        g.log(g.at(minute), "delivery", "info", "carrier booking client settings loaded",
              operation="POST /shipments", booking_deadline_ms=timeout)

    provider, topic = {"provider": "carrier"}, {"topic": "delivery.updated"}
    req_name, err_name = "third_party_requests_per_min", "third_party_error_rate"
    lat_name = "third_party_latency_p95_ms"
    rates = c.base(req_name, **provider)
    errors = c.base(err_name, **provider)
    latency = c.base(lat_name, **provider)
    updates = c.base("kafka_messages_in_per_min", **topic)
    paid = c.base("kafka_messages_in_per_min", topic="order.paid")
    queued = [min(paid[i], updates[i]) for i in range(start, restore)]
    deferred = sum(queued)
    drain = split(deferred, end - restore)
    pending = 0
    for i, n in enumerate(queued, start):
        # The collector's count is one booking attempt per affected order plus any remaining calls.
        total = max(rates[i], n)
        baseline_errors = round((total - n) * errors[i] / 100)
        c.add(req_name, provider, i, total - rates[i])
        c.add(err_name, provider, i, g.rate(n + baseline_errors, total) - errors[i])
        observed = [deadline] * n + carrier_latency_samples(total - n, latency[i])
        c.add(lat_name, provider, i, carrier_p95(observed) - latency[i])
        c.add("kafka_messages_in_per_min", topic, i, -n)
        pending += n
        if (i - start + 1) % 5 == 0:
            g.log(g.at(i, 59), "delivery", "info", "carrier booking retry queue depth", pending=pending)
    for i, n in enumerate(drain, restore):
        total = rates[i] + 2 * n  # Reconcile the order reference, then book.
        c.add(req_name, provider, i, 2 * n)
        c.add(err_name, provider, i, errors[i] * rates[i] / total - errors[i])
        observed = carrier_latency_samples(rates[i], latency[i]) + [125] * n + carrier_latency_samples(n, 670)
        c.add(lat_name, provider, i, carrier_p95(observed) - latency[i])
        c.add("kafka_messages_in_per_min", topic, i, n)
        pending -= n
        if (i - restore + 1) % 5 == 0:
            g.log(g.at(i, 59), "delivery", "info", "carrier booking retry queue depth", pending=pending)
    g.log(g.at(end), "delivery", "info", "carrier booking retry queue drained", retried=deferred, pending=pending)

    # Rebuild only sampled checkouts from the booking window. Keep separate inbound tracking webhooks.
    c.drop_orders_created(start, restore)
    original_samples = [o for o in c.base_orders if g.at(start) <= o["created_at"] < g.at(restore)]
    sample_times = [o["created_at"] for o in original_samples
                    if o["status"] != "PAYMENT_FAILED" and o["created_at"] < g.at(restore, -8)]
    sample_times += [g.at(start, 13), g.at(restore - 4, 22)]
    sample_times.sort()
    for o in original_samples:
        if o["created_at"] not in sample_times:
            g.checkout(o["created_at"], decline=o["status"] == "PAYMENT_FAILED")
    samples = [delayed_carrier_checkout(g, t0, g.at(restore + k * len(drain) // len(sample_times), 20 + k % 30), deadline)
               for k, t0 in enumerate(sample_times)]
    example, trace_id = samples[0]

    c.fire_for("ThirdPartyErrors", "serious", "third_party_error_rate", provider, lambda v: v > 5, 5,
               "third_party_error_rate{{provider=carrier}} {v:.1f}% > 5% for 5m")
    page = next(a for a in c.alerts if a["fired_at"] == g.iso(g.at(start + 5)))
    c.info = {
        "failure": f"{deferred} paid orders wait for shipment booking while the booking client times out.",
        "trigger": f"The carrier profile at {hm(g, start)} reduces the Delivery booking deadline from {normal} to {deadline} ms.",
        "affected": [
            {"name": "delivery", "kind": "service", "impact": "Persists failed booking attempts for retry. The Kafka consumer continues committing work."},
            {"name": "Shipments Postgres", "kind": "database", "impact": "Holds queued attempts until Delivery reconciles and retries them."},
            {"name": "carrier", "kind": "provider", "impact": "Booking calls are cancelled by Delivery before it receives HTTP responses."},
        ],
        "signals": [
            {"source": "alert", "where": "ThirdPartyErrors", "what": page["summary"],
             "when": span_text(g, start + 5, restore), "dashboard": "#changes"},
            {"source": "trace", "where": "carrier POST /shipments", "what": f"A paid order queues a retry after a {deadline} ms client timeout.",
             "when": hm(g, minute_of(g, example["created_at"])), "dashboard": f"#traces/{trace_id}"},
            {"source": "order", "where": example["order_id"], "what": "Payment and confirmation succeed. A retry books the shipment later.",
             "when": span_text(g, start, end), "dashboard": f"#orders/{example['order_id']}"},
            {"source": "log", "where": "carrier booking client settings loaded", "what": f"The booking client applies {deadline} ms, then restores {normal} ms.",
             "when": span_text(g, start, restore), "dashboard": "#logs"},
            {"source": "metric", "where": "delivery.updated", "what": "Booking events shift into the recovery window. Earlier carrier maintenance returns HTTP 503.",
             "when": span_text(g, start, end), "dashboard": "#deps"},
        ],
        "expected": {
            "root_cause": f"Delivery applied a {deadline} ms deadline at {hm(g, start)}, below normal carrier booking response times. "
                          "The client cancelled calls and queued retries. Carrier maintenance is a separate, earlier window.",
            "impact": f"{deferred} paid orders waited for booking. Checkout, payment, confirmations and existing shipment updates continued.",
            "next_steps": f"The deadline reverted to {normal} ms at {hm(g, restore)}. Retry by order reference after checking for an "
                          f"existing booking. The queue reached zero by {hm(g, end)}. Verify booking and error rates stay normal.",
        },
    }
