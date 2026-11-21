---
name: create-eval-case
disable-model-invocation: true
description: Create a TracerAgent eval test case with a new seeded incident and its telemetry data, write or fix tests.js or prompt.md grader files, review a case, or check that the graders work.
---

# Create a TracerAgent eval case

An eval is a test of the incident-triage agent. Each case gives the agent an alert or a question about shop data.
The trajectory grader scores the investigation. The outcome grader scores the final answer.
Each grader has JavaScript checks and a rubric. A rubric tells a language model how to give each score.

Run the commands in this skill from the repository root.

**By default, make a new case with a new incident.** Edit an existing case or incident only when the user says so.

## How the data works

- `seed/generate.py` makes 24 hours of normal shop telemetry (the baseline). The window is fixed:
  Nov 19 12:00 UTC to Nov 20 12:00 UTC. The agent must treat the window end as the current time.
- `seed/noise.py` has noise items. A noise item looks like a fault, but it is not one.
- `seed/incidents.py` has incidents. An incident is a real fault. It also makes the text for the Info tab.
- A case selects incidents and noise items. `npm run eval -- data <case-id>` writes the data to `data/<case-id>/`.
  The runner sends this folder to the agent. `data/` is not in git. Anyone can make the data again from the scripts.
- The data has a fixed seed, and each item has its own random generator. Small changes to the data are acceptable.

## 1. Design the incident

Decide the fault before you write code. Write down:

- **The fault** and its **trigger**, for example a config change, a deploy, or a provider problem.
- **The time window** in the fixed day. Read the `when` field of each noise item in `seed/noise.py`.
  Do not put the fault on top of a noise item that hides its evidence.
- **The cascade.** Use `topology.json` and `seed/generate.py` to find each service, database, Kafka topic,
  provider, and business metric that the fault reaches. List what each one shows.
- **The page.** Find the alert that an on-call engineer gets first. The alert must be a symptom, not the cause.
- **The dead ends.** Find signals that look normal or point the wrong way, for example normal success rates or an
  unrelated deploy. Select noise items that act as distractors.
- **The fix and the recovery.** Decide what action stops the fault and how the data shows recovery.

Use an existing incident only if it fits the case. To list them, read `seed/incidents.py`.

## 2. Write the seed

Follow the [seed instructions](references/seed-incident.md) to add the incident to `seed/incidents.py`.
The incident must also set `c.info` with the text for the Info tab.

## 3. Generate and inspect the data

Make `evals/cases/<case-id>/case.json` with the recipe first (see step 4 for the fields). Then run:

```sh
npm run eval -- data <case-id>
```

Read `data/<case-id>/labels.json` and check the `info` of the incident against the data.
Read the metrics, logs, traces, orders, events, and alerts in the fault window. Compare them with a normal window.
Ask the user to open the case in the eval UI (`npm run eval:ui`) if they want to see the Info tab and the dashboard.

## 4. Write `case.json`

Make a folder at `evals/cases/<case-id>/` with this layout.

```text
case.json
trajectory/
  tests.js
  prompt.md
outcome/
  tests.js
  prompt.md
fixtures/
  good_transcript.json
  bad_transcript.json
reviews/
  correctness.md
  discrimination.md
```

Use these fields. The runner reads them with `readCase` in `evals/harness/storage.js`.

| Field | Rule |
| --- | --- |
| `id` | Use the case folder name. |
| `title` | Give the case a short title as a string. |
| `description` | Describe what the case checks in a string. |
| `scenario` | Use the case ID. The data goes to `data/<case-id>/`. |
| `incidents` | Use an array of incident IDs from `seed/incidents.py`. Use `[]` or leave it out for a case with no fault. |
| `noise` | Use an array of noise IDs from `seed/noise.py`. Use `[]` when the case has no noise. |
| `input` | Write the message that the agent receives. Use a string. |
| `tags` | Use an array of short labels for the case. |
| `timeout_s` | Give the agent time limit as a finite positive number of seconds. The value times 1,000 must be at most 2,147,483,647. |
| `info` | Optional. Leave it out to use the `info` of the incident. Add it only when the case needs different text, for example a different expected answer. |

Use 1 to 128 characters for `id` and `scenario`. Start with a lowercase ASCII letter or digit.
Use lowercase ASCII letters, digits, hyphens, and underscores for the other characters.

### Write the input

Write the input as a real pager alert: the alert name, severity, time, rule, and value.
Add the current time: `Current time: 2026-11-20 12:00 UTC.` Ask for the result that the operator needs.
Do not name the cause, the faulty service, or the change. Do not give hints that a real page does not have.

## 5. Write the graders and fixtures

Follow the [grader guide](references/write-graders.md). It covers:

1. The evidence map: each fact, the tools that show it, the time window, the minimum path, and the false leads.
2. The trajectory grader: direction, efficiency, and course correction.
3. The outcome grader: root cause, mechanism and trigger, impact, and next steps.
4. The fixtures: `fixtures/good_transcript.json` and `fixtures/bad_transcript.json`, with real tool results.
5. The checks with `check-case.js`.

## 6. Review the case

Two independent reviewers check the case. Start both at the same time with the Agent tool, as two
`general-purpose` subagents. Give each one only the case ID, the paths below, and its rubric file.
Do not give them your design notes or the other review. Each reviewer writes its report to the case folder.

| Reviewer | Rubric | Report |
| --- | --- | --- |
| Correctness | [review-correctness.md](references/review-correctness.md) | `evals/cases/<case-id>/reviews/correctness.md` |
| Discrimination | [review-discrimination.md](references/review-discrimination.md) | `evals/cases/<case-id>/reviews/discrimination.md` |

Use this prompt for each reviewer. Replace the values in angle brackets.

```text
Review the TracerAgent eval case <case-id> in <repository root>. Follow the rubric in
.claude/skills/create-eval-case/references/<rubric file> exactly. Read the case folder
evals/cases/<case-id>/, the incident in seed/incidents.py (<incident id>), the noise items in seed/noise.py,
and the generated data in data/<case-id>/. Do not change any file except the report.
Write the report to evals/cases/<case-id>/reviews/<report file>.
```

## 7. Fix and report

1. Read both reports. Fix each finding in the seed, the case, or the graders.
2. Generate the data again if the seed changed. Run the checker again.
3. Run both reviewers again one time. They overwrite their reports.
4. Tell the user the case ID, the scores from both reviews, the findings that are still open, and how to run the case:
   `EVAL_AGENT_CMD="node agent/cli.js" npm run eval -- run <case-id>` and the eval UI.

Each grader gives up to 5 points. The total is out of 10.
The [grader reference](references/graders.md#judge-settings) lists the judge defaults and effort levels.

## Common mistakes

- The case names an incident or noise item, but `data/<case-id>/` is old. Run `npm run eval -- data <case-id>` again.
- The fault shows in one service but not in the services that depend on it.
- The input names the cause or the faulty service.
- The grader expects a fact that only the labels show.
- The Info text has a value that the code did not compute. Compute each value in `c.info` from the data.
- The check gives points for a tool call with the wrong service or a failed result.
- A check requires an exact phrase or an exact start time when other choices also work.
- The rubric repeats direct JavaScript checks and leaves the cause or impact ungraded.
- The sample passes, but the grader also gives points to a blank answer.
