"""Noise for the baseline: things that look like a problem, but are not.

Each item is an overlay on the baseline:
  metrics    additive deltas: {name, labels, i, delta[]}  (value[i + k] += delta[k])
  logs       extra log lines
  traces     extra traces
  orders     extra orders
  events     extra change events (deploys, config changes)
  drop_logs  baseline log lines that the item replaces: {service, msg, from, to}
  drop_traces, drop_orders  baseline trace IDs and order IDs that the item replaces
             (their logs go too). The dashboard toggles do not support these. Only incidents use them.
  alerts     alert history that the item causes
  info       optional text for the Info tab of an eval case (incidents set it)

Each item gets its own random generator, seeded from its ID. A new item does not change the data of the others.

generate.py calls build() after the baseline is complete, so the baseline does not change.
The dashboard applies the overlays in the browser (toggles). apply() does the same in Python.
"""
import copy
import random
from contextlib import contextmanager

DATA_KEYS = ("metrics", "logs", "traces", "orders", "events", "drop_logs", "drop_traces", "drop_orders")
ITEMS = []


def registry(items):
    """Make an @item decorator that adds to `items`."""
    def item(**meta):
        def wrap(fn):
            items.append((meta, fn))
            return fn
        return wrap
    return item


item = registry(ITEMS)


def idx(h, m=0):
    """Minute index for a UTC time of day. The window is 12:00 day 1 to 12:00 day 2."""
    return ((h - 12) % 24) * 60 + m


def key(name, labels):
    return (name,) + tuple(x for kv in sorted(labels.items()) for x in kv)


class Ctx:
    def __init__(self, g, by_key):
        self.g, self.by_key, self.N = g, by_key, g.MINUTES
        self.delta, self.alerts, self.drop = {}, [], []
        self.events, self.drop_traces, self.drop_orders, self.info = [], [], [], None
        self.base_orders = g.ORDERS  # baseline orders (raw), read before capture() swaps the list

    def base(self, name, **labels):
        return self.by_key[key(name, labels)]["values"]

    def add(self, name, labels, i, dv):
        if 0 <= i < self.N and dv:
            d = self.delta.setdefault(key(name, labels), {"name": name, "labels": labels, "pts": {}})
            d["pts"][i] = d["pts"].get(i, 0) + dv

    def cur(self, name, **labels):
        v = list(self.base(name, **labels))
        d = self.delta.get(key(name, labels))
        for i, dv in (d["pts"].items() if d else []):
            v[i] += dv
        return v

    def alert(self, name, severity, fired, resolved, summary):
        g = self.g
        self.alerts.append({"name": name, "severity": severity, "fired_at": g.iso(g.at(fired)),
                            "resolved_at": g.iso(g.at(resolved)) if resolved < self.N else None,
                            "summary": summary})

    def event(self, type_, i, service, summary, by="ops", **fields):
        g = self.g
        self.events.append(dict({"type": type_, "ts": g.iso(g.at(i)), "service": service,
                                 "summary": summary, "by": by}, **fields))

    def drop_orders_created(self, i0, i1):
        """Remove baseline sample orders created in minutes [i0, i1), with their traces and logs."""
        g = self.g
        lo, hi = g.at(i0), g.at(i1)
        for o in self.base_orders:
            if lo <= o["created_at"] < hi:
                self.drop_orders.append(o["order_id"])
                for t in o["timeline"]:
                    if t["trace_id"] and t["trace_id"] not in self.drop_traces:
                        self.drop_traces.append(t["trace_id"])

    def fire_for(self, name, severity, series, labels, cond, need, text):
        """Alert when cond(value) is true for `need` minutes in a row."""
        v, i = self.cur(series, **labels), 0
        while i < self.N:
            if not cond(v[i]):
                i += 1
                continue
            j = i
            while j < self.N and cond(v[j]):
                j += 1
            if j - i >= need:
                self.alert(name, severity, i + need, j, text.format(v=v[i + need - 1]))
            i = j

    def metrics(self):
        out = []
        for d in self.delta.values():
            pts = d["pts"]
            i0, i1 = min(pts), max(pts)
            out.append({"name": d["name"], "labels": d["labels"], "i": i0,
                        "delta": [round(pts.get(i, 0), 3) for i in range(i0, i1 + 1)]})
        return out


@contextmanager
def capture(g):
    """Send logs, traces and orders from the generate.py helpers into new lists."""
    saved = g.LOGS, g.TRACES, g.ORDERS
    g.LOGS, g.TRACES, g.ORDERS = [], [], []
    box = {}
    try:
        yield box
    finally:
        box.update(logs=g.LOGS, traces=g.TRACES, orders=g.ORDERS)
        g.LOGS, g.TRACES, g.ORDERS = saved


