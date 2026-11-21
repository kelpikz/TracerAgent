#!/usr/bin/env python3
"""Make seeded telemetry for the shop.

Scenario "baseline": all services are healthy. Use it as "normal".

Run:   python seed/generate.py                  baseline, and noise.js for the dashboard toggles
       python seed/generate.py --noise all      also data/noisy/ with all noise items applied
       python seed/generate.py --noise nightly_backup,price_scraper --name my_case
Out:   data/<scenario>/  metrics.json, logs.jsonl, traces.json, orders.json,
                         events.json, alerts.json, topology.json, data.js
       data/baseline/noise.js     noise overlays (see seed/noise.py)
       data/<noisy>/labels.json   the truth for each noise item. For grading. Do not give it to the agent.

Same seed = same data, every time. Standard library only.
"""
import json
import math
import os
import random
import sys
from datetime import datetime, timedelta, timezone

SEED = 42
SCENARIO = "baseline"
START = datetime(2026, 11, 19, 12, 0, tzinfo=timezone.utc)
MINUTES = 24 * 60  # one point per minute
END = START + timedelta(minutes=MINUTES)
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "data", SCENARIO)

R = random.Random(SEED)


# ---------------------------------------------------------------- helpers
def at(i, sec=0.0):
    return START + timedelta(minutes=i, seconds=sec)


def ms(t, x):
    return t + timedelta(milliseconds=x)


def iso(t):
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def jit(x, pct):
    return x * (1 + R.gauss(0, pct))


def clamp(x, lo, hi):
    return max(lo, min(hi, x))


def hexid(n):
    return "%0*x" % (n, R.getrandbits(n * 4))


def poisson(lam):
    if lam <= 0:
        return 0
    limit, k, p = math.exp(-lam), 0, 1.0
    while True:
        p *= R.random()
        if p <= limit:
            return k
        k += 1


def binom(n, p):
    return sum(1 for _ in range(n) if R.random() < p)


def rate(bad, total):
    return 0.0 if total == 0 else 100.0 * bad / total


def order_id():
    return "ord_" + "".join(R.choice("23456789ABCDEFGHJKLMNPQRSTUVWXYZ") for _ in range(6))


def user_id():
    return f"u_{R.randint(10000, 99999)}"


def product_id():
    return f"p_{R.randint(1000, 4999)}"


def pick_times(n):
    """n random times, more of them when traffic is high."""
    mins = R.choices(range(MINUTES), weights=LOAD, k=n)
    return sorted(at(m, R.uniform(0, 59.9)) for m in mins)


# ---------------------------------------------------------------- traffic shape
def build_load():
    """0.3 at 04:00 UTC, 1.0 at 16:00 UTC, with a small random walk."""
    out, walk = [], 0.0
    for i in range(MINUTES):
        t = at(i)
        h = t.hour + t.minute / 60
        base = 0.3 + 0.7 * (0.5 - 0.5 * math.cos(2 * math.pi * (h - 4) / 24))
        walk = clamp(walk * 0.97 + R.gauss(0, 0.01), -0.06, 0.06)
        out.append(clamp(base * (1 + walk), 0.2, 1.1))
    return out


LOAD = build_load()

# ---------------------------------------------------------------- changes
DEPLOYS = [
    {"service": "catalog", "version": "v1.8.2", "previous": "v1.8.1", "minute": 125,
     "summary": "Show delivery estimate on product page"},
    {"service": "notification", "version": "v0.9.4", "previous": "v0.9.3", "minute": 930,
     "summary": "New email template for shipped orders"},
    {"service": "cart", "version": "v2.1.0", "previous": "v2.0.7", "minute": 1300,
     "summary": "Upgrade Redis client library"},
]
CONFIG_CHANGES = [
    {"service": "gateway", "minute": 615,
     "summary": "Rate limit for GET /products: 50 to 60 req/s per IP"},
]

# ---------------------------------------------------------------- topology
SERVICES = {
    # share of gateway traffic, base p95 ms, base 5xx %, cpu (base, per load), memory (base MB, limit MB)
    "auth":         {"share": 0.10, "p95": 45,  "err": 0.08, "cpu": (8, 25),  "mem": (180, 512), "pods": 2},
    "catalog":      {"share": 0.55, "p95": 60,  "err": 0.04, "cpu": (12, 45), "mem": (310, 768), "pods": 3},
    "cart":         {"share": 0.18, "p95": 14,  "err": 0.04, "cpu": (6, 20),  "mem": (140, 512), "pods": 2},
    "order":        {"share": 0.05, "p95": 420, "err": 0.08, "cpu": (8, 22),  "mem": (260, 768), "pods": 2},
    "payment":      {"share": 0.04, "p95": 340, "err": 0.08, "cpu": (6, 18),  "mem": (220, 512), "pods": 2},
    "delivery":     {"share": 0.02, "p95": 95,  "err": 0.10, "cpu": (4, 12),  "mem": (200, 512), "pods": 2},
    "notification": {"share": 0.01, "p95": 30,  "err": 0.05, "cpu": (5, 15),  "mem": (170, 512), "pods": 2},
}
PEAK_RPS = 125  # gateway requests per second at the daily peak

