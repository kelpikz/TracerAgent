export default function grade(transcript, { helpers }) {
  const answer = helpers.finalText(transcript).replace(/[`*]/g, '');
  const statements = answer.split(/(?<=[.!?;])(?=\s|$)|\n+/)
    .filter(line => !line.trim().endsWith('?')).flatMap(line => line.split(/\s+but\s+/i));
  const proposed = /^\s*(?:[-#>]\s*)*(?:if|check|verify|test|investigate|consider|confirm|rule out)\b/i;
  const asserts = pattern => statements.some(line => !proposed.test(line) && pattern.test(line)
    && !/\b(?:no|never|not|didn['’]t|wasn['’]t)\b/i.test(line));
  const sort = /\bsupplier[_ -]?rank\b|\b(?:supplier|vendor) (?:ranking|rank|priority)\b/i;
  const rollout = statements.some(line => !proposed.test(line) && sort.test(line)
    && /\b(?:changed?|switched?|introduced?|set|added|made|new|default|rolled out|deploy|release)\w*\b/i.test(line)
    && !/\b(?:no|never|not)\b/i.test(line));
  const plan = asserts(/^(?!.*\b(?:unrelated|index scan)\b).*\b(?:sequential scan|seq scan|scans?\b.*\b(?:sorts?|heap[- ]orders?))\b/i);
  const wrongCause = asserts(/\b(?:because of|caused by|due to|cause (?:was|is))\s+(?:the )?(?:GC\b|garbage collection|replication lag)|\b(?:GC|replication lag) (?:caused|triggered)\b/i);
  return {
    identifies_sort_change: Number(rollout && !wrongCause),
    connects_sort_to_replica: Number(sort.test(answer) && /\b(?:replica|read follower)\b/i.test(answer) && plan && !wrongCause),
    states_ongoing_latency: Number((sort.test(answer) || /\b(?:catalog|product lists?|gateway latency)\b/i.test(answer)) && (
      asserts(/\b(?:ongoing|still (?:slow|active|firing|elevated)|remains? (?:slow|active|elevated)|(?:as of|through|at) (?:noon|12:00|now)|persists? through the latest minute)\b/i)
      || /\bhas not (?:recovered|cleared)\b/i.test(answer))),
  };
}