def build(g, by_key, items=ITEMS):
    out = []
    for meta, fn in items:
        c = Ctx(g, by_key)
        saved = g.R
        g.R = random.Random(f"{g.SEED}:{meta['id']}")
        try:
            with capture(g) as box:
                fn(g, c)
        finally:
            g.R = saved
        out.append(dict(meta,
                        metrics=c.metrics(),
                        logs=[g.clean(e) for e in sorted(box["logs"], key=lambda e: e["ts"])],
                        traces=[g.trace_record(sp) for sp in sorted(box["traces"], key=lambda sp: sp[0]["start"])],
                        orders=[g.clean(o) for o in box["orders"]],
                        events=c.events,
                        drop_logs=c.drop,
                        drop_traces=c.drop_traces,
                        drop_orders=c.drop_orders,
                        alerts=c.alerts,
                        **({"info": c.info} if c.info else {})))
    return out


def apply(bundle, items, name):
    """Baseline bundle + chosen items = one scenario. Same logic as applyNoise() in the dashboard."""
    b = copy.deepcopy(bundle)
    series = {key(s["name"], s["labels"]): s for s in b["metrics"]["series"]}
    for n in items:
        for p in n["metrics"]:
            vals = series[key(p["name"], p["labels"])]["values"]
            for k, d in enumerate(p["delta"]):
                vals[p["i"] + k] = round(vals[p["i"] + k] + d, 3)
        for r in n["drop_logs"]:
            b["logs"] = [e for e in b["logs"] if not (e["service"] == r["service"] and e["msg"] == r["msg"]
                                                      and r["from"] <= e["ts"] < r["to"])]
        gone = set(n.get("drop_traces", []))
        if gone:
            b["traces"] = [t for t in b["traces"] if t["trace_id"] not in gone]
            b["logs"] = [e for e in b["logs"] if e.get("trace_id") not in gone]
        orders_gone = set(n.get("drop_orders", []))
        b["orders"] = [o for o in b["orders"] if o["order_id"] not in orders_gone]
        b["events"] += n.get("events", [])
        b["logs"] += n["logs"]
        b["traces"] += n["traces"]
        b["orders"] += n["orders"]
        b["alerts"]["history"] += n["alerts"]
    b["logs"].sort(key=lambda e: e["ts"])
    b["traces"].sort(key=lambda t: t["start"])
    b["orders"].sort(key=lambda o: o["created_at"])
    b["events"].sort(key=lambda e: e["ts"])
    b["alerts"]["history"].sort(key=lambda a: a["fired_at"])
    b["alerts"]["firing"] = [a for a in b["alerts"]["history"] if a["resolved_at"] is None]
    firing = {a["name"] for a in b["alerts"]["firing"]}
    for r in b["alerts"]["rules"]:
        r["state"] = "firing" if r["name"] in firing else "ok"
    b["meta"] = dict(b["meta"], scenario=name, description="24 hours of shop telemetry.")
    return b


# ===================================================================== A. alerts that fire, but are noise

@item(id="night_declines", n=1, group="alerts", title="Payment success flaps at night",
      when="03:00 to 05:00 UTC", looks_like="A payment outage",
      example="PaymentSuccessLow and CheckoutSuccessLow fire 3 times between 03:00 and 05:00. "
              "Each time, they resolve after 3 to 10 minutes. You see more 402 card declines. "
              "Request rates stay the same, because a decline is still a request. "
              "Fewer orders go on: fewer order.created, order.paid and delivery.updated events, "
              "Stripe webhooks, emails and carrier bookings.",
      truth="Traffic is at its lowest: about 10 checkouts per minute. 1 to 3 card declines in one minute "
            "push the rate below 90%. The declines come from different users and have different decline codes. "
            "Stripe is healthy: no 5xx, normal latency. This is not an incident.")
