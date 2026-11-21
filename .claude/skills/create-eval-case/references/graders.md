# Grader reference

When you change the outcome rubric, check that `info.expected` in `case.json` still describes the answer that earns full credit. Use the [case info reference](scenario-data.md#case-info) for the fields.

## JavaScript checks

The worker calls the default export as `grade(transcript, { case: testCase, helpers, labels })`.
`transcript` has the ordered steps and the final answer. `testCase` has the fields from `case.json`.
`helpers` contains the functions below. `labels` contains the parsed scenario labels, or `null` if the file is absent.
The function can be async. The same 30-second limit applies.

The worker normalizes each value in the returned object.
For example, use `{ checked_alerts: true, checked_window: { score: 0.5, reason: 'The query ends before recovery.' } }`.
Return an item with a score of 0 when evidence is absent.
The check script reports a file that returns an empty object as an error.

## Helper functions

`tr` is the transcript in these examples.

| Helper | Result and example |
| --- | --- |
| `toolCalls` | Gets all tool calls, or all calls with the given name. `helpers.toolCalls(tr, 'search_logs')` |
| `indexOfTool` | Gets the first matching step index, or `-1` if no step matches. `helpers.indexOfTool(tr, 'db_health', { db: 'catalog' })` |
| `calledTool` | Checks if any step matches. `helpers.calledTool(tr, 'query_metric', args => args.labels?.db === 'catalog')` |
| `calledBefore` | Checks if a call to the first tool occurs before a call to the second tool. `helpers.calledBefore(tr, 'list_alerts', 'query_metric')` |
| `servicesTouched` | Gets unique string values from `args.service` or `args.labels.service`. `helpers.servicesTouched(tr).includes('catalog')` |
| `finalText` | Gets the `final_output` string. `helpers.finalText(tr)` |
| `mentions` | Checks that all strings or regular expressions match the text. Case has no effect. `helpers.mentions(helpers.finalText(tr), 'catalog', /recover(ed\|y)/)` |

An object matcher compares only the named argument keys. It uses strict equality for each value.
Use a function for nested arguments. The worker calls the function with `(args, call)`.
Use `call.error` to check for a failed tool call when the item needs a successful result.
Use `indexOfTool` with a matcher if a check depends on the order of calls with specific arguments.
Check that an index is at least zero before you compare it with another index.

## Partial credit

For a Catalog metric check, give 1 when a successful query covers the necessary time window.
Give 0.5 when the successful query uses the correct metric and database but misses part of the time window.
Give 0 when the agent skips the check, calls the wrong tool, or checks a different database.
Use `Date.parse` to compare start and end times. Allow any window that gives the necessary evidence.

For an outcome check, give 1 when the agent gives the cause and explains the evidence.
Give 0.5 when the agent gives the cause without the evidence. Give 0 for a missing or wrong cause.
Use text checks for terms that have clear matches. Use the rubric to check what the answer means.

## Rubric format

A score anchor defines what earns a score. Use this format for each numbered item.

```markdown
1. **checked_checkout_impact**
   - 1. The agent compares checkout results during the alert with a normal period.
   - 0.5. The agent checks checkout results but gives no comparison.
   - 0. The agent gives no checkout evidence or uses unrelated results.
```

Give each score a different and observable condition. Name the evidence that the judge can use.
Ask for a short reason for each item when the rubric needs a specific kind of evidence.
Use the case input and transcript as evidence. The judge does not receive the scenario labels.

## Judge settings

The judge uses the `pi` command. The normal run skips the judge if `pi` is missing
or the provider is signed out. The check script reports an error when `--judge` is set and the judge cannot run.
For OpenAI Codex, sign in with `pi auth login openai-codex`.

- `--judge-model <provider/id>` sets the model. The default is `EVAL_JUDGE_MODEL` or `openai-codex/gpt-6.2-sol`.
- `--judge-thinking <level>` sets the effort. The default is `EVAL_JUDGE_THINKING` or `high`.
- The effort levels are `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, and `max`.
- The eval page uses the **Model** and **Effort** selections in **Judge settings** for a new run.

The runner takes the mean of all numeric items in a completed part.
For example, a grader with a JavaScript mean of 1 and a judge mean of 0.5 gives 3.75 points.
The runner rounds the two grader scores to two decimal places before it adds them.
