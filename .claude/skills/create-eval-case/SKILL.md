---
name: create-eval-case
description: Create a TracerAgent eval test case, write or fix tests.js or prompt.md grader files, or check that the graders work.
---

# Create a TracerAgent eval case

An eval is a test of the incident-triage agent. Each case gives the agent a question about shop data.
The trajectory grader scores the investigation. The outcome grader scores the final answer.
Each grader has JavaScript checks and a rubric. A rubric tells a language model how to give each score.

Run the commands in this skill from the repository root.

## 1. Pick the scenario

Choose a folder in `data/`. A scenario is the set of shop data that the agent can read.
Use `baseline` for normal shop operation. Use `noisy` for data with all current noise items.
A noise item is a change to the baseline that can look like a fault.

- Read `seed/noise.py` for the list of noise items and the code that adds each item.
- Read `data/<scenario>/labels.json`, if it exists. Find the label with the noise ID.
- Read the label's `truth` field for the cause and effect. Use `when` and `alerts` to find the time window.
- Use a scenario with the selected noise already in its data when the agent reads the JSON files.

Use the [scenario data reference](references/scenario-data.md) to find evidence or make a scenario with selected noise.

## 2. Find the expected facts

Read `alerts.json` for the symptom and its time. Find the service and the metric in `metrics.json`.
Check `logs.jsonl` and `events.json` for the cause. Check traces and order records when they can show impact.
Compare the incident window with a normal window in the same scenario.

Record which data shows the cause, recovery, and customer impact. Identify an action that the data supports.
Check that the agent can find the evidence with its tools. Keep the grader labels out of the agent input.
If the data cannot support an exact count or time, grade the conclusion that the data supports.

## 3. Write `case.json`

Make a folder at `evals/cases/<case-id>/` with this layout.

```text
case.json
trajectory/
  tests.js
  prompt.md
outcome/
  tests.js
  prompt.md
sample_transcript.json
```

Use these fields. The runner reads them with `readCase` in `evals/harness/storage.js`.

| Field | Rule |
| --- | --- |
| `id` | Use the case folder name. |
| `title` | Give the case a short title as a string. |
| `description` | Describe what the case checks in a string. |
| `scenario` | Use the name of a folder in `data/`. |
| `noise` | Use an array of noise IDs. Use `[]` when the case has no noise. |
| `input` | Write the question that the agent receives. Use a string. |
| `tags` | Use an array of short labels for the case. |
| `timeout_s` | Give the agent time limit as a finite positive number of seconds. The value times 1,000 must be at most 2,147,483,647. |
| `info` | Describe the failure, the trigger, the affected systems, the telemetry signals, and the expected answer. The Info tab reads this optional object. |

Use 1 to 128 characters for `id` and `scenario`. Start with a lowercase ASCII letter or digit.
Use lowercase ASCII letters, digits, hyphens, and underscores for the other characters.
`readCase` checks the form of the scenario ID and checks that `noise` and `tags` are arrays.
The check script checks the scenario folder and uses the scenario's noise catalog when available.
The runner can read a case with missing grader files. Write all four files for a complete case.

Give the agent the alert, time, or symptom that an operator would have. Ask for the result that the operator needs.
Keep the cause out of the question when the agent must find it.

### Write the case info