def night_declines(g, c):
    R = g.R
    att = c.base("checkout_attempts_per_min")
    pay, chk = c.base("payment_success_rate"), c.base("checkout_success_rate")
    for s, n in [(idx(3, 12), 17), (idx(3, 51), 14), (idx(4, 34), 19)]:
        for i in range(s, s + n):
            a = att[i]
            if a == 0:
                continue
            k = 1 if a <= 6 else R.choice([1, 2, 2, 3])
            while pay[i] - 100 * k / a >= 89 and k < a:
                k += 1
            c.add("payment_success_rate", {}, i, -min(pay[i], 100 * k / a))
            c.add("checkout_success_rate", {}, i, -min(chk[i], 100 * k / a))
            # Same attempts, but k of them now end in 402. What follows a paid order does not happen.
            gw_req = c.base("http_requests_per_second", service="gateway")[i] * 60
            c.add("http_4xx_rate", {"service": "gateway"}, i, 100 * k / gw_req)
            for t in ("order.created", "payment.succeeded", "order.paid"):
                c.add("kafka_messages_in_per_min", {"topic": t}, i, -min(k, c.base("kafka_messages_in_per_min", topic=t)[i]))
            c.add("webhooks_received_per_min", {"provider": "stripe"}, i,
                  -min(k, c.base("webhooks_received_per_min", provider="stripe")[i]))
            c.add("emails_sent_per_min", {}, i, -min(2 * k, c.base("emails_sent_per_min")[i]))
            for lab, n in (({"provider": "email"}, 2 * k), ({"provider": "carrier"}, k)):
                c.add("third_party_requests_per_min", lab, i, -min(n, c.base("third_party_requests_per_min", **lab)[i]))
            c.add("kafka_messages_in_per_min", {"topic": "delivery.updated"}, i,
                  -min(k, c.base("kafka_messages_in_per_min", topic="delivery.updated")[i]))
            if R.random() < 0.4:  # traces are a sample, like the baseline
                g.checkout(g.at(i, R.uniform(0, 59)), decline=True)
    c.fire_for("PaymentSuccessLow", "critical", "payment_success_rate", {}, lambda v: v < 90, 10,
               "payment_success_rate {v:.1f}% < 90% for 10m")
    c.fire_for("CheckoutSuccessLow", "critical", "checkout_success_rate", {}, lambda v: v < 90, 10,
               "checkout_success_rate {v:.1f}% < 90% for 10m")


@item(id="dlq_deleted_users", n=3, group="alerts", title="Notification DLQ grows slowly",
      when="5 times a day, last one at 11:51 UTC (still firing)", looks_like="A poison message that blocks Notification",
      example="DlqGrowing fires 5 times. The notification DLQ goes from 2 to 7 messages. "
              "Each time, Notification logs 3 failed email tries, then 'moved to DLQ'.",
      truth="The user deleted their account after the order. The email provider rejects the address "
            "(mailbox does not exist). After 3 tries, Notification puts the message in the DLQ. "
            "The consumer does not stop and lag stays normal. This is a known issue with no fix yet.")
def dlq_deleted_users(g, c):
    R = g.R
    for m in [95, 410, 735, 1190, 1431]:
        uid, oid = g.user_id(), g.order_id()
        g.log(g.at(m - R.randint(40, min(m, 300)), R.uniform(0, 59)), "auth", "info", "user account deleted",
              user_id=uid, reason="user request")
        tpl = R.choice(["order_shipped", "order_delivered"])
        err = "550 recipient address rejected: mailbox does not exist"
        for k in range(3):
            i = m - 2 + k
            last = k == 2
            g.log(g.at(i, R.uniform(10, 50)), "notification", "error" if last else "warn",
                  "email failed 3 times, message moved to DLQ" if last else f"email failed, retry {k + 1}/3",
                  template=tpl, order_id=oid, user_id=uid, error=err,
                  **({"group": "notification", "topic": "delivery.updated"} if last else {}))
            c.add("emails_failed_per_min", {}, i, 1)
        for i in range(m, c.N):
            c.add("kafka_dlq_size", {"group": "notification"}, i, 1)
        c.alert("DlqGrowing", "warning", m, m + 15, "kafka_dlq_size{group=notification} grew in 15m")


@item(id="stuck_3ds", n=6, group="alerts", title="One order stuck in PENDING",
      when="From 11:26 UTC, still open", looks_like="The Stripe webhook failure",
      example="One order stays in PENDING for more than 15 minutes. orders_stuck_pending_15m is 1. "
              "The stuck orders job logs a warning every minute. No Stripe webhook arrives for it.",
      truth="Stripe asked for 3-D Secure. The customer did not finish the step at their bank. "
            "Stripe sends no webhook until the customer acts or the intent expires. Other orders get their "
            "webhooks. The rule fires only above 5 stuck orders. This is not an incident.")