TOPOLOGY = {
    "services": list(SERVICES) + ["gateway"],
    "edges": [
        {"from": "gateway", "to": s, "type": "http"} for s in ["auth", "catalog", "cart", "order", "payment", "delivery"]
    ] + [
        {"from": "order", "to": "catalog", "type": "http", "note": "reserve / release stock"},
        {"from": "order", "to": "payment", "type": "http", "note": "create payment"},
        {"from": "payment", "to": "stripe", "type": "http"},
        {"from": "stripe", "to": "payment", "type": "webhook"},
        {"from": "delivery", "to": "carrier", "type": "http"},
        {"from": "carrier", "to": "delivery", "type": "webhook"},
        {"from": "notification", "to": "email", "type": "http"},
        {"from": "auth", "to": "postgres:users", "type": "db"},
        {"from": "catalog", "to": "postgres:catalog", "type": "db", "note": "reads use the replica"},
        {"from": "cart", "to": "redis", "type": "db"},
        {"from": "order", "to": "postgres:orders", "type": "db"},
        {"from": "payment", "to": "postgres:payments", "type": "db"},
        {"from": "delivery", "to": "postgres:shipments", "type": "db"},
    ],
    "kafka": {
        "topics": ["order.created", "payment.succeeded", "order.paid", "delivery.updated"],
        "producers": {"order.created": "order", "payment.succeeded": "payment",
                      "order.paid": "order", "delivery.updated": "delivery"},
        "consumer_groups": {
            "order": ["payment.succeeded", "delivery.updated"],
            "delivery": ["order.paid"],
            "notification": ["order.created", "order.paid", "delivery.updated"],
        },
    },
    "endpoints": [
        # service, route, share of that service's traffic, p95 ms, 5xx %
        {"service": "auth", "route": "POST /auth/login", "share": 0.45, "p95_ms": 95, "error_pct": 0.08},
        {"service": "auth", "route": "POST /auth/refresh", "share": 0.40, "p95_ms": 9, "error_pct": 0.05},
        {"service": "auth", "route": "POST /auth/signup", "share": 0.15, "p95_ms": 110, "error_pct": 0.05},
        {"service": "catalog", "route": "GET /products", "share": 0.48, "p95_ms": 62, "error_pct": 0.03},
        {"service": "catalog", "route": "GET /products/:id", "share": 0.48, "p95_ms": 52, "error_pct": 0.03},
        {"service": "catalog", "route": "POST /stock/reserve", "share": 0.03, "p95_ms": 14, "error_pct": 0.05},
        {"service": "catalog", "route": "PUT /admin/products/:id", "share": 0.01, "p95_ms": 18, "error_pct": 0.0},
        {"service": "cart", "route": "GET /cart", "share": 0.45, "p95_ms": 6, "error_pct": 0.03},
        {"service": "cart", "route": "POST /cart/items", "share": 0.42, "p95_ms": 9, "error_pct": 0.04},
        {"service": "cart", "route": "DELETE /cart/items/:id", "share": 0.13, "p95_ms": 8, "error_pct": 0.04},
        {"service": "order", "route": "POST /checkout", "share": 0.40, "p95_ms": 430, "error_pct": 0.10},
        {"service": "order", "route": "GET /orders/:id", "share": 0.60, "p95_ms": 22, "error_pct": 0.03},
        {"service": "payment", "route": "POST /payments", "share": 0.50, "p95_ms": 380, "error_pct": 0.08},
        {"service": "payment", "route": "POST /webhooks/stripe", "share": 0.50, "p95_ms": 18, "error_pct": 0.02},
        {"service": "delivery", "route": "POST /webhooks/carrier", "share": 0.70, "p95_ms": 20, "error_pct": 0.05},
        {"service": "delivery", "route": "GET /shipments/:id", "share": 0.30, "p95_ms": 15, "error_pct": 0.05},
    ],
}

# ---------------------------------------------------------------- metrics
SERIES = []


def add(name, labels, unit, values, nd=2, limit=None):
    vals = [int(round(v)) for v in values] if nd == 0 else [round(v, nd) for v in values]
    s = {"name": name, "labels": labels, "unit": unit, "values": vals}
    if limit is not None:
        s["limit"] = limit
    SERIES.append(s)
    return vals


def lagged(arr, k):
    return [arr[max(0, i - k)] for i in range(len(arr))]


