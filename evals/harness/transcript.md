# Eval file contract

## Case files

Each case has a folder at `evals/cases/<case-id>/`.

| File | Contents |
| --- | --- |
| `case.json` | The case ID, title, description, scenario, noise IDs, input, tags, and agent time limit in seconds. It can also include `info` for the case page. |
| `trajectory/tests.js` | JavaScript checks for the investigation. |
| `trajectory/prompt.md` | The LLM rubric for the investigation. |
| `outcome/tests.js` | JavaScript checks for the final answer. |
| `outcome/prompt.md` | The LLM rubric for the final answer. |
| `sample_transcript.json` | An optional transcript for the replay agent. |

The `id` in `case.json` matches the folder name. The `scenario` names a folder in `data/`.
IDs and scenario names use lowercase ASCII letters, digits, hyphens, and underscores. They start with a letter or digit.
`noise` and `tags` are arrays. `input` is the text that the agent receives. `timeout_s` is a positive number.
Each grader file is optional. The run shows its status as `missing` if the file is absent.

`info` contains `failure`, `trigger`, `affected`, `signals`, and `expected`. The case detail API returns `info` when present and returns matching noise labels in `labels`. If the case has no matching labels, `labels` is `[]`. See the [case info reference](../../.claude/skills/create-eval-case/references/scenario-data.md#case-info) for the field rules.

## Agent input

The runner starts the agent command from the repository root.
The agent receives one JSON object on standard input. The runner closes standard input after the object.

```json
{
  "case_id": "noise-price-import-replica-lag",
  "input": "Find the cause of ReplicaLagHigh.",
  "scenario": "noisy",
  "noise": ["price_import"],
  "data_dir": "E:/TracerAgnet/data/noisy",
  "model": "openai-codex/gpt-6.2-sol",
  "effort": "high"
}
```

`data_dir` is an absolute path to the scenario data. The case page and graders use `labels.json`.

`model` is the agent model in `provider/model` format. `effort` is one of
`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
The replay agent ignores both fields.

| Environment variable | Default | Use |
| --- | --- | --- |
| `EVAL_AGENT_MODEL` | `openai-codex/gpt-6.2-sol` | Set the default agent model. |
| `EVAL_AGENT_EFFORT` | `high` | Set the default agent effort. |

The `run <case-id>` and `run --all` commands accept `--agent-model <provider/id>`
and `--agent-effort <level>`. These flags override the agent defaults.

## Agent output

The agent writes one transcript as JSON to standard output. The agent writes diagnostic messages to standard error.
The `steps` array and the `final_output` string are required. List the steps in the order in which they occurred.
Use `null` for `error` on a successful tool call. Use any JSON value for `result`.

```json
{
  "agent": { "name": "example", "model": null },
  "input": "Find the cause of ReplicaLagHigh.",
  "steps": [
    { "type": "message", "role": "assistant", "text": "I will check the Catalog replica." },
    {
      "type": "tool_call",
      "id": "t1",
      "tool": "query_metric",
      "args": { "name": "pg_replication_lag_s", "labels": { "db": "catalog" } },
      "result": { "peak_s": 44 },
      "error": null,
      "duration_ms": 120
    }
  ],
  "final_output": "The Catalog replica recovered.",
  "usage": { "input_tokens": 0, "output_tokens": 0 },
  "started_at": "2026-11-20T00:45:00.000Z",
  "ended_at": "2026-11-20T00:45:06.000Z"
}
```

## JavaScript grader output

Each `tests.js` exports a default function named `grade`. It receives the transcript and a context object.
The context has `case`, `helpers`, and `labels`. The runner sets `labels` to `null` if the scenario has no `labels.json`.
The function can be asynchronous. It has 30 seconds to return an object with a score for each item.

```js
export default function grade(transcript, { helpers }) {
	return {
		checked_catalog: helpers.calledTool(transcript, 'db_health', { db: 'catalog' }),
		checked_recovery: { score: 0.5, reason: 'The check ended before the alert cleared.' },
	};
}
```

A score can be a number from 0 to 1, a boolean, or an object with `score` and `reason`.
The runner converts `true` to 1 and `false` to 0. The runner marks invalid scores as item errors.
`helpers.js` has functions to find tool calls, check their order, and check text.
`calledTool` and `indexOfTool` take an optional object of argument values or a function that tests the arguments.
`mentions` checks all given strings or regular expressions, without regard to case.

## LLM grader

The LLM graders use `pi` with your ChatGPT subscription. To sign in, run `pi auth login openai-codex`.
The runner checks the sign-in status for the provider in the model name.
If `pi` is missing or you are signed out, the grader status is `skipped`.

| Environment variable | Default | Use |
| --- | --- | --- |
| `EVAL_JUDGE_MODEL` | `openai-codex/gpt-6.2-sol` | Set the default model in `provider/model` format. |
| `EVAL_JUDGE_THINKING` | `high` | Set the default thinking level. |
| `EVAL_PI_CMD` | `pi` | Set the executable name or path. On Windows, use `pi.cmd` for a full path. |
| `EVAL_JUDGE_TIMEOUT_S` | `600` | Set the time limit in seconds for each `pi` command during a run. |

The `run <case-id>` and `run --all` commands accept `--judge-model <provider/id>`
and `--judge-thinking <level>`. Both commands accept `--run-id <id>`.
The thinking levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.

The runner sends the rubric, case input, and transcript on standard input.
The judge returns one JSON object on standard output.
The object has an `items` array and a `summary` string.
Each item has a `name`, a numeric `score` from 0 to 1, and a `reason`.
If the reply is invalid, the runner tries once more.

## Run results

The file at `evals/results/<case-id>/<run-id>.json` starts with status `running`.
After the agent and the graders finish, the runner sets the status to `done`.
If the agent fails, the runner sets the run status to `error`.
A grader error appears in that grader's result. The other graders can still report scores.
Each result contains the transcript and the score for each item that a grader checked.
The agent's final answer is in `transcript.final_output`.

The `agent_settings` object records the selected `model` and `effort` from the start of the run.
The `agent` object comes from the transcript.

The `judge` object has the `model` and `thinking` for the run. Each entry at
`graders.<kind>.llm` also has these fields. The `raw_output` field has up to 20,000
characters of standard output from the last judge call. The runner keeps it even
if the call or JSON parse fails. If the judge call never starts, the field is `null`.

The `score` object has a `total`, a `max` of 10, and one object for each grader.
The `trajectory` and `outcome` objects each have a `score`, a `max` of 5, and
the part averages `deterministic` and `llm`.

- A part average is the mean of the numeric item scores for a part with status `done`.
  If the part has no numeric scores or has a different status, its average is `null`.
- A grader score is five times the mean of its two part averages. If one part
  has an average, use that average. If neither part has an average, the grader score is `null`.
- The total is the sum of the two grader scores. If either grader score is
  `null`, the total is `null`. The runner rounds each number to two decimal places.

Run summaries include `score_total`. Older run files can omit the new fields.

## Run API

`GET /api/judge/options` returns `default`, `agent_default`, `models`, `thinking`, and `error`.
The judge `default` object has `model` and `thinking`. The `agent_default` object has `model` and `effort`.
The `thinking` array has the allowed levels for the judge and the agent.
The `models` array has the sorted model IDs that support thinking.
The server adds the default judge model if the list has other models.
If the model list fails to load, the server returns an empty array and an error message.
On success, `error` is `null`. The server keeps the list for five minutes.

`POST /api/cases/:id/run` accepts up to 4 KB of JSON. The optional `agent` object
accepts `model` and `effort`. The optional `judge` object accepts `model` and `thinking`.
The server uses the defaults for fields that you omit. An empty body uses all defaults.
An invalid body returns HTTP 400 with an `error` message.
