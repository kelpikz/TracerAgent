# Grade the final answer

The page is EmailsFailing at 11:55 UTC. The current time is 12:00 UTC.

**Expected facts.**
- Root cause: the `winback_campaign` job in Notification. Marketing turned it on at 10:38 UTC (a config change, "Turn on winback_campaign job"). It runs at 10:45, 11:15 and 11:45 and sends thousands of win-back emails (9,666, 6,217 and 7,164) as fast as it can. It uses the same email API key (`sg_main`) as the order emails. The provider allows 600 requests per minute for the key and returns `429 Too Many Requests` for the rest. The provider is healthy. It only applies the key limit.
- Mechanism: in each run (10:45 to 11:03, 11:15 to 11:27, 11:45 to 11:59) the job and the order emails share the 600 per minute. Most order emails get 429. Notification retries each one 2 times (after about 30 s and 2 min), then moves it to the DLQ. Many order emails fail on the first try, and about 420 go to the DLQ (419 with 429 in 10:30 to 12:00). Email requests go from about 60 to over 1,000 per minute (peak 1,643). `EmailsFailing` fires at 10:55, 11:25 and 11:55. Between the runs, emails are normal. The job runs every 30 minutes, so the next run is at 12:15.
- False leads: an email provider outage (it is healthy), the newsletter from 10:00 to 10:30 (marketing's own tool, ends before the first run), the Notification deploy at 03:30 (emails are normal for 7 hours after it), Notification OOM restarts (the lag drains in minutes), and the `DlqGrowing` messages from deleted-user accounts (error 550, not 429). A false lead named only as a time reference is not an error.
- Impact: order emails (order received, confirmed, shipped, delivered) fail or arrive late during each run. Most arrive 30 s to 2.5 min late. About 420 go to the DLQ and are not sent. It repeats every 30 minutes while the job is on. Checkout, payment and delivery work. A customer can pay but get no confirmation email. Accept a DLQ count from 350 to 480, when the answer names the measure. The first-try failure count (about 1,465) is only in the labels: do not require it, and accept an estimate from 1,200 to 1,750.
- State: the third run ended at about 11:59. Emails are normal at 12:00, but the fault is not fixed. The job runs again at 12:15.
- Correct actions: pause the `winback_campaign` job now. Replay the DLQ messages from this fault (429 errors) after that. Do not replay the 550 deleted-user messages. Before the job runs again, give it its own API key (or provider), or a send limit well under the key limit (600 per minute for all sends on `sg_main`). Check that 429s stop at the next :15 or :45. Good extra actions: alert on 429 rates, send order emails with a higher priority than marketing emails. Wrong actions: contact the provider to find an outage, roll back the 03:30 deploy, restart Notification, or stop the newsletter.

Give a short reason for each score. An empty answer, or an answer with no diagnosis of this incident, gets 0 for each item.

Grade the meaning, not the keywords. A list of keywords or facts with no real sentences (no cause, no link between the facts, no reason) gets 0 for `mechanism` and 0.5 at most for the other items. A fact that no tool result in the transcript supports gets no credit in any item: do not give a high score only because the answer states the right fact.

1. **root_cause**
   - 1. The answer names the `winback_campaign` job as the cause, says that marketing turned it on at 10:38 (or says that it is new and turned on shortly before 10:45), and says that it uses the same API key and quota as the order emails. The evidence supports it.
   - 0.5. The answer names the right area ("email rate limit", "429 from the provider", "something uses the quota") but not the job, or names the job but not the shared key or the turn-on.
   - 0. The answer blames a provider outage, the newsletter, the OOM restarts, the deleted-user DLQ messages, the 03:30 deploy, or the cause is a guess. "The provider rate-limits us, contact the provider" with no job is 0.5 at most.
2. **mechanism**
   - 1. The answer explains the chain: the job sends over 600 requests per minute on the key, the provider returns 429, order emails fail in the same runs, Notification retries 2 times and then moves the message to the DLQ, and emails are normal between the runs. It says why the false leads are not the cause (at least the provider health or the 429 versus 550 difference, and the newsletter or the OOM restarts).
   - 0.5. The chain is partly correct, for example the 429 and the retries without the link to the job, or the false leads are not addressed.
   - 0. No chain, or a wrong one (for example a provider outage or a crash loop).
3. **impact**
   - 1. The answer gives the customer effect with a measure and a window (order emails fail or are late in the runs, about 420 in the DLQ, close to the number above, or an estimate of the first-try failures). It says that it repeats every 30 minutes, and that checkout and payment work.
   - 0.5. The impact is in the right direction, but without a measure, a window or a repeat, or with one wrong part (for example "checkout fails").
   - 0. No impact, or a wrong impact.
4. **next_steps**
   - 1. The answer gives both: pause the `winback_campaign` job now, and give it its own key or a send limit before it runs again. It also says to replay the DLQ messages from this fault (not the 550 ones), and how to check the result (no 429 at the next :15 or :45). It does not suggest a wrong action.
   - 0.5. The answer gives the pause but not the long-term fix or the DLQ replay, or gives generic actions ("raise the limit with the provider", "add monitoring").
   - 0. No action, or a wrong action that the answer recommends (contact the provider for an outage, roll back the deploy, restart Notification, stop the newsletter). A warning not to do a wrong action is correct, not a penalty.
5. **evidence**
   - 1. Each main claim cites a tool result from the transcript: the 10:38 change, the log lines (`winback campaign run started` with its recipient count, the 429 line with `sg_main`), the request volume, the alert times, the DLQ count.
   - 0.5. Some main claims have no evidence.
   - 0. The answer has no evidence, or it states facts that the transcript does not show.
   Check each number, time, ID and claim in the answer against the tool results in the transcript. A claim that no tool result supports (for example a DLQ count, a "429 only" split, or a job name the agent never saw) is not evidence. Give 0.5 at most when the answer has such claims, and 0 when its main claims are unsupported. Do not give credit for a correct claim that the agent only guessed.
