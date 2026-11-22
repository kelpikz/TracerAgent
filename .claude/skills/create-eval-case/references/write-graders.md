# Write the graders

Each case has two graders. Each grader has two parts.

| Grader | Question | Folder |
| --- | --- | --- |
| Trajectory | Did the agent investigate in the right direction, efficiently, and correct its course? | `trajectory/` |
| Outcome | Did the agent find the real fault, its impact, and the next steps? | `outcome/` |

| Part | File | What it does |
| --- | --- | --- |
| Deterministic | `tests.js` | Reads the transcript (all tool calls, their results, and the final answer). Runs fixed checks. Returns `{ item_name: score }`. |
| LLM rubric | `prompt.md` | The judge reads this prompt, the case input, and the transcript. It gives a score to each item. |

Each grader gives up to 5 points. The JavaScript part and the judge part each count for half. The total is out of 10.
For the helper functions and the score format, see the [grader reference](graders.md).

## 1. Make the evidence map

Make this table before you write a grader. Both graders use it. Take the facts from the generated data in
`data/<case-id>/` and from the incident `info`. Take the tool names and arguments from `agent/telemetry/tools.js`.

| Step | Fact | Tools that show it (all acceptable) | Key arguments | Time window | What the result shows |
| --- | --- | --- | --- | --- | --- |
| Symptom | The alert and its start | `list_alerts` | — | the alert time | the alert fires at 08:28 |
| Cascade | Each service on the path from symptom to cause | `query_metric`, `compare_windows`, `get_service_health`, `kafka_lag` | the service or label | the fault window | the changed values |
| Cause | The trigger | `list_changes`, `search_logs`, `log_patterns` | the faulty service | around the start | the change or the error |
| False lead | Each noise item or signal that points the wrong way | the tool that rejects it | — | — | why it is not the cause |
| Impact | Customer effect | `business_kpis`, `stuck_orders`, `get_order_timeline` | — | the fault window | counts, durations |
| Recovery | The fix and the return to normal | `query_metric`, `list_changes` | — | after the fix | normal values |

Also record:
- **The minimum path.** The smallest set of calls that gives all the necessary evidence. Count the calls.
- **The normal path.** The calls that a good agent makes when it follows its prompt
  (`agent/architectures/*.js`, "How to work"). Start from the minimum path. Add the checks that the prompt asks for
  (changes, cron logs, KPIs, "did it stop"). Add one call for each extra service, because most tools look at one
  service at a time. Count the calls. It is usually about 2 to 3 times the minimum path for an angent doing an exhaustive check. So don't penalize it for it.
  If real runs of the case exist (`evals/results/<case-id>/`), compare with their call counts.
- **The dead ends.** The calls that a weak agent can make first, and the result that must make it change course.

## 2. Trajectory grader

The trajectory grader checks the trail of the agent:
- **Direction.** Did it check the right metrics, in the right services, with the right tools, before its conclusion?
- **Efficiency.** How many calls did it use, compared with the normal path?
- **Course correction.** When it went down a wrong path, did it notice and change direction?

### `trajectory/tests.js`

Make one item for each necessary row in the evidence map, and one item for efficiency.

| Item | Score |
| --- | --- |
| One item for each necessary fact (`checked_<fact>`) | 1: a successful call to an acceptable tool, with the right service or label, and a time window that covers the fact. 0.5: the right tool and service, but the window misses part of the fact. 0: no call, a failed call, or the wrong service. |
| `checked_<cause>_before_conclusion` (only when the order matters) | 1: the agent gets the cause evidence after the symptom evidence that leads to it. 0: the order is wrong or a step is missing. |
| `efficiency` | 1: at most 2.5 times the normal path. Then decrease to 0 at 4 times the normal path. Do not use the minimum path here: a good agent that follows its prompt gets 0. |

Rules:
- Accept every tool that shows the fact. Do not require one tool when another tool gives the same evidence.
- Match only the necessary arguments. Use a function matcher for nested arguments (`args.labels?.service`).
- A call with an `error` gets no credit.
- A time window gets credit when it overlaps the fact's window. Use `Date.parse` to compare. A call without
  `from` and `to` uses the tool's default window. Check if that default covers the fact.
- Check the order only when one result gives the reason for the next call.
- Do not check course correction in JavaScript. It needs judgment.

### `trajectory/prompt.md`

The judge grades what needs judgment. Use these items, and add items for the case:

1. **followed_the_cascade**
   - 1. The agent moves from the symptom along the service path to the cause. Each step uses a result from the step before.
   - 0.5. The agent reaches the cause, but skips steps or guesses part of the path.
   - 0. The agent jumps to a cause with no path, or never reaches it.
2. **course_correction**
   - 1. The agent checks a false lead, sees the evidence that rejects it, and changes direction. Or it rejects the lead
     with evidence before it follows it.
   - 0.5. The agent leaves the false lead, but gives no evidence for the change.
   - 0. The agent stays on the false lead, or it never checks the lead and the answer depends on it.
   Name the false leads from the evidence map in this item.
