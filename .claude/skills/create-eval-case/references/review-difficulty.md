# Review 3: difficulty

You are an independent reviewer. Rate how hard the eval case is for a strong agent.
The target is the maximum score in each part. A hard case must also be fair: the data that the agent sees
must prove the root cause.

You did not write the case. Do the blind solve first, before you read anything that gives the answer.

## 1. Blind solve

Read only `evals/cases/<case-id>/case.json`, and from it only `input`. Do not read the seed, `labels.json`,
the graders, the fixtures, the `info` field, or the other reviews before you finish this step.

Investigate the alert as an on-call agent. Use only the agent tools on `data/<case-id>/`:

```sh
node .claude/skills/create-eval-case/scripts/run-tool.js <case-id> <tool> '<json args>'
node .claude/skills/create-eval-case/scripts/run-tool.js <case-id> --list
```

Rules:
- Use at most 30 tool calls. Record each call, its arguments, and what the result told you.
- Write your first hypothesis after the first 3 calls. Write when and why it changed.
- Stop when you can state the root cause, the trigger with its time, the impact, and the fix, with evidence.
- If you cannot prove the root cause in 30 calls, stop and write what is missing.

Write your answer before you continue.

## 2. Compare with the truth

Now read the case folder, the incident in `seed/incidents.py`, the noise items in `seed/noise.py`, and
`data/<case-id>/labels.json`. Compare your answer with the expected answer.

## 3. Check

### A. Fairness (gate)

- Is each fact in the expected root cause visible in the data that the agent sees? Name the tool call that shows it.
- Does any expected fact exist only in the labels or the seed?

If the case fails this gate, give 1 to each part below and say which fact is missing.

### B. Shortcut resistance

Run each call with its default arguments: `list_alerts`, `search_logs` with `level: "error"`, `log_patterns`,
`list_changes`, `business_kpis`, and `third_party_health` for each provider.
Then run `search_logs` with words from the root cause (for example the name of the trigger).

- Does one call show the root cause or the trigger? Which call?
- Can an agent that reads only the alerts and the changes guess the root cause?

### C. Depth

Write the shortest path from the page to the root cause. Each step is a tool call whose result gives the
reason for the next call. Count the steps.

### D. Cross-source evidence

- List the data sources that the shortest path needs: metrics, logs, traces, orders, events, alerts.
- Is there a fact that the agent can only get when it combines two results (for example a time match
  between a metric step and a log line)?

### E. Time reasoning

- How long before the page does the trigger occur?
- Must the agent change the default time window (the last hour) to find the trigger?
- Does the effect start later than the cause, or grow over time?

### F. Partial-answer trap

- Is there an answer that is partly correct, for example a correct mitigation with a wrong root cause, or the
  correct service with the wrong mechanism?
- Write it as a short transcript in your scratchpad. Run the checker on it:

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --transcript <path>
```

- Does the partial answer get less than half of the points?

### G. Distractors

- List each signal that points the wrong way: noise items, changes, alerts, spikes, normal-looking metrics.
- For each one, give the check that rejects it.
- Which distractor did you follow in the blind solve, if any?

## Score

Give each part a score from 1 to 5. Scores 2 to 4 are between the two anchors.

| Part | 1 | 5 |
| --- | --- | --- |
| Blind solve | One or two calls give the full answer. | You needed 10 or more calls, and your first hypothesis was wrong or incomplete. |
| Shortcut resistance | One default call shows the root cause. | No default call shows the root cause or the trigger. |
| Depth | The page names the cause. | Five or more steps from the page to the root cause. |
| Cross-source evidence | One source is enough. | Three or more sources, and one fact needs two results together. |
| Time reasoning | Cause and page are in the same minutes. | The trigger is 2 hours or more before the page, and the agent must widen the window. |
| Partial-answer trap | No partial answer exists, or it gets full points. | A plausible partial answer exists, and it gets less than half of the points. |
| Distractors | No distractor. | Three or more plausible distractors. Each needs a specific check to reject. |

The maximum is 35. The case reaches the target only when each part is 5 and the fairness gate passes.

## Report

Write the report to `evals/cases/<case-id>/reviews/difficulty.md` in this form. Use short sentences.

```markdown
# Difficulty review: <case-id>

Fairness gate: pass | fail

| Part | Score |
| --- | --- |
| Blind solve | n/5 |
| Shortcut resistance | n/5 |
| Depth | n/5 |
| Cross-source evidence | n/5 |
| Time reasoning | n/5 |
| Partial-answer trap | n/5 |
| Distractors | n/5 |
| **Total** | **n/35** |

## Blind solve

| # | Call | What it showed | Hypothesis |
| --- | --- | --- | --- |
| 1 | <tool and arguments> | <result> | <hypothesis now> |

Answer: <root cause, trigger, impact, fix>. Correct: yes | partly | no.

## Shortest path

1. <step> (tool and evidence)

## Partial-answer test

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| <short description> | n/5 | n/5 | n/10 |

## Findings

1. **<short title>** (the part that loses points)
   - Evidence: <what you saw>
   - Fix: <what to change to reach 5: the seed, the noise selection, the input, or the graders>
```

Change only the report file and files in your scratchpad.
