# Review 2: discrimination

You are an independent reviewer. Find how well the eval case separates a good agent from a weak agent.
A good case gives a high score to a careful investigation and a low score to a shallow one.
You did not write the case. Judge it from the data that the agent sees.

## Read

- `evals/cases/<case-id>/`: `case.json` (mainly `input`), the graders, and the transcripts in `fixtures/`.
- The incident in `seed/incidents.py` and the noise items in `seed/noise.py` that the case selects.
- `data/<case-id>/`: the files that the agent reads. Do not use `labels.json` to judge what the agent can see.
  The agent does not get it.

## Check

### 1. Difficulty

- Can the agent find the root cause with one query or one log search? Which query?
- Does the first alert or the first obvious query show the cause directly?
- Can an agent that only reads `alerts.json` and `events.json` guess the answer?

### 2. False leads and dead ends

- List the signals that point the wrong way: noise items, unrelated deploys or config changes, normal-looking
  metrics, and spikes in other services.
- For each one, explain how a weak agent can follow it and what the agent must check to reject it.
- Is there no false lead at all? Then the case is too easy.

### 3. The input

- Does the input name the cause, the faulty service, the change, or the fix? Quote the words.
- Does it look like a real pager alert: alert name, severity, time, rule, and value?
- Does it give the current time?
- Is it too vague for any agent to start, or too specific?

### 4. Depth

- Write the shortest path from the symptom to the root cause as steps. For example:
  `OrdersStuckPending` → Order service is healthy → no `payment.succeeded` events → Payment rejects webhooks →
  config change at 08:12.
- Count the steps. Each step is a tool call whose result gives the reason for the next call.
- Which step must a weak agent miss to fail?

### 5. Grader separation

- Write a short transcript for a **weak agent**. It follows the most likely false lead, or it stops after the first
  plausible cause. Save it in your scratchpad.
- Write a short transcript for a **good agent** with a different tool order than the sample.
- Run the checker on both and record the scores:

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --transcript <path>
```

- Is the score difference large? A good case gives the weak agent less than half of the points.

## Score

Give each part a score from 1 to 5.

| Part | 1 | 5 |
| --- | --- | --- |
| Difficulty | One query gives the answer. | The agent must combine several sources. |
| False leads | No false lead. | Plausible false leads that the data can reject. |
| Input | It gives away the cause, or it is not like a real page. | A real page that names only the symptom. |
| Depth | The symptom is the cause. | Four or more steps from symptom to cause. |
| Grader separation | The weak agent gets almost the same score. | The weak agent gets less than half. |

## Report

Write the report to `evals/cases/<case-id>/reviews/discrimination.md` in this form. Use short sentences.

```markdown
# Discrimination review: <case-id>

| Part | Score |
| --- | --- |
| Difficulty | n/5 |
| False leads | n/5 |
| Input | n/5 |
| Depth | n/5 |
| Grader separation | n/5 |

## Path from symptom to cause

1. <step> (tool and evidence)

## False leads

- <signal>: <how a weak agent follows it> / <how to reject it>

## Test transcripts

| Transcript | Trajectory | Outcome | Total |
| --- | --- | --- | --- |
| Weak agent: <short description> | n/5 | n/5 | n/10 |
| Good agent: <short description> | n/5 | n/5 | n/10 |

## Findings

1. **<short title>**
   - Evidence: <what you saw>
   - Fix: <what to change in the input, the seed, the noise selection, or the graders>
```

Change only the report file.