Add `info` for each new case. Write short sentences. Check every claim against the scenario data or its labels.
Give each signal a UTC time window. If the case has no failure, say so and show what normal operation looks like.
Match the expected answer to the outcome rubric. Use the [case info reference](references/scenario-data.md#case-info) for the fields and dashboard links.

## 4. Write the two graders

In `trajectory/`, check how the agent worked. Check the tool, service, metric, and time window.
Check the order when one tool result gives the agent a reason for the next call.
Accept other calls and orders that produce the necessary evidence.

In `outcome/`, check what the agent answered. Check the cause, the impact, and the next steps.
Check recovery when the question asks if the problem has cleared.

### Write `tests.js`

Export the function below. The worker passes the case data under the key `case`.

```js
export default function grade(transcript, { case: testCase, helpers, labels }) {
	return { checked_catalog: helpers.calledTool(transcript, 'db_health', { db: 'catalog' }) };
}
```

Return an object with one key for each item. Each value can be a number from 0 to 1, a boolean,
or an object with `score` and a short string `reason`. The worker turns `true` into 1 and `false` into 0.
Use 0.5 for a useful check that misses one part. For example, give 0.5 for a Catalog lag query with a short time window.
The worker gives each file 30 seconds, including the time to load the file.

Use only fixed inputs to calculate a score. The same inputs must give the same score.
Keep network calls, file writes, random values, and the current time out of the check.
Give a missing step a score of 0. Handle missing fields before you read them.
Match the necessary arguments. Accept different word choices and useful time windows.

Use the [grader reference](references/graders.md) for all helper functions and more scoring examples.

### Write `prompt.md`

Write a numbered list of items. Give each item text that defines a score of 1 and a score of 0. Also define 0.5 when partial credit is possible.
Use the same item name as the JavaScript check when both grade the same question.
Use JavaScript for direct checks that need no judgment. Repeat a check in the rubric only when the judge must assess its meaning.

The judge sees the rubric, the case input, and the transcript. Put the expected facts in the rubric.
Ask the judge to check whether the agent used evidence to support the answer.
Use the [replica lag rubrics](../../../evals/cases/noise-price-import-replica-lag/) as examples.

## 5. Write the sample and a bad transcript

Save a good run as `sample_transcript.json`. The replay agent reads this file when no agent command is set.
List the steps in time order in `steps`. Put the answer in the `final_output` string.
For each tool call, set `type` to `tool_call`. Set `tool` to the tool name. Put the arguments in the `args` object.
Include the result. Use `null` for `error` when the call succeeds.
Copy the real evidence into the results. Use the [eval file contract](../../../evals/harness/transcript.md) for the full format.

Save a separate bad transcript. Use a wrong service or a short time window for a trajectory check.
Use a wrong cause or an unsupported action for an outcome check.
Keep at least one correct part to test partial credit. The separate transcript lets you check that a plausible mistake loses points.

## 6. Check and fix the graders

Run the checker on the sample. Then run it on the bad transcript with `--transcript`.

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id>
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --transcript <path>
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --judge
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --judge --judge-model <provider/id> --judge-thinking <level> --json
```

Read each item score. The checker also runs the JavaScript checks on an empty transcript.
Investigate any points the empty transcript earns. Fix errors and repeat the checks.
The checker warns if `info` is missing or a dashboard hash has an unsupported form. It reports errors for invalid `info` fields.
Exit code 0 permits warnings. Exit code 1 means at least one check failed.
`--judge` runs the language-model judge through `pi`. Add `--json` for a report in JSON.
The checker does not write run results.

## 7. Run the eval and view the result

```sh
npm run eval -- run <case-id>
npm run eval -- run <case-id> --judge-model <provider/id> --judge-thinking <level>
```

Open the case on the eval page. Select the new run in **Run history**.
To choose a judge for a run from the page, open **Judge settings**. Select **Model** and **Effort**.
The [Evals section of the README](../../../README.md#evals) gives the page address and start command.

Each grader gives up to 5 points. Take the mean of the item scores for each completed part.
When both parts give a score, the JavaScript checks and the judge each count for half of the grader score.
When one part gives a score, use that score for the full 5-point scale.
Add the two grader scores to get a total out of 10. The total is unavailable if either grader has no score.
The [grader reference](references/graders.md#judge-settings) lists the judge defaults and effort levels.

## Common mistakes

- The case names a noise item, but the agent's data lacks the change.
- The grader expects a fact that only the labels show.
- The Info tab gives a value or time that differs from the scenario data.
- The check gives points for a tool call with the wrong service or a failed result.
- A check requires an exact phrase or exact start time when other choices also work.
- The rubric repeats direct JavaScript checks and leaves the cause or impact ungraded.
- The sample passes, but the grader also gives points to a blank answer.