3. **efficiency**
   Do not count the calls of the normal path as waste. Waste is: the same query again with no new purpose, the same
   fact read from two tools, and calls on unrelated areas after the cause is clear. Name these unrelated areas for the case.
   - 1. Two or fewer wasted calls.
   - 0.5. Three to six wasted calls, but the investigation stays on track.
   - 0. More than six wasted calls, or the investigation goes off track.

Write the expected path, the normal path (with its call count), and the false leads in the rubric. The judge does not see the labels or the data.

## 3. Outcome grader

The outcome grader checks the final answer:
- **Root cause.** Did the agent find the real fault?
- **Mechanism and trigger.** Did it explain how the fault happens and what started it? Did it separate the fault from the noise?
- **Impact.** Did it state who and what is affected, and for how long?
- **Next steps.** Did it give an action that the data supports? Did it say if the problem has cleared, when that matters?

### `outcome/tests.js`

Keep these checks few and simple. Use text checks only where the words have clear matches.

| Item | Score |
| --- | --- |
| `names_trigger` | 1: the answer names the trigger (for example the secret rotation). Use regular expressions with synonyms. |
| `names_faulty_service` | 1: the answer names the service where the fault is. |
| `no_noise_as_cause` | 1: the answer does not name a noise item or a false lead as the cause. 0: it does. Check for words that only a wrong cause uses. |
| `states_recovery` | Only when recovery matters. 1: the answer says if the problem has cleared. |

Rules:
- Do not require an exact phrase. Accept different words for the same idea.
- Check numbers only when the incident code sets them. Use a tolerance. Do not check values from random baseline traffic.
- An empty answer gets 0 for each item. A check like "does not name X" must also give 0 to an empty answer.

### `outcome/prompt.md`

The judge grades correctness and support. Use these items:

1. **root_cause**
   - 1. The answer names the real fault and the trigger. The evidence supports both.
   - 0.5. The answer names the right area (for example "Stripe webhooks fail") but not the trigger.
   - 0. The cause is wrong, missing, or only a guess.
2. **mechanism**
   - 1. The answer explains how the trigger causes the symptom, step by step, and why the false leads are not the cause.
   - 0.5. The mechanism is partly correct, or the false leads are not addressed.
   - 0. No mechanism, or a wrong one.
3. **impact**
   - 1. The answer gives the customer impact and its size and duration, close to the data. It also says what is not affected.
   - 0.5. The impact is in the right direction, but without size or duration, or with a wrong part.
   - 0. No impact, or a wrong impact.
4. **next_steps**
   - 1. The action fixes the cause or confirms recovery, and the data supports it. It does not suggest harmful or unrelated actions.
   - 0.5. The action is reasonable, but generic.
   - 0. No action, or an action that does not match the cause.
5. **evidence**
   - 1. Each main claim cites a tool result (a metric, a log, a change, or an ID).
   - 0.5. Some claims have no evidence.
   - 0. The answer has no evidence, or it states facts that the transcript does not show.

Put the expected facts in each item: the cause, the trigger time, the impact numbers with a tolerance,
the recovery time, and the correct actions. Ask the judge to give a short reason for each score.

## 4. Fixtures

Save two transcripts in `fixtures/`:

| File | Contents | Target score |
| --- | --- | --- |
| `good_transcript.json` | The minimum path or close to it, with the correct answer. | Full score |
| `bad_transcript.json` | A plausible weak agent: it follows a false lead or stops at the first plausible cause. Keep one correct part. | Less than half |

Write the steps and the final answer. Then fill in the real tool results:

```sh
node .claude/skills/create-eval-case/scripts/fill-transcript.js <case-id> <draft.json> --out evals/cases/<case-id>/fixtures/good_transcript.json
```

The script runs the agent's tools on `data/<case-id>/`. Read the results. Make sure that the final answer matches them.

## 5. Check

```sh
node .claude/skills/create-eval-case/scripts/check-case.js <case-id>
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --transcript evals/cases/<case-id>/fixtures/bad_transcript.json
node .claude/skills/create-eval-case/scripts/check-case.js <case-id> --judge
```

- The good transcript gets a full score. If not, fix the grader or the transcript.
- The bad transcript gets less than half. If not, the graders do not separate a weak agent from a good agent.
- The empty transcript gets 0 for each JavaScript item.
- With `--judge`, read the reason for each judge score. Make the rubric clearer where the judge is not sure.

## Common mistakes

- A check gives credit for the right tool on the wrong service, or for a failed call.
- A check requires one tool when another tool gives the same evidence.
- A check requires an exact phrase or an exact start time.
- A check expects a value that comes from random baseline traffic.
- The rubric repeats the JavaScript checks and does not grade the mechanism or the impact.
- The rubric expects a fact that only the labels show.
- A "does not name X" check gives points to an empty answer.
