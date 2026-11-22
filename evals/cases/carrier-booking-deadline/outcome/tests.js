export default function grade(transcript, { helpers }) {
  const answer = helpers.finalText(transcript).replace(/[`*_]/g, '');
  const statements = answer.split(/(?<=[.!?;])(?=\s|$)|\n+/)
    .filter(line => !line.trim().endsWith('?')).flatMap(line => line.split(/\s+but\s+/i));
  const proposed = /^\s*(?:[-#>]\s*)*(?:if|check|verify|test|investigate|consider|confirm|rule out)\b/i;
  const asserts = match => statements.some(line => !proposed.test(line) && match(line)
    && !/\b(?:never|not|didn['’]t|wasn['’]t|hasn['’]t)\b|^\s*no\b|\bno (?:shipments?|bookings?|backlog|retry queue)\b/i.test(line));
  const local = /\b(?:client|delivery)\b/i.test(answer);
  const limit = /\b450\s*(?:ms|milliseconds?)\b|\b0\.45\s*(?:s|seconds?)\b/i;
  const tooShort = /\b(?:too short|too low|shorten|reduc|lower|cut)\w*\b/i;
  const changed = local && asserts(line => (
    /\b(?:deadline|timeout|time out)\b/i.test(line) && (limit.test(line) || tooShort.test(line)))
    || (limit.test(line) && tooShort.test(line) && /\b(?:booking|POST \/shipments)\b/i.test(line)));
  const wrongCause = asserts(line => /\bmaintenance (?:outage )?(?:caused|triggered)\b|\bcause (?:was|is) (?:the )?(?:carrier )?maintenance\b/i.test(line));
  return {
    identifies_short_client_deadline: Number(changed && !wrongCause),
    reports_delayed_bookings: Number(asserts(line => /\b(?:bookings?|shipments?|shipping labels?)\b/i.test(line)
      && /\b(?:delay|queued|backlog|wait)\w*\b/i.test(line) && !/\bmaintenance\b/i.test(line))),
    reports_retry_recovery: Number(asserts(line => /\b(?:retr[yi]\w*|queue|backlog|deferred jobs)\b/i.test(line)
      && /\b(?:drained|cleared|caught up|recovered|zero|empty|completed)\b/i.test(line) && !/\b(?:maintenance|01:20)\b/i.test(line))),
  };
}