def build_metrics():
    M = {}
    deploy_at = {d["service"]: d["minute"] for d in DEPLOYS}

    # ---- per service (RED + resources)
    gw_rps, gw_err_w = [0.0] * MINUTES, [0.0] * MINUTES
    for name, c in SERVICES.items():
        rps, err, p95, p99, cpu, mem, restarts = [], [], [], [], [], [], []
        mem_base, mem_limit = c["mem"]
        m = mem_base
        dmin = deploy_at.get(name)
        for i, L in enumerate(LOAD):
            v = max(0.05, jit(PEAK_RPS * c["share"] * L, 0.05))
            req_min = max(1, int(v * 60))
            e = rate(poisson(req_min * c["err"] / 100), req_min)  # real counts: low traffic = spiky
            q = jit(c["p95"] * (0.85 + 0.3 * L), 0.06)
            cp = jit(c["cpu"][0] + c["cpu"][1] * L, 0.07)
            if dmin is not None and dmin <= i < dmin + 3:  # rollout: new pods warm up
                cp += 8
                q *= 1.15
            if dmin == i:
                m = mem_base * 0.9  # new pods start with less memory
            m += R.uniform(-0.5, 0.8)
            if m > mem_base * 1.12:  # garbage collection
                m = mem_base * 0.97
            rps.append(v); err.append(e); p95.append(q); p99.append(q * R.uniform(1.6, 2.1))
            cpu.append(clamp(cp, 1, 95)); mem.append(m); restarts.append(0)
            gw_rps[i] += v
            gw_err_w[i] += v * e
        lab = {"service": name}
        add("http_requests_per_second", lab, "req/s", rps)
        add("http_error_rate", lab, "%", err, nd=3)
        add("http_latency_p95_ms", lab, "ms", p95, nd=1)
        add("http_latency_p99_ms", lab, "ms", p99, nd=1)
        add("cpu_pct", lab, "%", cpu, nd=1)
        add("memory_mb", lab, "MB", mem, nd=1, limit=mem_limit)
        add("pod_restarts", lab, "count", restarts, nd=0)
        add("pods_ready", lab, "count", [c["pods"]] * MINUTES, nd=0)

    # ---- gateway
    lab = {"service": "gateway"}
    add("http_requests_per_second", lab, "req/s", gw_rps)
    add("http_error_rate", lab, "%", [w / r_ for w, r_ in zip(gw_err_w, gw_rps)], nd=3)
    add("http_4xx_rate", lab, "%", [clamp(jit(1.9, 0.12), 0.8, 3.5) for _ in LOAD], nd=2)
    add("http_latency_p95_ms", lab, "ms", [jit(70 * (0.85 + 0.3 * L), 0.06) for L in LOAD], nd=1)

    # ---- business: checkout
    attempts = [poisson(38 * L) for L in LOAD]
    declines = [binom(a, 0.026) for a in attempts]
    stock_fail = [min(a, poisson(0.08 * L)) for a, L in zip(attempts, LOAD)]
    errs = [binom(a, 0.001) for a in attempts]
    ok = [a - d - s - e for a, d, s, e in zip(attempts, declines, stock_fail, errs)]
    M["ok"] = ok
    add("checkout_attempts_per_min", {}, "count", attempts, nd=0)
    add("checkout_success_rate", {}, "%", [100 - rate(a - o, a) for a, o in zip(attempts, ok)])
    pay_tries = [a - s for a, s in zip(attempts, stock_fail)]
    add("payment_success_rate", {}, "%", [100 - rate(d + e, p) for d, e, p in zip(declines, errs, pay_tries)])
    add("orders_pending", {}, "count", [poisson(o * 0.09) for o in ok], nd=0)
    add("orders_stuck_pending_15m", {}, "count", [0] * MINUTES, nd=0)
    add("order_outbox_unpublished", {}, "count", [poisson(0.3 * L) for L in LOAD], nd=0)

    # ---- auth
    logins = [poisson(70 * L) for L in LOAD]
    fails = [binom(n, 0.07) for n in logins]
    add("auth_login_success_rate", {}, "%", [100 - rate(f, n) for f, n in zip(fails, logins)])
    add("auth_failed_logins_max_per_ip", {}, "count",
        [0 if f == 0 else min(f, R.choice([1, 1, 1, 2, 2, 3])) for f in fails], nd=0)
    add("auth_signups_per_min", {}, "count", [poisson(0.9 * L) for L in LOAD], nd=0)
    add("auth_token_refresh_errors_per_min", {}, "count", [poisson(0.02) for _ in LOAD], nd=0)

    # ---- catalog
    add("catalog_product_page_p95_ms", {}, "ms", [jit(52 * (0.85 + 0.3 * L), 0.06) for L in LOAD], nd=1)
    add("catalog_stock_reserve_failures_per_min", {}, "count", stock_fail, nd=0)
    admin = [poisson(0.12) if 9 <= at(i).hour < 18 else 0 for i in range(MINUTES)]
    M["admin"] = admin
    add("catalog_admin_changes_per_min", {}, "count", admin, nd=0)

    # ---- cart
    add("cart_errors_per_min", {}, "count", [poisson(0.03) for _ in LOAD], nd=0)

    # ---- postgres
    dbs = [  # db, query p95 ms, base connections, disk % at start, disk growth % per day
        ("users", 3.5, 10, 22.0, 0.04),
        ("catalog", 5.0, 24, 38.0, 0.08),
        ("orders", 4.5, 16, 47.0, 0.22),
        ("payments", 4.0, 9, 31.0, 0.12),
        ("shipments", 3.0, 7, 26.0, 0.10),
    ]
    for db, q, conn, disk0, grow in dbs:
        lab = {"db": db}
        busy = db in ("catalog", "orders")
        add("pg_up", lab, "bool", [1] * MINUTES, nd=0)
        add("pg_query_p95_ms", lab, "ms", [jit(q * (0.8 + 0.4 * L), 0.1) for L in LOAD])
        add("pg_connections_used", lab, "count",
            [clamp(jit(conn * (0.6 + 0.6 * L), 0.08), 2, 100) for L in LOAD], nd=0, limit=100)
        add("pg_disk_used_pct", lab, "%", [disk0 + grow * i / MINUTES + R.gauss(0, 0.003) for i in range(MINUTES)], nd=3)
        add("pg_slow_queries_per_min", lab, "count", [poisson(0.02 + (0.12 * L if busy else 0)) for L in LOAD], nd=0)
    add("pg_replication_lag_s", {"db": "catalog"}, "s", [clamp(jit(0.25 + 0.35 * L, 0.4), 0.05, 1.8) for L in LOAD])

    # ---- redis
    add("redis_up", {}, "bool", [1] * MINUTES, nd=0)
    mem, m = [], 480 + 320 * LOAD[0]
    for L in LOAD:
        m = 0.995 * m + 0.005 * (480 + 320 * L) + R.gauss(0, 0.8)
        mem.append(m)
    add("redis_memory_used_mb", {}, "MB", mem, nd=1, limit=2048)
    add("redis_latency_p95_ms", {}, "ms", [jit(0.7 + 0.3 * L, 0.1) for L in LOAD], nd=3)

    # ---- kafka
    lag6 = lagged(ok, 6 * 60)
    shipped = [poisson(0.5 * x) for x in lag6]
    def spill(arr, p):
        """Events a few seconds later can fall into the next minute."""
        out = list(arr)
        for i in range(len(arr) - 1):
            k = binom(arr[i], p)
            out[i] -= k
            out[i + 1] += k
        return out

    topic_rate = {
        "order.created": ok,
        "payment.succeeded": spill(ok, 0.08),
        "order.paid": spill(ok, 0.10),
        "delivery.updated": [o + s + poisson(3 * L) for o, s, L in zip(ok, shipped, LOAD)],
    }
    for t, v in topic_rate.items():
        add("kafka_messages_in_per_min", {"topic": t}, "count", v, nd=0)
    groups = {
        "order": [a + b for a, b in zip(topic_rate["payment.succeeded"], topic_rate["delivery.updated"])],
        "delivery": topic_rate["order.paid"],
        "notification": [a + b + c for a, b, c in zip(ok, ok, topic_rate["delivery.updated"])],
    }
    for g, v in groups.items():
        add("kafka_consumer_lag", {"group": g}, "count", [poisson(x * 0.03) for x in v], nd=0)
        # 2 old messages sit in the notification DLQ since last week. Flat = normal.
        add("kafka_dlq_size", {"group": g}, "count", [2 if g == "notification" else 0] * MINUTES, nd=0)

    # ---- third parties
    emails = [2 * o + s for o, s in zip(ok, shipped)]
    tp = {  # provider: (requests per min, p95 ms, error %)
        "stripe": ([int(a * 1.02) for a in attempts], 360, 0.10),
        "carrier": ([poisson(o * 1.05 + 2) for o in ok], 650, 0.40),
        "email": (emails, 220, 0.05),
    }
    for p, (reqs, p95, e) in tp.items():
        lab = {"provider": p}
        add("third_party_requests_per_min", lab, "count", reqs, nd=0)
        add("third_party_error_rate", lab, "%", [rate(binom(n, e / 100), n) for n in reqs], nd=3)
        add("third_party_latency_p95_ms", lab, "ms", [jit(p95 * (0.9 + 0.2 * L), 0.08) for L in LOAD], nd=1)
    add("webhooks_received_per_min", {"provider": "stripe"}, "count", [poisson(a * 0.99) for a in attempts], nd=0)
    add("webhooks_received_per_min", {"provider": "carrier"}, "count", [poisson(6 * L + 1) for L in LOAD], nd=0)
    for p in ("stripe", "carrier"):
        add("webhook_bad_signatures_per_min", {"provider": p}, "count", [0] * MINUTES, nd=0)

    # ---- delivery
    add("delivery_shipments_no_update_24h", {}, "count", [0] * MINUTES, nd=0)
    late, v = [], 1.3
    for _ in LOAD:
        v = clamp(v + R.gauss(0, 0.004), 1.0, 1.6)
        late.append(v)
    add("delivery_late_pct", {}, "%", late)

    # ---- notification
    failed = [poisson(0.01) for _ in LOAD]
    add("emails_sent_per_min", {}, "count", [max(0, e - f) for e, f in zip(emails, failed)], nd=0)
    add("emails_failed_per_min", {}, "count", failed, nd=0)
    add("email_bounces_per_min", {}, "count", [poisson(0.03) for _ in LOAD], nd=0)
    add("notification_event_to_email_p95_s", {}, "s", [jit(2.8 + 0.8 * L, 0.12) for L in LOAD])

    # ---- nodes
    for n in range(1, 5):
        lab = {"node": f"node-{n}"}
        add("node_up", lab, "bool", [1] * MINUTES, nd=0)
        add("node_cpu_pct", lab, "%", [clamp(jit(18 + 40 * L, 0.08), 2, 95) for L in LOAD], nd=1)
    return M


