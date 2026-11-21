# Scenario data

A scenario is a folder in `data/`. The agent command receives the path to this folder as `data_dir`.
The command also receives the case's `noise` array. The runner passes this array as data.
Check how the agent command uses it before you rely on it to change the data.

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
| `data.js` | The data bundle that the dashboard loads. |
| `noise.js` | The noise items that the dashboard can apply to this bundle, if the file exists. The baseline has this file. |
| `labels.json` | Noise metadata and expected facts, if the file exists. Use the `truth` field to find the expected cause and effect. |

The baseline has one point per minute. Logs and traces show a sample of requests.
Use a metric or an order record to check a claim about impact when a log sample is too small.
Read `seed/generate.py` for baseline traffic, metric definitions, and the data that the generator writes.
Read `seed/noise.py` for the changes that a noise item makes to that baseline.

## Data with selected noise

`data/noisy/` has all noise items already applied. A case can use one of those items as its subject.
The `noise` field describes the items the case is about. It does not remove other items from `data/noisy/`.
Check that other items do not affect the evidence in the case's time window.

To make a scenario with selected items, use `--noise` with a comma-separated list of IDs.
Set `--name` to a new scenario ID. The generator also rewrites the baseline files.

```sh
python seed/generate.py --noise nightly_backup,price_scraper --name backup-and-scraper
```

Use the generated folder name in `scenario`. Use the selected IDs in `noise`.
Use a name that follows the case ID rules. The generator uses a fixed seed for its data.

## Example evidence for `price_import`

- The label in `data/noisy/labels.json` describes the nightly supplier price import.
- `alerts.json` gives the firing and resolution times of `ReplicaLagHigh`.
- `metrics.json` shows `pg_replication_lag_s` for `db: catalog`. It peaks at 44 seconds.
- `logs.jsonl` has `cron` records for the job and `catalog` records for the batch writes.
- The label explains why product pages can show old prices. It also says that checkout reads the price from the primary database.
- Checkout data before and during the alert can show whether customer checkout failed more often.

Use the labels to choose the expected facts. Find evidence for each fact that you expect the agent to report.
The grader receives `labels.json` as `labels`. It receives `null` when the file is absent.

## Case info

The optional `info` object in `case.json` supplies the text for the Info tab. The case detail API also supplies the labels that match the case's `noise` IDs.

| Field | Contents |
| --- | --- |
| `failure` | Markdown that describes the symptom and what the user sees. |
| `trigger` | Markdown that describes the action or condition that starts the failure. |
| `affected` | An array of objects with `name`, `kind`, and `impact`. Use `service`, `database`, `job`, or `provider` for `kind`. Use `[]` if no systems are affected. |
| `signals` | An array of objects with `source`, `where`, `what`, `when`, and an optional `dashboard` hash. Use `metric`, `log`, `trace`, `event`, `alert`, `order`, or `business` for `source`. |
| `expected` | An object with Markdown in `root_cause`, `impact`, and `next_steps`. Include proof of recovery when the rubric asks for it. |

Use nonempty strings for all text fields. In each signal, use `where` for the name or filter. Use `what` for the observed pattern and any steps to find it. This field accepts Markdown. Use `when` for the UTC time or time window.

The dashboard accepts `#overview`, `#map`, `#services`, `#deps`, `#business`, `#logs`, `#traces`, `#orders`, and `#changes`. Use `#noise` when the scenario has a noise overlay. Use `#traces/<id>` or `#orders/<id>` to open a record. Copy the full ID from the scenario data. Check each link in the embedded dashboard. If the dashboard opens a tab without a filter, give the filter or selection in `what`.
