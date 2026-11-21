# Review 1: correctness

You are an independent reviewer. Check that the eval case is correct and complete.
You did not write the case. Do not trust the author's text. Check each claim against the generated data.

## Read

- `evals/cases/<case-id>/`: `case.json`, both `tests.js` files, both `prompt.md` files, the transcripts in `fixtures/`.
- The incident function in `seed/incidents.py` and the noise items in `seed/noise.py` that the case selects.
- `data/<case-id>/`: `labels.json`, `alerts.json`, `events.json`, `metrics.json`, `logs.jsonl`, `traces.json`,
  `orders.json`, and `topology.json`. Use short scripts to read the large files.
- `seed/generate.py` for the baseline services, metrics, and alert rules.

## Check

### A. Completeness of the cascade

Use `topology.json` to follow the fault from its cause to each part that depends on it:
HTTP calls, Kafka topics and consumer groups, databases, providers, emails, and business metrics.

For each part, answer:
1. Must the fault change this part? Why?
2. Does the data show the change in metrics, logs, traces, or orders? Give the metric name, the log message, or the ID.
3. Are the numbers consistent between the parts? For example, the orders that are not paid must also send no
   confirmation email.
4. Does a baseline sample in the fault window contradict the fault? For example, a normal log line in a service
   that must fail.
5. Do the alerts fire only when their rules are true? Are the alert times correct?

List each missing or wrong effect as a finding.

### B. Correctness of the checks

For each item in `trajectory/tests.js`, `outcome/tests.js`, and both `prompt.md` files:

1. **False positive.** Can a wrong investigation or a wrong answer get credit? Write a short example.
   For example, the agent names the correct service but the wrong cause, or calls the correct tool for the wrong time.
2. **False negative.** Can a correct investigation or answer get no credit? For example, a different correct tool
   order, a different useful time window, or different words.
3. **Facts.** Is each expected fact true in the generated data? Is any fact only in the labels?
4. **Coverage.** Is evidence for the cause, the cascade, the impact, the recovery, or the action not graded?
   Do the checks grade everything that a good answer needs?
5. **Empty transcript.** Does an empty or nonsense transcript get any points?

Run the checker to see the scores:

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id>
```

To test a false positive or false negative, write a short transcript to your scratchpad and run the checker with
`--transcript <path>`.

## Score

Give each part a score from 1 to 5.

| Score | Meaning |
| --- | --- |
| 5 | No findings. |
| 4 | Small findings. The case is usable. |
| 3 | Some effects or checks are missing. Fix before use. |
| 2 | Important effects or checks are wrong. |
| 1 | The case does not test the fault. |

## Report

Write the report to `evals/cases/<case-id>/reviews/correctness.md` in this form. Use short sentences.

```markdown
# Correctness review: <case-id>

| Part | Score |
| --- | --- |
| Completeness of the cascade | n/5 |
| Correctness of the checks | n/5 |

## Findings

1. **<short title>** (cascade | false positive | false negative | fact | coverage)
   - Evidence: <file, metric, log, ID, or test transcript and score>
   - Fix: <what to change>

## Checked and correct

- <each part of the cascade and each check that is correct, with its evidence>
```

Change only the report file.
