# Write a seed incident

An incident is a real fault in the shop data. It is a function in `seed/incidents.py`.
It changes the baseline with overlays, in the same way as the noise items in `seed/noise.py`.
Use `stripe_webhook_secret` in `seed/incidents.py` as the full example.

## The parts of an incident

```python
@item(id="my_fault", title="Short title",
      when="08:12 to 09:06 UTC", looks_like="What a weak agent can think it is",
      example="What an engineer sees first.",
      truth="What happens and why. The cause, the cascade, the fix, and the recovery.")
def my_fault(g, c):
    R = g.R                    # the random generator of this incident. Use only this one.
    s, e = idx(8, 12), idx(8, 58)
    ...                        # overlays
    c.info = {...}             # text for the Info tab
```

- `id`: lowercase letters, digits, and underscores. The case uses it in `incidents`.
- `g` is `seed/generate.py`. Use its constants and helpers.
- `c` is the overlay context (`Ctx` in `seed/noise.py`).
- `idx(h, m)` gives the minute index for a UTC time. The window starts at 12:00 Nov 19, so `idx(8, 12)` is 08:12 Nov 20.
- Put new incidents at the end of the file.

## Overlay tools

| Tool | Use |
| --- | --- |
| `c.base(name, **labels)` | Read the baseline values of a metric. |
| `c.cur(name, **labels)` | Read the baseline values plus the changes that this item made so far. |
| `c.add(name, labels, i, delta)` | Add `delta` to a metric at minute `i`. To set a value `v`, add `v - c.base(...)[i]`. |
| `c.alert(name, severity, fired, resolved, summary)` | Add an alert to the history. Use the rule names in `alerts.json`. |
| `c.fire_for(name, severity, series, labels, cond, need, text)` | Add an alert each time `cond` is true for `need` minutes in a row. |
| `c.event(type, i, service, summary, **fields)` | Add a deploy or config change event. |
| `c.drop.append({service, msg, from, to})` | Remove baseline log lines that the fault replaces. |
| `c.drop_orders_created(i0, i1)` | Remove the baseline sample orders created in the window, with their traces and logs. |
| `g.log(t, service, level, msg, span=None, **fields)` | Add a log line. Pass a span to link it to a trace. |
| `g.request(t, route, service, steps, status, msg, level, err, **attrs)` | Add a request trace through the gateway, with its log lines. It returns the spans. |
| `g.publish`, `g.consume`, `g.email` | Add Kafka spans and emails to a trace. |
| `g.finish_order(oid, uid, t0, amount, items, status, timeline)` | Add a sample order with its timeline. |
| `pending_checkout(g, t0)` | Add a checkout that stops in `PENDING` (in `seed/incidents.py`). |

`g.at(i, sec)` gives the time of minute `i`. `g.iso(t)` gives the ISO text. `g.ms(t, x)` adds `x` milliseconds.

## Rules

1. **Show the full cascade.** Follow the fault through `topology.json`: the HTTP calls, the Kafka topics and
   consumer groups, the databases, the providers, the emails, and the business metrics. Change each metric that the
   fault changes. Add logs in each service that sees the fault. For example, a missing Stripe webhook also stops
   `payment.succeeded` and `order.paid`, the confirmation emails, the carrier bookings, and `delivery.updated`.
2. **Keep the numbers consistent.** Calculate one count and use it in all the metrics that depend on it.
   For example, the orders that do not get paid are the same orders that send no email.
3. **Remove contradictions.** Baseline samples in the fault window show normal behavior. Remove them with
   `c.drop_orders_created` or `c.drop`, then add samples that show the fault.
4. **Use the real alert rules.** Read `alerts.rules` in `seed/generate.py`. Make the alerts fire only when the rule is true.
5. **Add a cause that the agent can find.** For example, a change event, a deploy, an error log with a clear message,
   or a provider status. The cause must be some steps away from the first alert.
6. **Show recovery** if the fault ends in the window: the fix, the backlog, and the return to normal values.
7. **Use logs and traces as samples.** The baseline logs only some requests. Do not log every request.
8. **Compute the info.** Take each time, count, and ID in `c.info` from the variables in the code.
   Do not type a value by hand.

## The `info` object

Set `c.info` at the end of the function. The Info tab of each case that uses the incident shows it.

| Field | Contents |
| --- | --- |
| `failure` | The symptom and what the customer sees. |
| `trigger` | The action or condition that starts the fault. |
| `affected` | Objects with `name`, `kind` (`service`, `database`, `job`, or `provider`), and `impact`. Include each system in the cascade. |
| `signals` | Objects with `source`, `where`, `what`, `when`, and `dashboard`. One signal for each piece of evidence. Include the dead ends. |
| `expected` | `root_cause`, `impact`, and `next_steps` for a correct answer. |

Use `metric`, `log`, `trace`, `event`, `alert`, `order`, or `business` for `source`.
Give each signal a UTC time window in `when`. Use the helpers `hm(g, i)` and `span_text(g, i0, i1)`.
For `dashboard`, use `#overview`, `#map`, `#services`, `#deps`, `#business`, `#logs`, `#traces`, `#orders`,
or `#changes`. Use `#traces/<id>` or `#orders/<id>` with an ID that the incident made.

## Generate and check

```sh
npm run eval -- data <case-id>
```

The command runs `python seed/generate.py --name <case-id> --incidents <ids> --noise <ids>`. Then:

1. Read `data/<case-id>/labels.json`. Check the `info` text and the alert times.
2. Read the metrics in the fault window and in a normal window. Check that the values are consistent.
3. Search the logs for the fault messages. Check that no baseline log in the window contradicts the fault.
4. Open the sample orders from the incident. Check their timelines.
5. Run the generator two times. The data must be the same.