def stuck_3ds(g, c):
    R = g.R
    i0 = idx(11, 26)
    t0 = g.at(i0, 17.4)
    tid, spans, tl = g.hexid(32), [], []
    oid, uid = g.order_id(), g.user_id()
    amount, items, pay_id = 189.90, 2, "pay_" + g.hexid(10)
    gw = g.span(spans, tid, None, "gateway", "POST /checkout", t0, http_status=201)
    o0 = g.ms(t0, 0.9)
    o = g.span(spans, tid, gw, "order", "POST /checkout", o0, http_status=201, order_id=oid, user_id=uid)
    cur = g.run_steps(spans, tid, o, "order", [("pg INSERT orders", "client", 4.5, {"db": "orders"})], o0)
    tl.append((g.ms(o0, cur), "order", "order created (status NEW)", tid))
    c0 = g.ms(o0, cur)
    cs = g.span(spans, tid, o, "catalog", "POST /stock/reserve", c0, http_status=200, order_id=oid, items=items)
    cs["duration_ms"] = g.run_steps(spans, tid, cs, "catalog", [("pg UPDATE stock", "client", 6, {"db": "catalog"})], c0) + 2
    g.log(g.end(cs), "catalog", "info", "stock reserved", cs, order_id=oid, items=items)
    tl.append((g.end(cs), "catalog", "stock reserved", tid))
    cur += cs["duration_ms"] + 0.5
    p0 = g.ms(o0, cur)
    p = g.span(spans, tid, o, "payment", "POST /payments", p0, http_status=201,
               order_id=oid, payment_id=pay_id, amount=amount, currency="EUR")
    p["duration_ms"] = g.run_steps(spans, tid, p, "payment", [
        ("stripe POST /v1/payment_intents", "client", 330,
         {"peer": "stripe", "http_status": 200, "intent_status": "requires_action"}),
        ("pg INSERT payments", "client", 4, {"db": "payments"}),
    ], p0) + 1.5
    g.log(g.end(p), "payment", "info", "payment needs 3-D Secure, waiting for customer", p, order_id=oid,
          payment_id=pay_id, amount=amount, intent_status="requires_action", next_action="redirect_to_url")
    tl.append((g.end(p), "payment", "payment intent created: requires_action (3-D Secure)", tid))
    cur += p["duration_ms"] + 0.5
    cur += g.run_steps(spans, tid, o, "order", [("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})], g.ms(o0, cur))
    o["duration_ms"] = cur + 2
    g.log(g.end(o), "order", "info", "order created", o, order_id=oid, status="PENDING", amount=amount)
    tl.append((g.end(o), "order", "status PENDING", tid))
    gw["duration_ms"] = o["duration_ms"] + 1.6
    g.access_log(gw)
    pub = g.publish(spans, tid, o, "order", "order.created", g.ms(g.end(o), 420))
    tl.append((g.end(pub), "order", "event published: order.created", tid))
    g.email(spans, tid, pub, "order.created", "order_received", oid, tl)
    g.TRACES.append(spans)

    stuck_from = i0 + 16
    tl.append((g.at(stuck_from, 0.2), "order", "stuck orders job: PENDING for more than 15 min", None))
    g.finish_order(oid, uid, t0, amount, items, "PENDING", tl)
    for i in range(i0, c.N):
        c.add("orders_pending", {}, i, 1)
    for i in range(stuck_from, c.N):
        c.add("orders_stuck_pending_15m", {}, i, 1)
        g.log(g.at(i, 0.2), "order", "warn", "stuck orders job finished", pending_over_15m=1,
              oldest_order_id=oid, oldest_age_min=i - i0, duration_ms=round(g.jit(18, 0.2), 1))
    c.drop.append({"service": "order", "msg": "stuck orders job finished",
                   "from": g.iso(g.at(stuck_from)), "to": g.iso(g.END)})


# ===================================================================== B. scheduled jobs and legacy code

@item(id="nightly_backup", n=7, group="spikes", title="Nightly backup on the orders DB",
      when="02:00 to 02:45 UTC", looks_like="A DB bottleneck",
      example="On the orders DB: query p95 goes up 3 times, slow queries go up, disk use goes up 5%. "
              "Order p95 goes up a little. Order logs show 'slow query' warnings.",
      truth="pg_dump makes the nightly backup. It reads all tables and writes the dump to the local disk. "
            "At 02:45, the job uploads the file to S3 and deletes it. Disk use goes back to normal. "
            "This happens every night.")
def nightly_backup(g, c):
    R = g.R
    s, e = idx(2), idx(2, 40)
    q = c.base("pg_query_p95_ms", db="orders")
    op95, op99 = c.base("http_latency_p95_ms", service="order"), c.base("http_latency_p99_ms", service="order")
    for i in range(s, e):
        ramp = min(1, (i - s + 1) / 3, (e - i) / 3)
        c.add("pg_query_p95_ms", {"db": "orders"}, i, q[i] * 2.2 * ramp)
        c.add("pg_slow_queries_per_min", {"db": "orders"}, i, g.poisson(2.5 * ramp))
        c.add("pg_connections_used", {"db": "orders"}, i, 2)
        c.add("http_latency_p95_ms", {"service": "order"}, i, op95[i] * 0.35 * ramp)
        c.add("http_latency_p99_ms", {"service": "order"}, i, op99[i] * 0.6 * ramp)
    for i in range(s, e + 5):
        c.add("pg_disk_used_pct", {"db": "orders"}, i, 5.2 * min(1, (i - s) / (e - s)))
    g.log(g.at(s, 0.4), "cron", "info", "backup started", job="pg_dump", db="orders",
          target="/var/backups/orders.dump")
    for t in sorted(g.at(R.randint(s + 1, e - 2), R.uniform(0, 59)) for _ in range(11)):
        g.log(t, "order", "warn", "slow query", db="orders", duration_ms=round(R.uniform(900, 2600)),
              query=R.choice(["SELECT * FROM orders WHERE user_id = $1 ORDER BY created_at DESC",
                              "SELECT * FROM orders WHERE id = $1",
                              "UPDATE orders SET status = $1 WHERE id = $2"]))
    g.log(g.at(e, 12.3), "cron", "info", "backup finished", job="pg_dump", db="orders", size_mb=5240, duration_s=2412)
    g.log(g.at(e + 4, 40.1), "cron", "info", "backup uploaded", job="pg_dump", db="orders",
          target="s3://shop-backups/orders/2026-11-20.dump")
    g.log(g.at(e + 4, 41.0), "cron", "info", "local backup file deleted", job="pg_dump", db="orders")


@item(id="price_import", n=8, group="spikes", title="Supplier price import",
      when="00:30 to 00:42 UTC", looks_like="The replica lag that shows wrong prices",
      example="Catalog admin changes jump to about 9,000 per minute. Catalog replica lag goes up to 44 s. "
              "ReplicaLagHigh fires for 2 minutes. Catalog DB queries are slower.",
      truth="A cron job imports the supplier price file every night (about 48,000 rows in 10 batches). "
            "The replica falls behind while it applies the batches, then catches up. For about 10 minutes, "
            "product pages can show the old price. Checkout reads the price from the primary DB, so customers "
            "pay the correct price. This happens every night.")
def price_import(g, c):
    R = g.R
    s = idx(0, 30)
    for k, rows in enumerate([7200, 9800, 9600, 9400, 9100, 3110]):
        c.add("catalog_admin_changes_per_min", {}, s + k, rows)
    lag = c.base("pg_replication_lag_s", db="catalog")
    for k, v in enumerate([3, 12, 24, 33, 41, 44, 40, 36, 33, 31, 18, 6, 1.5]):
        c.add("pg_replication_lag_s", {"db": "catalog"}, s + 1 + k, v - lag[s + 1 + k])
    q, cpu = c.base("pg_query_p95_ms", db="catalog"), c.base("cpu_pct", service="catalog")
    for i in range(s, s + 7):
        c.add("pg_query_p95_ms", {"db": "catalog"}, i, q[i])
        c.add("pg_slow_queries_per_min", {"db": "catalog"}, i, g.poisson(3))
        c.add("cpu_pct", {"service": "catalog"}, i, min(15, 95 - cpu[i]))
    g.log(g.at(s, 0.3), "cron", "info", "supplier price import started", job="price_import",
          file="supplier_prices_2026-11-20.csv", rows=48210)
    for b in range(10):
        g.log(g.at(s, 15 + b * 33), "catalog", "info", "price batch committed", job="price_import",
              batch=f"{b + 1}/10", rows=5000 if b < 9 else 3210, duration_ms=round(R.uniform(25000, 34000)))
    g.log(g.at(s + 5, 48.2), "cron", "info", "supplier price import finished", job="price_import",
          rows_updated=48210, duration_s=348)
    c.fire_for("ReplicaLagHigh", "serious", "pg_replication_lag_s", {"db": "catalog"}, lambda v: v > 30, 5,
               "pg_replication_lag_s{{db=catalog}} {v:.0f}s > 30s for 5m")


@item(id="redis_keys_scan", n=9, group="spikes", title="Abandoned-cart job blocks Redis",
      when="00:00 to 00:02 UTC", looks_like="A Redis failure",
      example="Redis p95 latency jumps from about 1 ms to 24 ms. Cart p95 goes up 3 times and p99 goes up 8 times. "
              "Cart logs 16 'slow redis command' warnings in 96 seconds.",
      truth="A legacy job finds abandoned carts with 16 KEYS commands ('KEYS cart:0*' to 'KEYS cart:f*'). "
            "Each command blocks Redis for about 1.5 s while it reads about 3,800 keys. For about 2 minutes, "
            "cart requests that arrive during a block wait for it to end. No errors. The job then queues "
            "reminder emails. This happens every night at midnight.")
def redis_keys_scan(g, c):
    R = g.R
    s = idx(0)
    lat = c.base("redis_latency_p95_ms")
    for k, v in enumerate([19.6, 23.8, 2.1]):
        c.add("redis_latency_p95_ms", {}, s + k, v - lat[s + k])
    p95, p99 = c.base("http_latency_p95_ms", service="cart"), c.base("http_latency_p99_ms", service="cart")
    for i in (s, s + 1):
        c.add("http_latency_p95_ms", {"service": "cart"}, i, p95[i] * 2)
        c.add("http_latency_p99_ms", {"service": "cart"}, i, p99[i] * 7)
    g.log(g.at(s, 0.1), "cart", "info", "abandoned cart job started", job="abandoned_carts")
    t, blocks, total = 0.1, [], 0
    for p in "0123456789abcdef":  # seconds from midnight: each KEYS call blocks Redis from t to t + d
        t += R.uniform(3.5, 5.0)
        d, keys = R.uniform(1.2, 1.7), R.randint(3600, 4050)
        blocks.append((t, d))
        total += keys
        g.log(g.at(s, t + d), "cart", "warn", "slow redis command", job="abandoned_carts",
              command=f"KEYS cart:{p}*", duration_ms=round(d * 1000), keys=keys)
        t += d
    for b0, d in R.sample(blocks, 5):  # a cart request that arrives during a block waits until it ends
        off = R.uniform(0, d * 0.75)
        route, name = R.choice([("GET /cart", "redis HGETALL cart"), ("POST /cart/items", "redis HSET cart")])
        g.request(g.at(s, b0 + off), route, "cart",
                  [(name, "client", (d - off) * 1000 + R.uniform(0.5, 2), {"db": "redis", "_exact": True})],
                  status=201 if route.startswith("POST") else 200, msg=None, user_id=g.user_id())
    g.log(g.at(s, t + 0.3), "cart", "info", "abandoned cart job finished", job="abandoned_carts",
          keys=total, reminders_queued=812, duration_s=round(t))


@item(id="notification_oom", n=10, group="spikes", title="Notification memory leak restarts a pod",
      when="About every 6 hours", looks_like="A crash loop",
      example="Notification memory grows to the 512 MB limit, then a pod restarts (OOMKilled). "
              "Kafka lag and email delay spike for 3 minutes, then go back to normal.",
      truth="A known memory leak in Notification. Kubernetes kills the pod at the memory limit and starts it again. "
            "Only one restart each time, about 6 hours apart. Kafka lag drains in a few minutes and no email is lost. "
            "The 03:30 deploy also resets memory.")
def notification_oom(g, c):
    R = g.R
    mem = c.base("memory_mb", service="notification")
    deploy = next(d["minute"] for d in g.DEPLOYS if d["service"] == "notification")
    leak, restarts = 150.0, []
    for i in range(c.N):
        if i == deploy:
            leak = 0.0
        leak += R.uniform(0.75, 1.1)
        if mem[i] + leak >= 505:
            restarts.append(i)
            leak = 0.0
        c.add("memory_mb", {"service": "notification"}, i, leak)
    lab = {"service": "notification"}
    for n, r in enumerate(restarts, 1):
        ver = "v0.9.3" if r < deploy else "v0.9.4"
        pod = f"notification-{g.hexid(5)}"
        c.add("pod_restarts", lab, r, 1)
        c.add("pods_ready", lab, r, -1)
        c.add("pods_ready", lab, r + 1, -1)
        for k, v in enumerate([160, 90, 35, 10]):
            c.add("kafka_consumer_lag", {"group": "notification"}, r + k, v)
        for k, v in enumerate([38, 20, 6]):
            c.add("notification_event_to_email_p95_s", {}, r + k, v)
        g.log(g.at(r, 4.8), "notification", "error", "container killed: OOMKilled", source="kubelet", pod=pod,
              memory_limit_mb=512, restart_count=n)
        g.log(g.at(r, 21.3), "notification", "info", f"starting notification {ver}", pod=pod, version=ver)
        g.log(g.at(r + 1, 2.0), "notification", "info", "ready, listening on :8080", version=ver)
        g.log(g.at(r + 1, 5.5), "notification", "info", "kafka consumer group rebalanced", group="notification")


@item(id="catalog_gc", n=11, group="spikes", title="Catalog garbage collection pauses",
      when="Every 40 minutes", looks_like="Slow product pages",
      example="Catalog p99 latency spikes for one minute every 40 minutes. p95 stays normal. "
              "Catalog logs a 'GC pause' warning each time. Some product page traces take more than 1 s.",
      truth="Catalog runs with old runtime settings. The heap fills up and a full garbage collection stops the "
            "process for about 1 s. Only requests at that moment are slow. No errors. This is old behavior.")
def catalog_gc(g, c):
    R = g.R
    p99 = c.base("http_latency_p99_ms", service="catalog")
    for i in range(17, c.N, 40):
        c.add("http_latency_p99_ms", {"service": "catalog"}, i, p99[i] * R.uniform(3, 5))
        t = g.at(i, R.uniform(0, 58))
        pause = R.uniform(900, 1600)
        g.log(t, "catalog", "warn", "GC pause", gc="full", pause_ms=round(pause), heap_used_pct=round(R.uniform(90, 95), 1))
        g.request(g.ms(t, 50), "GET /products/:id", "catalog", [
            ("pg SELECT product (replica)", "client", 4, {"db": "catalog-replica"}),
            ("render response", "internal", pause, {"_exact": True}),
        ], msg="product viewed", product_id=g.product_id())


@item(id="node3_report", n=12, group="spikes", title="Report job on node-3",
      when="06:00 to 06:12 UTC", looks_like="A node problem",
      example="node-3 CPU goes to about 95% for 12 minutes. The other nodes stay normal.",
      truth="A legacy sales report job runs on node-3 every morning. It uses all free CPU, then stops. "
            "The services on node-3 have CPU limits, so their latency does not change.")
def node3_report(g, c):
    R = g.R
    s = idx(6)
    cpu = c.base("node_cpu_pct", node="node-3")
    for k in range(12):
        target = R.uniform(92, 97) * min(1, (k + 1) / 2, (12 - k) / 2) if k in (0, 11) else R.uniform(92, 97)
        c.add("node_cpu_pct", {"node": "node-3"}, s + k, max(0, target - cpu[s + k]))
    g.log(g.at(s, 0.5), "cron", "info", "sales report job started", job="legacy_sales_report", node="node-3")
    g.log(g.at(s + 11, 40.2), "cron", "info", "sales report job finished", job="legacy_sales_report",
          node="node-3", rows=1840221, duration_s=700)


@item(id="carrier_maintenance", n=13, group="spikes", title="Carrier maintenance window",
      when="01:00 to 01:15 UTC", looks_like="A carrier outage",
      example="The carrier API returns 503 for about 90% of calls. ThirdPartyErrors fires. "
              "Delivery logs 'will retry in 5 min' for each new shipment.",
      truth="The carrier has a planned maintenance window every night from 01:00 to 01:15. "
            "Delivery retries the bookings. All shipments are booked by 01:20. This happens every night.")
def carrier_maintenance(g, c):
    R = g.R
    s, e = idx(1), idx(1, 15)
    lab = {"provider": "carrier"}
    err, lat = c.base("third_party_error_rate", **lab), c.base("third_party_latency_p95_ms", **lab)
    paid = c.base("kafka_messages_in_per_min", topic="order.paid")
    upd = {"topic": "delivery.updated"}
    for i in range(s, e):
        c.add("third_party_error_rate", lab, i, R.uniform(84, 96) - err[i])
        c.add("third_party_latency_p95_ms", lab, i, R.uniform(110, 160) - lat[i])
        # The first try (already in the baseline) fails. Delivery tries again every 5 min until
        # the window ends. The booking, and its delivery.updated event, move to that minute.
        n, fails, j = paid[i], 1, i + 5
        while j < e:
            c.add("third_party_requests_per_min", lab, j, n)
            fails, j = fails + 1, j + 5
        c.add("third_party_requests_per_min", lab, j, n)
        c.add("kafka_messages_in_per_min", upd, i, -min(n, c.base("kafka_messages_in_per_min", **upd)[i]))
        c.add("kafka_messages_in_per_min", upd, j, n)
        for _ in range(n):
            if R.random() > 0.25:  # logs are a sample, like the baseline
                continue
            oid, t = g.order_id(), R.uniform(0, 59)
            g.log(g.at(i, t), "delivery", "warn", "carrier error, will retry in 5 min",
                  order_id=oid, error="503 Service Unavailable: scheduled maintenance")
            g.log(g.at(j, t + R.uniform(0.2, 0.9)), "delivery", "info", "carrier booked after retry", order_id=oid,
                  shipment_id="shp_" + g.hexid(8), attempts=fails + 1)
    c.fire_for("ThirdPartyErrors", "serious", "third_party_error_rate", lab, lambda v: v > 5, 5,
               "third_party_error_rate{{provider=carrier}} {v:.0f}% > 5% for 5m")


@item(id="newsletter_spike", n=14, group="spikes", title="Newsletter traffic spike",
      when="10:00 to 10:30 UTC", looks_like="A DDoS attack, or a bad rate-limit config",
      example="Gateway traffic almost doubles for about 20 minutes. Catalog traffic goes up 2 times. "
              "CPU goes up. Error rate and latency stay normal. Checkouts stay normal.",
      truth="Marketing sent the Black Friday preview newsletter at 10:00. The links have "
            "utm_campaign=black_friday_preview. It is not in the change log, because marketing sends it from "
            "their own tool. The shop handles the load.")
def newsletter_spike(g, c):
    R = g.R
    s = idx(10)

    def x(i):
        t = i - s
        return 0 if t < 0 else (t + 1) / 5 if t < 5 else 1 if t < 16 else max(0, (30 - t) / 14)

    for i in range(s, s + 30):
        gw = 0.0
        for svc, k in (("catalog", 1.1), ("auth", 0.5), ("cart", 0.6)):
            lab = {"service": svc}
            d = c.base("http_requests_per_second", **lab)[i] * k * x(i)
            gw += d
            c.add("http_requests_per_second", lab, i, d)
            cpu = c.base("cpu_pct", **lab)[i]
            c.add("cpu_pct", lab, i, min(95 - cpu, g.SERVICES[svc]["cpu"][1] * g.LOAD[i] * k * x(i)))
            c.add("http_latency_p95_ms", lab, i, c.base("http_latency_p95_ms", **lab)[i] * 0.12 * k * x(i))
        c.add("http_requests_per_second", {"service": "gateway"}, i, gw)
        for n in range(1, 5):
            c.add("node_cpu_pct", {"node": f"node-{n}"}, i, 10 * x(i))
    cats = ["shoes", "jackets", "bags", "toys"]
    for _ in range(40):
        i = s + min(29, int(R.expovariate(1 / 7)))
        g.request(g.at(i, R.uniform(0, 59)), "GET /products", "catalog",
                  [("pg SELECT products (replica)", "client", 9, {"db": "catalog-replica"})],
                  msg="listed products", category=R.choice(cats), count=24,
                  utm_source="newsletter", utm_campaign="black_friday_preview")


@item(id="price_scraper", n=15, group="spikes", title="Price scraper hits the rate limit",
      when="Every hour at :07", looks_like="An attack",
      example="Every hour, gateway traffic and 4xx rate jump for 2 minutes. Catalog traffic goes up. "
              "Gateway logs 'rate limited' (429) lines from one IP.",
      truth="A price comparison site reads product prices once an hour from one IP (user agent PriceGrabber/2.1). "
            "It sends 65 to 90 requests per second. The gateway lets 50 per second through to Catalog "
            "(60 after the 22:15 config change) and blocks the rest with 429. The list pages come from the "
            "cache, so Catalog CPU goes up only a little. No customer is affected. "
            "429 is not an error.")
def price_scraper(g, c):
    R = g.R
    ip, ua = "ip_5e21c0", "Mozilla/5.0 (compatible; PriceGrabber/2.1)"
    G, C = {"service": "gateway"}, {"service": "catalog"}
    rps, r4 = c.base("http_requests_per_second", **G), c.base("http_4xx_rate", **G)
    crps, ccpu = c.base("http_requests_per_second", **C), c.base("cpu_pct", **C)
    change = next(x["minute"] for x in g.CONFIG_CHANGES if "Rate limit" in x["summary"])
    for h in range(24):
        for k, f in ((0, 1.0), (1, 0.6)):
            i = h * 60 + 7 + k
            lim = 50 if i < change else 60  # per IP, req/s
            b = lim + R.uniform(15, 30) * f
            blocked = b - lim
            c.add("http_requests_per_second", G, i, b)
            c.add("http_4xx_rate", G, i, (r4[i] * rps[i] + 100 * blocked) / (rps[i] + b) - r4[i])
            c.add("http_requests_per_second", C, i, lim)
            # Product list pages come from the cache: about 1/3 of the CPU of a normal request.
            c.add("cpu_pct", C, i, min(85 - ccpu[i], g.SERVICES["catalog"]["cpu"][1] * g.LOAD[i] * lim / crps[i] / 3))
            for _ in range(2 if k == 0 else 1):
                t = g.at(i, R.uniform(0, 59))
                tid, spans = g.hexid(32), []
                gw = g.span(spans, tid, None, "gateway", "GET /products", t, R.uniform(0.3, 1), http_status=429)
                g.log(g.end(gw), "gateway", "warn", "rate limited", gw, route="GET /products",
                      client_ip=ip, user_agent=ua)
                g.access_log(gw)
                g.TRACES.append(spans)
