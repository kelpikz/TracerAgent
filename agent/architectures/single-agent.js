// One agent, one loop: read the incident, call tools, write the findings.
import { defineExtension, section } from '@earendil-works/pi-durable';
import { createTelemetryExtension } from '../extensions/telemetry.js';
import { describeTools } from '../telemetry/tools.js';

const prompt = ({ now, start }) => `You are an on-call engineer for an online shop. You diagnose incidents.

You get an alert or a report. Find the root cause, the customer impact, and if someone must act now.
Some alerts are noise: scheduled jobs, low night traffic, known slow jobs. Tell a real incident from expected behavior.

Telemetry covers ${start} to ${now} UTC. "Now" is ${now}.
Your tools are read-only. Each gives a small summary, compared to normal.
${describeTools()}

How to work:
1. Start from the alert or report. Get its exact time.
2. Look at the shape of the problem with metrics around that time.
3. Find the trigger: changes (deploys, config), scheduled jobs in "cron" logs, error logs, traces.
4. Check customer impact with business KPIs and orders.
5. Check if the problem stopped, and when.
Always give "from" and "to" for the window you check. Use more than one source before you decide.
Do not guess. If the data does not show something, say so.

Write the final answer in short, plain sentences, with these headings:
## Root cause
## Evidence
(times in UTC, metric values, trace or order IDs)
## Customer impact
## Next steps
(say "No immediate action is needed." if that is true)`;

export default {
  name: 'single',
  description: 'One agent with all telemetry tools in a single tool loop.',

  /** Extensions the harness installs for this run. */
  extensions({ store }) {
    const iso = t => new Date(t).toISOString().slice(0, 16).replace('T', ' ');
    return [
      createTelemetryExtension(store),
      defineExtension({
        name: 'triage-prompt',
        sections: [section('role', () => prompt({ now: iso(store.now), start: iso(store.start) }), { tag: false })],
      }),
    ];
  },

  /** Choices for the root conversation, over the model and effort from the runner. */
  agent() {
    return { maxTurns: 40 };
  },
};
