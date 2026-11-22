export default function grade(transcript, { helpers }) {
  const answer = helpers.finalText(transcript).replace(/[`*_]/g, '');
  const statements = answer.split(/(?<=[.!?;])(?=\s|$)|\n+/)
    .filter(line => !line.trim().endsWith('?')).flatMap(line => line.split(/\s+but\s+/i));
  const proposed = /^\s*(?:[-#>]\s*)*(?:if|check|verify|test|investigate|consider|confirm|rule out)\b/i;
  const observed = statements.filter(line => !proposed.test(line));
  const asserts = pattern => observed.some(line => pattern.test(line)
    && !/\b(?:no|never|not|didn['’]t|wasn['’]t|hasn['’]t)\b/i.test(line));
  const auth = /\b(?:auth|canary)\b/i.test(answer);
  const pool = /\b(?:pool|database handles|connection (?:capacity|slots?|limit))\b/i;
  const reduced = /\b(?:cut|shrank|shrunk|reduc|lower|cap|limit|went|drop|restrict)\w*\b/i;
  const pair = /\b(?:to|at|only|with)\s+(?:just\s+)?(?:2|two|a pair)\b|(?:→|->)\s*(?:2|two)\b|\b(?:2|two)[- ](?:connections?|slots?|handles?)\b/i;
  const changed = auth && observed.some(line => pool.test(line) && reduced.test(line) && pair.test(line)
    && !/\b(?:never|not|didn['’]t)\b/i.test(line));
  const wrongCause = asserts(/\bcause (?:was|is) (?:the )?newsletter\b|\busers postgres (?:outage|overload|saturation)\b|\bnewsletter (?:traffic )?(?:caused|overwhelmed|overloaded)\b/i);
  return {
    identifies_canary_pool_change: Number(changed && !wrongCause),
    identifies_listener_contention: Number(auth && pool.test(answer) && !wrongCause
      && asserts(/\b(?:listener|watcher)\w*\b.*\b(?:held|hold|occup|exhaust|consum|us(?:e|ing|ed)|pinn|took|kept)\w*|\b(?:held|occupied|used|consumed) by\b.*\b(?:listener|watcher)\w*/i)),
    states_recovery: Number(auth && /\b(?:roll(?:ed)?\s*back|rollback|revert|restor|reset|reinstat)\w*\b/i.test(answer)
      && asserts(/\b(?:cleared|recovered|resolved|ended|stopped|returned to (?:normal|baseline)|back (?:to normal|at (?:their )?usual levels))\b/i)
      && !wrongCause),
  };
}