# ---------------------------------------------------------------- traces + logs
TRACES, LOGS, ORDERS = [], [], []


def span(spans, tid, parent, service, name, start, dur=0.0, status="ok", kind="server", **attrs):
    s = {"trace_id": tid, "span_id": hexid(16), "parent_id": parent["span_id"] if parent else None,
         "service": service, "name": name, "kind": kind, "start": start, "duration_ms": dur,
         "status": status, "attrs": attrs}
    spans.append(s)
    return s


def end(s):
    return ms(s["start"], s["duration_ms"])


def log(t, service, level, msg, s=None, **fields):
    e = {"ts": t, "service": service, "level": level, "msg": msg}
    if s:
        e["trace_id"] = s["trace_id"]
        e["span_id"] = s["span_id"]
    e.update(fields)
    LOGS.append(e)


def access_log(gw):
    st = gw["attrs"].get("http_status", 200)
    level = "error" if st >= 500 else "warn" if st == 429 else "info"
    log(end(gw), "gateway", level, "request", gw, route=gw["name"], status=st,
        latency_ms=round(gw["duration_ms"], 1))


def run_steps(spans, tid, parent, service, steps, t0):
    """Child calls one after another. steps: (name, kind, ms, attrs). Returns time used in ms."""
    cur = R.uniform(0.4, 1.5)
    for name, kind, d, a in steps:
        a = dict(a)
        exact = a.pop("_exact", False)
        st = a.pop("_status", "ok")
        d = d if exact else max(0.1, jit(d, 0.25))
        span(spans, tid, parent, service, name, ms(t0, cur), d, status=st, kind=kind, **a)
        cur += d + R.uniform(0.2, 0.9)
    return cur


def request(t0, route, service, steps, status=200, msg=None, level="info", err=None, **attrs):
    """gateway -> one service -> its client calls."""
    tid, spans = hexid(32), []
    gw = span(spans, tid, None, "gateway", route, t0, http_status=status)
    s0 = ms(t0, R.uniform(0.4, 1.5))
    sv = span(spans, tid, gw, service, route, s0, status="error" if status >= 500 else "ok",
              http_status=status, **attrs)
    used = run_steps(spans, tid, sv, service, steps, s0)
    sv["duration_ms"] = used + R.uniform(0.5, 3)
    gw["duration_ms"] = sv["duration_ms"] + R.uniform(0.8, 3)
    if status >= 500:
        gw["status"] = "error"
    if msg:
        extra = {"error": err} if err else {}
        log(end(sv), service, level, msg, sv, status=status, **attrs, **extra)
    access_log(gw)
    TRACES.append(spans)
    return spans


def publish(spans, tid, parent, service, topic, t):
    return span(spans, tid, parent, service, f"kafka publish {topic}", t, jit(3, 0.3), kind="producer", topic=topic)


def consume(spans, tid, pub, service, topic, lag_ms, steps):
    t = ms(end(pub), lag_ms)
    cs = span(spans, tid, pub, service, f"kafka consume {topic}", t, kind="consumer", topic=topic)
    cs["duration_ms"] = run_steps(spans, tid, cs, service, steps, t) + R.uniform(0.5, 2)
    return cs


