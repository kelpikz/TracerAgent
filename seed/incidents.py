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
