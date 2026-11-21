# Scenario data

A scenario is a folder in `data/`. Each case has its own scenario, `data/<case-id>/`.
`npm run eval -- data <case-id>` makes it from the case's `incidents` and `noise` arrays.
The runner makes it when it is missing. The agent command receives the path to this folder as `data_dir`,
and the window end as `now`.

## Data files

| File in `data/<scenario>/` | Contents |
| --- | --- |
| `metrics.json` | Metric series with names, labels, units, and values. Use `start` and `step_s` to find the time for a value. |
| `logs.jsonl` | One log record per line. Search by service, time, message, or fields such as the job ID. |
| `traces.json` | Sample records of requests across services. |
| `orders.json` | Sample orders, their status, and their event times. |
| `events.json` | Changes such as deployments and configuration changes. |
| `alerts.json` | Alert rules, firing alerts, and alert history. |
| `topology.json` | Service names and their connections. |
| `meta.json` | The scenario name, seed, window `start` and `end`, and `now` (the window end). |
| `data.js` | The data bundle that the dashboard loads. |
| `noise.js` | The noise items that the dashboard can apply to this bundle, if the file exists. The baseline has this file. |
| `labels.json` | Metadata and expected facts for each selected noise item and incident. Use the `truth` field to find the expected cause and effect. An incident label also has `info`. |

The baseline has one point per minute. Logs and traces show a sample of requests.
Use a metric or an order record to check a claim about impact when a log sample is too small.
Read `seed/generate.py` for baseline traffic, metric definitions, and the data that the generator writes.
Read `seed/noise.py` for the changes that a noise item makes to that baseline.

## Data for a case

The data of a case has only the items that the case selects. Run:

```sh
npm run eval -- data <case-id>
npm run eval -- data --all
```

The command runs the generator with the case recipe, for example
`python seed/generate.py --name <case-id> --incidents stripe_webhook_secret --noise price_scraper`.
The generator also rewrites the baseline files. Set `EVAL_PYTHON` to use a different Python command.

The generator uses a fixed seed, and each noise item and incident has its own random generator.
A new item does not change the data of the other items. `data/noisy/` (`--noise all`) is only for the dashboard.

## Example evidence for `price_import`

- The label in `data/noise-price-import-replica-lag/labels.json` describes the nightly supplier price import.
- `alerts.json` gives the firing and resolution times of `ReplicaLagHigh`.
- `metrics.json` shows `pg_replication_lag_s` for `db: catalog`. It peaks at 44 seconds.
- `logs.jsonl` has `cron` records for the job and `catalog` records for the batch writes.
- The label explains why product pages can show old prices. It also says that checkout reads the price from the primary database.
- Checkout data before and during the alert can show whether customer checkout failed more often.

Use the labels to choose the expected facts. Find evidence for each fact that you expect the agent to report.
The grader receives `labels.json` as `labels`. It receives `null` when the file is absent.

## Case info

The Info tab shows the `info` object from `case.json`. If the case has no `info`, it shows the `info` that the
incident made (see [seed incidents](seed-incident.md#the-info-object)). The case detail API also supplies the labels
that match the case's `incidents` and `noise` IDs.

| Field | Contents |
| --- | --- |
| `failure` | Markdown that describes the symptom and what the user sees. |
| `trigger` | Markdown that describes the action or condition that starts the failure. |
| `affected` | An array of objects with `name`, `kind`, and `impact`. Use `service`, `database`, `job`, or `provider` for `kind`. Use `[]` if no systems are affected. |
| `signals` | An array of objects with `source`, `where`, `what`, `when`, and an optional `dashboard` hash. Use `metric`, `log`, `trace`, `event`, `alert`, `order`, or `business` for `source`. |
| `expected` | An object with Markdown in `root_cause`, `impact`, and `next_steps`. Include proof of recovery when the rubric asks for it. |

Use nonempty strings for all text fields. In each signal, use `where` for the name or filter. Use `what` for the observed pattern and any steps to find it. This field accepts Markdown. Use `when` for the UTC time or time window.

The dashboard accepts `#overview`, `#map`, `#services`, `#deps`, `#business`, `#logs`, `#traces`, `#orders`, and `#changes`. Use `#noise` when the scenario has a noise overlay. Use `#traces/<id>` or `#orders/<id>` to open a record. Copy the full ID from the scenario data. Check each link in the embedded dashboard. If the dashboard opens a tab without a filter, give the filter or selection in `what`.