def email(spans, tid, pub, topic, template, oid, tl):
    cs = consume(spans, tid, pub, "notification", topic, R.uniform(20, 400),
                 [("email POST /v3/mail/send", "client", 210, {"peer": "email", "template": template})])
    if R.random() < 0.005:
        log(end(cs), "notification", "warn", "email soft bounce, provider will retry", cs,
            template=template, order_id=oid)
    else:
        log(end(cs), "notification", "info", "email sent", cs, template=template, order_id=oid)
    tl.append((end(cs), "notification", f"email sent: {template}", tid))


def carrier_update(t0, oid, ship_id, status, template, tl):
    tid, spans = hexid(32), []
    gw = span(spans, tid, None, "gateway", "POST /webhooks/carrier", t0, http_status=200)
    s0 = ms(t0, R.uniform(0.4, 1.5))
    sv = span(spans, tid, gw, "delivery", "POST /webhooks/carrier", s0, http_status=200,
              order_id=oid, shipment_id=ship_id, carrier_status=status)
    used = run_steps(spans, tid, sv, "delivery", [
        ("verify signature", "internal", 0.3, {}),
        ("pg UPDATE shipments", "client", 4, {"db": "shipments"}),
        ("pg INSERT outbox", "client", 2, {"db": "shipments"}),
    ], s0)
    sv["duration_ms"] = used + R.uniform(0.5, 2)
    gw["duration_ms"] = sv["duration_ms"] + R.uniform(0.8, 3)
    log(end(sv), "delivery", "info", "shipment status updated", sv, order_id=oid,
        shipment_id=ship_id, carrier_status=status)
    access_log(gw)
    tl.append((end(sv), "delivery", f"carrier status: {status}", tid))
    pub = publish(spans, tid, sv, "delivery", "delivery.updated", ms(end(sv), R.uniform(100, 900)))
    oc = consume(spans, tid, pub, "order", "delivery.updated", R.uniform(20, 400),
                 [("pg UPDATE orders", "client", 4, {"db": "orders"})])
    log(end(oc), "order", "info", "order status changed", oc, order_id=oid, status=status)
    tl.append((end(oc), "order", f"status {status}", tid))
    email(spans, tid, pub, "delivery.updated", template, oid, tl)
    TRACES.append(spans)


def checkout(t0, decline=None):
    tid, spans, tl = hexid(32), [], []
    oid, uid = order_id(), user_id()
    amount, items = round(R.uniform(12, 240), 2), R.randint(1, 4)
    declined = R.random() < 0.026 if decline is None else decline
    status = 402 if declined else 201
    pay_id = "pay_" + hexid(10)

    gw = span(spans, tid, None, "gateway", "POST /checkout", t0, http_status=status)
    o0 = ms(t0, R.uniform(0.4, 1.5))
    o = span(spans, tid, gw, "order", "POST /checkout", o0, http_status=status, order_id=oid, user_id=uid)
    cur = run_steps(spans, tid, o, "order", [("pg INSERT orders", "client", 4.5, {"db": "orders"})], o0)
    tl.append((ms(o0, cur), "order", "order created (status NEW)", tid))

    c0 = ms(o0, cur)
    c = span(spans, tid, o, "catalog", "POST /stock/reserve", c0, http_status=200, order_id=oid, items=items)
    c["duration_ms"] = run_steps(spans, tid, c, "catalog",
                                 [("pg UPDATE stock", "client", 6, {"db": "catalog"})], c0) + R.uniform(1, 3)
    log(end(c), "catalog", "info", "stock reserved", c, order_id=oid, items=items)
    tl.append((end(c), "catalog", "stock reserved", tid))
    cur += c["duration_ms"] + 0.5

    p0 = ms(o0, cur)
    p = span(spans, tid, o, "payment", "POST /payments", p0, http_status=status,
             order_id=oid, payment_id=pay_id, amount=amount, currency="EUR")
    p["duration_ms"] = run_steps(spans, tid, p, "payment", [
        ("stripe POST /v1/payment_intents", "client", 330, {"peer": "stripe", "http_status": 402 if declined else 200}),
        ("pg INSERT payments", "client", 4, {"db": "payments"}),
    ], p0) + R.uniform(1, 2)
    cur += p["duration_ms"] + 0.5

    if declined:
        code = R.choice(["insufficient_funds", "card_declined", "expired_card"])
        log(end(p), "payment", "warn", "card declined", p, order_id=oid, payment_id=pay_id, decline_code=code)
        tl.append((end(p), "payment", f"card declined ({code})", tid))
        r0 = ms(o0, cur)
        rel = span(spans, tid, o, "catalog", "POST /stock/release", r0, http_status=200, order_id=oid)
        rel["duration_ms"] = run_steps(spans, tid, rel, "catalog",
                                       [("pg UPDATE stock", "client", 6, {"db": "catalog"})], r0) + 1
        cur += rel["duration_ms"] + 0.5
        u0 = ms(o0, cur)
        cur += run_steps(spans, tid, o, "order", [("pg UPDATE orders", "client", 4, {"db": "orders"})], u0)
        o["duration_ms"] = cur + R.uniform(1, 3)
        log(end(o), "order", "info", "checkout failed: payment declined", o, order_id=oid, status="PAYMENT_FAILED")
        tl.append((end(o), "order", "status PAYMENT_FAILED", tid))
        final = "PAYMENT_FAILED"
    else:
        log(end(p), "payment", "info", "payment intent created", p, order_id=oid, payment_id=pay_id, amount=amount)
        tl.append((end(p), "payment", "payment intent created", tid))
        u0 = ms(o0, cur)
        cur += run_steps(spans, tid, o, "order", [
            ("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})], u0)
        o["duration_ms"] = cur + R.uniform(1, 3)
        log(end(o), "order", "info", "order created", o, order_id=oid, status="PENDING", amount=amount)
        tl.append((end(o), "order", "status PENDING", tid))
        final = "PENDING"
    gw["duration_ms"] = o["duration_ms"] + R.uniform(0.8, 3)
    access_log(gw)

    if declined:
        TRACES.append(spans)
        return finish_order(oid, uid, t0, amount, items, final, tl)

    # order.created -> "order received" email
    pub = publish(spans, tid, o, "order", "order.created", ms(end(o), R.uniform(150, 1200)))
    tl.append((end(pub), "order", "event published: order.created", tid))
    email(spans, tid, pub, "order.created", "order_received", oid, tl)
    TRACES.append(spans)

    # Stripe webhook: new trace from outside
    tid2, sp2 = hexid(32), []
    w0 = ms(end(gw), R.uniform(1500, 6000))
    g2 = span(sp2, tid2, None, "gateway", "POST /webhooks/stripe", w0, http_status=200)
    s0 = ms(w0, R.uniform(0.4, 1.5))
    sv = span(sp2, tid2, g2, "payment", "POST /webhooks/stripe", s0, http_status=200,
              event_type="payment_intent.succeeded", payment_id=pay_id, order_id=oid)
    sv["duration_ms"] = run_steps(sp2, tid2, sv, "payment", [
        ("verify signature", "internal", 0.3, {}),
        ("pg UPDATE payments", "client", 4, {"db": "payments"}),
        ("pg INSERT outbox", "client", 2, {"db": "payments"}),
    ], s0) + R.uniform(0.5, 2)
    g2["duration_ms"] = sv["duration_ms"] + R.uniform(0.8, 3)
    log(end(sv), "payment", "info", "webhook received", sv, event_type="payment_intent.succeeded",
        payment_id=pay_id, order_id=oid)
    access_log(g2)
    tl.append((end(sv), "payment", "Stripe webhook: payment_intent.succeeded", tid2))

    pub = publish(sp2, tid2, sv, "payment", "payment.succeeded", ms(end(sv), R.uniform(100, 900)))
    oc = consume(sp2, tid2, pub, "order", "payment.succeeded", R.uniform(20, 400), [
        ("pg UPDATE orders + INSERT outbox", "client", 5, {"db": "orders"})])
    log(end(oc), "order", "info", "order status changed", oc, order_id=oid, status="PAID")
    tl.append((end(oc), "order", "status PAID", tid2))
    paid_at = end(oc)

    pub = publish(sp2, tid2, oc, "order", "order.paid", ms(end(oc), R.uniform(100, 900)))
    tl.append((end(pub), "order", "event published: order.paid", tid2))
    email(sp2, tid2, pub, "order.paid", "order_confirmed", oid, tl)

    ship_id = "shp_" + hexid(8)
    steps = []
    if R.random() < 0.03:  # carrier timeout, then retry works. Normal.
        steps.append(("carrier POST /shipments", "client", 5000,
                      {"peer": "carrier", "_exact": True, "_status": "error", "error": "timeout after 5000ms"}))
    steps += [("carrier POST /shipments", "client", 620, {"peer": "carrier", "http_status": 201}),
              ("pg INSERT shipments + outbox", "client", 5, {"db": "shipments"})]
    dc = consume(sp2, tid2, pub, "delivery", "order.paid", R.uniform(20, 400), steps)
    if len(steps) == 3:
        log(ms(dc["start"], 5001), "delivery", "warn", "carrier timeout, retry 1/3", dc, order_id=oid)
    eta = (paid_at + timedelta(days=R.randint(2, 4))).strftime("%Y-%m-%d")
    log(end(dc), "delivery", "info", "carrier booked", dc, order_id=oid, shipment_id=ship_id,
        carrier=R.choice(["DHL", "UPS", "DPD"]), eta=eta)
    tl.append((end(dc), "delivery", f"carrier booked, ETA {eta}", tid2))
    publish(sp2, tid2, dc, "delivery", "delivery.updated", ms(end(dc), R.uniform(100, 900)))
    TRACES.append(sp2)
    final = "PAID"

    t_ship = paid_at + timedelta(hours=R.uniform(3, 9))
    if t_ship < END:
        carrier_update(t_ship, oid, ship_id, "SHIPPED", "order_shipped", tl)
        final = "SHIPPED"
        t_del = t_ship + timedelta(hours=R.uniform(14, 26))
        if t_del < END:
            carrier_update(t_del, oid, ship_id, "DELIVERED", "order_delivered", tl)
            final = "DELIVERED"
    finish_order(oid, uid, t0, amount, items, final, tl)


def finish_order(oid, uid, t0, amount, items, status, tl):
    ORDERS.append({
        "order_id": oid, "user_id": uid, "created_at": t0, "status": status,
        "amount": amount, "currency": "EUR", "items": items,
        "timeline": [{"ts": t, "service": s, "event": e, "trace_id": tr} for t, s, e, tr in sorted(tl)],
    })


def build_traces(M):
    cats = ["shoes", "jackets", "bags", "kitchen", "garden", "toys", "books"]
    for t in pick_times(240):
        request(t, "GET /products", "catalog",
                [("pg SELECT products (replica)", "client", 9, {"db": "catalog-replica"})],
                msg="listed products", category=R.choice(cats), count=24)
    for t in pick_times(240):
        nf = R.random() < 0.03
        request(t, "GET /products/:id", "catalog",
                [("pg SELECT product (replica)", "client", 4, {"db": "catalog-replica"})],
                status=404 if nf else 200, msg="product not found" if nf else "product viewed",
                product_id=product_id())
    for t in pick_times(70):
        bad = R.random() < 0.07
        request(t, "POST /auth/login", "auth",
                [("pg SELECT users", "client", 3, {"db": "users"}), ("bcrypt verify", "internal", 70, {})],
                status=401 if bad else 200, level="warn" if bad else "info",
                msg="login failed: wrong password" if bad else "login ok", user_id=user_id())
    for t in pick_times(50):
        request(t, "POST /auth/refresh", "auth", [("pg SELECT sessions", "client", 3, {"db": "users"})],
                msg="token refreshed", user_id=user_id())
    for t in pick_times(12):
        request(t, "POST /auth/signup", "auth",
                [("bcrypt hash", "internal", 75, {}), ("pg INSERT users", "client", 5, {"db": "users"})],
                status=201, msg="user signed up", user_id=user_id())
    for t in pick_times(140):
        request(t, "POST /cart/items", "cart",
                [("redis HSET cart", "client", 0.8, {"db": "redis"}), ("redis EXPIRE cart", "client", 0.4, {"db": "redis"})],
                status=201, msg="item added to cart", user_id=user_id(), product_id=product_id(), qty=R.randint(1, 3))
    for t in pick_times(35):
        request(t, "DELETE /cart/items/:id", "cart", [("redis HDEL cart", "client", 0.7, {"db": "redis"})],
                msg="item removed from cart", user_id=user_id(), product_id=product_id())
    for t in pick_times(90):
        request(t, "GET /cart", "cart", [("redis HGETALL cart", "client", 0.8, {"db": "redis"})],
                msg=None, user_id=user_id())
    for t in pick_times(40):
        request(t, "GET /orders/:id", "order", [("pg SELECT orders", "client", 3, {"db": "orders"})],
                msg=None, user_id=user_id())
    for t in pick_times(30):
        request(t, "GET /shipments/:id", "delivery", [("pg SELECT shipments", "client", 3, {"db": "shipments"})],
                msg=None, user_id=user_id())

    # rate limited requests (normal: a few scrapers)
    for t in pick_times(18):
        tid, spans = hexid(32), []
        gw = span(spans, tid, None, "gateway", "GET /products", t, R.uniform(0.3, 1), http_status=429)
        log(end(gw), "gateway", "warn", "rate limited", gw, route="GET /products", client_ip="ip_" + hexid(6))
        access_log(gw)
        TRACES.append(spans)

    # rare, single 5xx errors. Normal noise: one-off, no pattern.
    one_offs = [
        (290, "POST /cart/items", "cart", [("redis HSET cart", "client", 50, {"db": "redis", "_exact": True, "_status": "error"})],
         "redis: i/o timeout after 50ms"),
        (840, "POST /auth/login", "auth", [("pg SELECT users", "client", 2, {"db": "users", "_status": "error"})],
         "pg: connection reset by peer"),
        (1105, "GET /products/:id", "catalog", [("pg SELECT product (replica)", "client", 30, {"db": "catalog-replica", "_status": "error"})],
         "pg: canceling statement due to conflict with recovery"),
    ]
    for m, route, svc, steps, err in one_offs:
        request(at(m, R.uniform(0, 59)), route, svc, steps, status=500, level="error",
                msg="request failed", err=err, user_id=user_id())

    # admin edits (count comes from the metric)
    for i, n in enumerate(M["admin"]):
        for _ in range(n):
            pid = product_id()
            request(at(i, R.uniform(0, 59)), "PUT /admin/products/:id", "catalog", [
                ("pg UPDATE products", "client", 5, {"db": "catalog"}),
                ("pg INSERT audit_log", "client", 2, {"db": "catalog"}),
            ], msg="admin updated product", admin_id=f"adm_{R.randint(1, 6)}", product_id=pid,
                field=R.choice(["price", "stock", "title", "description", "images"]))

    for t in pick_times(160):
        checkout(t)


def background_logs(series_by_key):
    # stuck orders job, every minute
    for i in range(MINUTES):
        log(at(i, 0.2), "order", "info", "stuck orders job finished", pending_over_15m=0,
            duration_ms=round(jit(18, 0.2), 1))
    # kafka consumers commit offsets, every 10 minutes
    for g in ("order", "delivery", "notification"):
        lag = series_by_key[("kafka_consumer_lag", "group", g)]["values"]
        svc = g
        for i in range(0, MINUTES, 10):
            log(at(i, R.uniform(1, 9)), svc, "info", "kafka offsets committed", group=g, lag=lag[i])
    # deploys: rolling restart logs
    for d in DEPLOYS:
        t = at(d["minute"], 5)
        s, v = d["service"], d["version"]
        for pod in range(SERVICES[s]["pods"]):
            pt = t + timedelta(seconds=40 * pod)
            pod_name = f"{s}-{hexid(5)}"
            log(pt, s, "info", "SIGTERM received, draining connections", pod=pod_name, version=d["previous"])
            log(pt + timedelta(seconds=3), s, "info", f"starting {s} {v}", pod=f"{s}-{hexid(5)}", version=v)
            log(pt + timedelta(seconds=6), s, "info", "ready, listening on :8080", version=v)
    for c in CONFIG_CHANGES:
        log(at(c["minute"], 2), "gateway", "info", "config reloaded", change=c["summary"])


# ---------------------------------------------------------------- output
def clean(o):
    if isinstance(o, datetime):
        return iso(o)
    if isinstance(o, float):
        return round(o, 2)
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    return o


def trace_record(spans):
    root = spans[0]
    t0 = root["start"]
    last = max(end(s) for s in spans)
    return clean({
        "trace_id": root["trace_id"],
        "root": root["name"],
        "start": t0,
        "duration_ms": root["duration_ms"],
        "total_ms": (last - t0).total_seconds() * 1000,
        "status": "error" if any(s["status"] == "error" for s in spans) else "ok",
        "http_status": root["attrs"].get("http_status"),
        "services": sorted({s["service"] for s in spans}),
        "spans": [{k: v for k, v in dict(s, offset_ms=(s["start"] - t0).total_seconds() * 1000).items()
                   if k not in ("trace_id", "start")} for s in spans],
    })


def main():
    M = build_metrics()
    by_key = {(s["name"],) + tuple(x for kv in sorted(s["labels"].items()) for x in kv): s for s in SERIES}
    build_traces(M)
    background_logs(by_key)

    TRACES.sort(key=lambda sp: sp[0]["start"])
    LOGS.sort(key=lambda e: e["ts"])
    ORDERS.sort(key=lambda o: o["created_at"])

    events = [{"type": "deploy", "ts": iso(at(d["minute"])), "service": d["service"], "version": d["version"],
               "previous": d["previous"], "summary": d["summary"], "by": "ci-bot", "commit": hexid(7)}
              for d in DEPLOYS]
    events += [{"type": "config", "ts": iso(at(c["minute"])), "service": c["service"],
                "summary": c["summary"], "by": "ops"} for c in CONFIG_CHANGES]
    events.sort(key=lambda e: e["ts"])

    alerts = {
        "firing": [],
        "history": [],
        "rules": [
            {"name": "CheckoutSuccessLow", "rule": "checkout_success_rate < 90% for 10m", "severity": "critical"},
            {"name": "OrdersStuckPending", "rule": "orders_stuck_pending_15m > 5", "severity": "critical"},
            {"name": "PaymentSuccessLow", "rule": "payment_success_rate < 90% for 10m", "severity": "critical"},
            {"name": "ServiceErrorRateHigh", "rule": "http_error_rate > 2% for 5m (any service)", "severity": "serious"},
            {"name": "ServiceLatencyHigh", "rule": "http_latency_p95_ms > 2x normal for 10m", "severity": "warning"},
            {"name": "PodRestarts", "rule": "pod_restarts > 3 in 15m", "severity": "serious"},
            {"name": "PostgresDown", "rule": "pg_up == 0", "severity": "critical"},
            {"name": "PostgresConnectionsHigh", "rule": "pg_connections_used > 80% of max", "severity": "serious"},
            {"name": "PostgresDiskHigh", "rule": "pg_disk_used_pct > 80", "severity": "warning"},
            {"name": "ReplicaLagHigh", "rule": "pg_replication_lag_s > 30 for 5m", "severity": "serious"},
            {"name": "RedisMemoryHigh", "rule": "redis_memory_used_mb > 85% of max", "severity": "warning"},
            {"name": "KafkaLagHigh", "rule": "kafka_consumer_lag > 1000 for 10m", "severity": "serious"},
            {"name": "DlqGrowing", "rule": "kafka_dlq_size grows in 15m", "severity": "warning"},
            {"name": "ThirdPartyErrors", "rule": "third_party_error_rate > 5% for 5m", "severity": "serious"},
            {"name": "BadWebhookSignatures", "rule": "webhook_bad_signatures_per_min > 10", "severity": "warning"},
            {"name": "EmailsFailing", "rule": "emails_failed_per_min > 5 for 10m", "severity": "warning"},
            {"name": "NodeDown", "rule": "node_up == 0", "severity": "serious"},
        ],
    }
    for r_ in alerts["rules"]:
        r_["state"] = "ok"

    meta = {
        "scenario": SCENARIO,
        "description": "All services healthy. Normal daily traffic. 3 deploys and 1 config change, no impact.",
        "seed": SEED, "start": iso(START), "end": iso(END), "step_s": 60, "points": MINUTES,
        "notes": [
            "Metrics: one point per minute (the real scraper uses 15s).",
            "Traces and logs are a sample of real traffic, not every request.",
            "Every sampled checkout has its full order story: traces, logs and timeline.",
            "Error rate = 5xx only. 401, 402, 404 and 429 are normal and are not errors.",
        ],
    }
    metrics = {"start": iso(START), "step_s": 60, "points": MINUTES, "series": SERIES}
    traces = [trace_record(sp) for sp in TRACES]
    logs = [clean(e) for e in LOGS]
    orders = [clean(o) for o in ORDERS]

    bundle = {"meta": meta, "metrics": metrics, "logs": logs, "traces": traces, "orders": orders,
              "events": events, "alerts": alerts, "topology": TOPOLOGY}
    write(OUT, bundle)
    print(f"scenario={SCENARIO} series={len(SERIES)} logs={len(logs)} traces={len(traces)} orders={len(orders)}")

    import noise  # after the baseline: noise uses R, so the baseline stays the same
    items = noise.build(sys.modules[__name__], by_key)
    with open(os.path.join(OUT, "noise.js"), "w", encoding="utf-8") as f:
        f.write("window.TRACER_NOISE=")
        json.dump(items, f, separators=(",", ":"))
        f.write(";\n")
    print(f"noise items={len(items)}, written to {os.path.join(OUT, 'noise.js')}")

    args = sys.argv[1:]
    if "--noise" in args:
        want = args[args.index("--noise") + 1]
        name = args[args.index("--name") + 1] if "--name" in args else "noisy"
        ids = [n["id"] for n in items] if want == "all" else want.split(",")
        unknown = set(ids) - {n["id"] for n in items}
        if unknown:
            sys.exit(f"Unknown noise id: {', '.join(sorted(unknown))}. Known: {', '.join(n['id'] for n in items)}")
        out = os.path.join(ROOT, "data", name)
        chosen = [n for n in items if n["id"] in ids]
        write(out, noise.apply(bundle, chosen, name))
        labels = [{k: v for k, v in n.items() if k not in noise.DATA_KEYS} for n in chosen]
        with open(os.path.join(out, "labels.json"), "w", encoding="utf-8") as f:
            json.dump(labels, f, indent=1)
        print(f"scenario={name} noise={','.join(ids)}, written to {out}")


def write(out, bundle):
    os.makedirs(out, exist_ok=True)

    def dump(name, obj):
        with open(os.path.join(out, name), "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"))

    metrics, logs, traces = bundle["metrics"], bundle["logs"], bundle["traces"]
    orders, events, alerts = bundle["orders"], bundle["events"], bundle["alerts"]
    dump("metrics.json", metrics)
    dump("traces.json", traces)
    dump("orders.json", orders)
    dump("events.json", events)
    dump("alerts.json", alerts)
    dump("topology.json", TOPOLOGY)
    with open(os.path.join(out, "logs.jsonl"), "w", encoding="utf-8") as f:
        for e in logs:
            f.write(json.dumps(e, separators=(",", ":")) + "\n")
    with open(os.path.join(out, "data.js"), "w", encoding="utf-8") as f:
        f.write("window.TRACER_DATA=")
        json.dump(bundle, f, separators=(",", ":"))
        f.write(";\n")


if __name__ == "__main__":
    main()
