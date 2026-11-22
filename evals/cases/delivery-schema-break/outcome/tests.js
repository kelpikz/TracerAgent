// Checks on the final answer. The rubric grades the meaning. Each check needs an affirmed claim about this
// incident: a sentence that denies a fact ("the carrier is a red herring") does not count.
// The cause has the most weight. The items that depend on it need a sentence that links the Order deploy to the
// Delivery failure or the schema change, and no false lead as the cause. A wrong-cause answer scores below half.
// Sentences end at . ! ? ; or a new line, but not at the dots in a version or a decimal.
const sentences = text => text.split(/[.!?;](?=\s|$)|\n+/).map(s => s.trim()).filter(Boolean);

// A sentence that says a fact is not the cause or not true.
const DENY = /red herring|\bnot (?:the|a) (?:root |real |main )?cause|\bnot related|\bunrelated|\bruled? out|\birrelevant|\binnocent|false lead|\bdistraction|\bdid(?: not|n't) (?:cause|matter)|\bnot (?:the )?(?:problem|issue)\b/i;
// Words that make a sentence a statement about a healthy or normal part.
const CALM = /\b(?:is|was|are|were) (?:fine|healthy|ok|okay|normal)\b|\bnormal\b|\bhealthy\b/i;
// Words that reject a false lead: a separate issue, a small issue, or an issue that drains.
const REJECT = /\bseparate\b|\bknown (?:issue|problem)\b|\bdrain\w*|\bharmless\b|\bminor\b|\bshort[- ]lived\b/i;
// Words that tell the reader not to do the action that follows them.
const DONT = /\b(?:do not|don't|never|avoid|should not|shouldn't|must not|mustn't|cannot|can't|no need to|not an option|not a good idea)\b/i;
// Words that say an action is wrong or has a bad result. They turn a harmful action into a warning.
const WARNING = /\b(?:would|will|could|can|may|might)\s+(?:\w+\s+){0,3}(?:lose|never|leave|drop|cause|break|hide)\b|\bnot an option\b|\b(?:is|are|would be) (?:not|never) (?:an option|acceptable|safe|ok|okay|allowed|advised|recommended|a good idea)\b|\bbad idea\b|\bdangerous\b|\brisky\b|\bunsafe\b|\bloses? (?:the |all |those )?(?:orders?|messages?|events?|data)\b|\bnever ship/i;
// A plan for the future, such as a DLQ for parse errors, is not a harmful action now.
const NEW_DLQ = /\b(?:add|create|build|set up|introduce)\s+(?:a |an )?(?:dlq|dead[- ]letter)/i;
const FUTURE = new RegExp(/\b(?:later|in the future|in future|in case|next time|prevent\w*|going forward|long[- ]term)\b/.source + '|' + NEW_DLQ.source, 'i');
// "X rather than Y" and "X instead of Y": only X is recommended.
const head = s => s.split(/\b(?:rather than|instead of)\b/i)[0];

// The false leads: the carrier, the Notification leak or DLQ, the cart deploy, the stuck order.
const LEAD = /carrier (?:maintenance|outage|api|errors?|problem|issue|failure|timeouts?|is down)|\bcarrier (?:is|was|are|were) (?:down|failing|slow|timing out|erroring|unavailable|broken|rejecting)|maintenance window|notification (?:memory|oom|leak|pod|consumer|dlq)|memory leak|oomkilled|\bdlq\b|dead[- ]letter|deleted (?:user|mailbox|account)|\bcart\b|v2\.1\.0|3-?d secure|\b3ds\b|stuck (?:pending )?order/i;
// The same leads by name only. A name with "is the root cause" is a wrong cause.
const BARE = 'carrier|notification|cart|dlq|dead[- ]letter|memory leak|3-?d secure|3ds|stuck order|stripe|redis';
// The carrier is said to be broken. In this incident it is healthy.
const CARRIER_BROKEN = /\bcarrier\b[^,;]{0,25}\b(?:fails?|failing|failed|is down|are down|rejects?|rejecting|times? out|timing out|stopped|unavailable)\b/i;
const CAUSAL_AFTER =/\b(?:caused?|causes|causing|was responsible|is responsible|explains|is behind|was behind|triggered|broke|changed|altered|modified|is to blame|(?:is|was) the (?:root |real |main )?cause|so)\b/i;
const CAUSAL_BEFORE = /\b(?:caused by|due to|because of|blame|(?:root|real|main) cause (?:is|was)|wait(?:ing)? for)\b/i;
const OPEN = /\bstill\b|\bongoing\b|\bremains? (?:open|active|stuck)\b|\bactive\b|\bcontinu\w*\b|\bgrow\w*\b|\bworsen\w*\b|\brising\b|\brises\b|\bclimb\w*\b|getting worse|\bnever drain\w*|\b(?:not|n't)\s+(?:been\s+)?(?:yet\s+)?(?:fixed|over|finished|recovered|resolved|cleared|drain\w*|stopped|gone|normal)\b|\bstands? at\b|\b(?:lag|backlog)\b[^.]{0,30}\b[1-9],?\d{3}\b/i;
// Words that make a sentence about a plan, a check or a recovery, not about the state now.
const NOT_NOW = /\bhealthy\b|\brecovered\b|\bimprov|\bonce\b|\bafter\b|\buntil\b|\bwhen\b|\bcheck\b|\bverify\b|\bconfirm\b|make sure|so that|\bwill (?:drain|fall|clear|recover)|\bdrains?\b|\bdrained\b/i;
// A negated word ("has not recovered", "does not drain") is not a recovery.
const NEGATED = /\b(?:has(?:n't| not)|have(?:n't| not)|is(?:n't| not)|are(?:n't| not)|does(?:n't| not)|do(?:n't| not)|not|never|no)\s+(?:(?:been|yet|be|fully|still)\s+)*\w+/gi;
// The answer says when the fault starts: the deploy at 10:48, or about 70 minutes.
const START = /\b10:4[89]\b|\b(?:6[5-9]|7[0-5]) ?(?:min|minutes)\b|\b(?:about|over|more than|nearly) an hour\b/i;
// Function words. Real text has many of them. A list of keywords has none.
const FUNCTION_WORDS = new Set(['the', 'a', 'an', 'to', 'is', 'are', 'was', 'were', 'of', 'and', 'it', 'in', 'so', 'because', 'with', 'that', 'for', 'by', 'from', 'on', 'at', 'as', 'this', 'its', 'not', 'no', 'be', 'then', 'but', 'or', 'now', 'has', 'have', 'can', 'will']);

// The harmful actions: skip, ignore, delete, purge or move aside the stuck message, or move the offset.
// Each pattern holds its object, so "clear the backlog" and "acknowledge the alert" do not match.
const OBJ = '(?:the |this |that |those |these |any |all |each |a |an )?(?:stuck |bad |failing |failed |poison |problem |broken |old |v2 )*(?:messages?|events?|records?|offsets?|failures?)\\b';
const IT = '(?:it|them)\\b';
const SKIP = new RegExp([
  `\\bskip\\w*\\b(?!\\s+(?:nothing|none|no\\b))[^.]{0,25}\\b(?:messages?|events?|records?|offsets?|it|them)\\b`,
  `\\bignor\\w+\\s+(?:${OBJ}|${IT})`,
  `\\bdelet\\w+\\s+(?:${OBJ}|${IT}|(?:the |all )?(?:topic|queue|backlog|partition)\\b)`,
  `\\b(?:purg|discard|flush|truncat|bypass)\\w*\\s+(?:${OBJ}|${IT}|(?:the |all )?(?:topic|queue|backlog|partition)\\b)`,
  '\\bfast[- ]?forward\\w*\\b',
  `\\backnowledg\\w+\\s+(?:${OBJ}|${IT})`,
  '\\bjump\\w*\\s+(?:over|past)\\b', '\\bstep\\w*\\s+over\\b',
  '\\bclear\\w*\\s+(?:out\\s+)?(?:the |all )?(?:topic|partition|(?:stuck|bad|failing)\\s+messages?)\\b',
  `\\bmark\\w*\\s+(?:${OBJ}|${IT})\\s+(?:as\\s+)?(?:processed|done|consumed|handled)`,
  // Move the bad message to a DLQ or aside by hand.
  `\\b(?:mov|send|sent|put|park|rout|push|sidelin)\\w*\\s+(?:${OBJ}|${IT})[^.]{0,30}\\b(?:dlq|dead[- ]letter|aside|out of the way|away|elsewhere)`,
  `\\bset\\w*\\s+(?:${OBJ}|${IT})\\s+aside\\b`,
  '\\b(?:advance|mov\\w+|bump)\\w*\\s+(?:the |that |this |its |a )?(?:consumer |group |delivery )*offsets?\\b',
  '\\b(?:reset|rewind|seek|set|resetting)\\w*\\b[^.]{0,30}\\b(?:offsets?|latest|earliest|end of (?:the )?(?:topic|log))\\b',
  '\\breset\\w*\\b[^.]{0,30}\\b(?:consumer )?group\\b', '\\bmov\\w+\\b[^.]{0,20}\\b(?:consumer|group)\\b[^.]{0,20}\\b(?:past|beyond|forward|ahead)\\b',
  '\\bcommit\\w*\\b[^.]{0,20}\\boffsets?\\b[^.]{0,20}\\b(?:past|beyond|manually|forward|ahead)\\b',
  `\\bdrop\\w*\\s+(?:${OBJ}|(?:the |all )?backlog\\b)`,
].join('|'), 'ig');

const wordsOf = text => text.toLowerCase().match(/[a-z0-9_.:']+/g) ?? [];
function looksLikeProse(text) {
  const words = wordsOf(text);
  const share = words.filter(w => FUNCTION_WORDS.has(w)).length / (words.length || 1);
  return words.length >= 20 && share >= 0.2;
}

// A sentence that names the Order v3.4.0 deploy (not the cart deploy).
const deployS = s => /\bv3\.4\.0\b|\border\b[^.]{0,30}\b(?:deploy\w*|release\w*|rollout|rolled out|new version|new build|update|change|version)\b|\b(?:deploy\w*|release\w*|rollout|update|change|version|build)\b[^.]{0,20}\border\b/i.test(s)
  && (!/\bcart\b|v2\.1\.0/i.test(s) || /v3\.4\.0/.test(s));

// The payload change: schema version 2, shipping_address is now an object (a nested structure).
const schemaS = s => /schema|shipping[_ ]address|address(?:es)? format|payload|order\.paid|message format|event format|data format|nested|structure|contract/i.test(s)
  && /\bv2\b|version 2|schema_version\W*2|\bobjects?\b|\bnested|\bstruct\w*|\bchang\w*|\bnew (?:schema|format|shape)|different (?:format|shape|schema)|\bstring\b|plain text|incompatible|breaking|\bbreak\w*|\bbroke\b|contract/i.test(s);

// Fault: the Delivery consumer cannot process one message, and retries it.
const stuckS = s => /\bdelivery\b|\bconsumer\b|\breader\b/i.test(s)
  && /\bstuck\b|cannot|can't|unable|\bfails?\b|failing|failed|\bretr\w+|keeps? trying|tries again|\bblocked\b|\bunmarshal\b|\bparse\b|\bparsing\b|\bstalled?\b|\bbroke\b|\bbroken\b|\bbreaks?\b|\bstops?\b|\bstopped\b|\bthrows?\b|\bcrash\w*|\bloops?\b|expects|\breject\w*|again and again|over and over|\brepeatedly\b/i.test(s)
  && /message|\bconsumer\b|offset|order\.paid|unmarshal|\bparse\b|parsing|shipping_address|event|record|\breader\b|address/i.test(s);

// A clause that tells the reader to ship or change something. A diagnosis ("Delivery fails to read v2") does not count.
const RECOMMEND = /^[\W\d]*(?:(?:then|also|next|later|first|second|third|and|or|now|please|finally)\b[\s,:]*)*(?:ship|deploy|release|update|patch|fix|add|make|teach|change|build|write|roll out)\b|\b(?:should|must|need\w*|have to|has to|please|recommend\w*|ought to)\s+(?:\w+\s+){0,3}?(?:ship|deploy|release|update|patch|fix|add|make|teach|change|build|write|roll out)\b|\b(?:delivery|consumer|reader)\s+(?:fix|patch|hotfix)\b|\b(?:fix|patch|hotfix) (?:for |to )?(?:the )?(?:delivery|consumer|reader)\b/i;

export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript) ?? '';
  const zero = { names_order_deploy: 0, deploy_changed_the_schema: 0, names_delivery_consumer_stuck: 0, no_false_lead_as_cause: 0,
    gives_start_time: 0, says_orders_not_shipping: 0, says_fault_still_active: 0, recommends_unblocking_fix: 0,
    does_not_skip_messages: 0 };
  // Nonsense and keyword lists get 0. The rubric judges the meaning of real text.
  if (!text.trim() || !looksLikeProse(text)) return zero;
  // A claim needs a real sentence: at least 3 words.
  const all = sentences(text).filter(s => wordsOf(s).length >= 3);
  const affirmed = all.filter(s => !DENY.test(s));
  const any = (re, list = affirmed) => list.some(s => re.test(s));

  const schema = affirmed.some(schemaS);
  const stuck = affirmed.some(stuckS);
  // The Order deploy is linked to the failure: the sentence with the deploy, or the next one, says that Delivery fails or that the schema changed.
  const linked = affirmed.some((s, i) => deployS(s) && [s, affirmed[i + 1]].some(x => x && (stuckS(x) || schemaS(x))));

  const clauses = all.flatMap(s => s.split(/,|\band then\b|\bthen\b/i).map(x => x.trim()).filter(Boolean));
  // A false lead named as the cause. A false lead after "before" or "after" is only a time reference.
  // A part after "not", "rather than" or "instead of" is not the cause that the answer names.
  // A sentence that calls the lead separate, small or draining rejects it.
  const blameable = all.filter(s => !DENY.test(s) && !CALM.test(s) && !REJECT.test(s) && !NEW_DLQ.test(s));
  const blamesLead = blameable.some(s => {
    const clause = s.replace(/\b(?:before|after|until|since|while)\b[^,;]*/gi, '')
      .replace(/\b(?:not|and not|rather than|instead of|unlike)\b[^,;]*/gi, '');
    return new RegExp(`(?:${LEAD.source})[^,;]{0,60}?${CAUSAL_AFTER.source}`, 'i').test(clause)
      || new RegExp(`${CAUSAL_BEFORE.source}[^,;]{0,40}?(?:${LEAD.source}|\\b(?:${BARE})\\b)`, 'i').test(clause)
      || new RegExp(`\\b(?:${BARE})\\b[^,;]{0,40}\\b(?:is|was) (?:the |a )?(?:root |real |main )?cause`, 'i').test(clause)
      || CARRIER_BROKEN.test(clause);
  }) || clauses.some(c => !DONT.test(head(c)) && /\bwait(?:ing)? for (?:the )?carrier|\bcarrier to (?:recover|come back|be fixed)|\bscale\w* (?:up )?notification/i.test(head(c)));

  // A diagnosis names the Order deploy as the cause of the Delivery failure, and no false lead as the cause.
  const cause = linked && !blamesLead;

  // Impact: the paid orders get no shipment and no carrier booking.
  const noShip = any(/\bno (?:shipments?|carrier bookings?|bookings?|tracking|parcels?|packages?|labels?|shipping)\b|\bnot (?:be(?:ing)? |yet |been |getting )?(?:shipped|booked|dispatched|sent out)|\b(?:do|does|did|will|can) ?not (?:ship|get (?:a )?(?:shipment|booking|tracking))|\bcannot be (?:shipped|booked)\b|\bnever (?:be |been |get |gets )?(?:ship|shipped|booked)\b|\bwithout (?:a |any )?(?:shipments?|carrier bookings?|bookings?|tracking)\b|\bbooks? no\b|\bshipments? (?:is|are|was|were) not (?:booked|created)\b|\bnot ship\b|\bnot (?:been )?sent to the carrier\b|\b(?:can't|cannot|can not|unable to|fails? to) (?:book|ship)\b|\bnothing (?:is |gets |was )?(?:shipped|booked)\b|\bnothing ships\b|\bno (?:paid |new )?(?:orders?|packages?|parcels?) (?:is|are|was|were|has|have|gets?|got) (?:been )?(?:shipped|booked|sent)\b|\bno\b[^.]{0,30}\bbooked\b|\b(?:isn't|aren't|wasn't|weren't|hasn't|haven't) (?:being |getting |been )?(?:shipped|booked)\b|\bstopped? (?:booking|shipping)\b|\bno longer (?:book|ship)\w*/i);

  // The fault is still active at 12:00. A sentence about a plan or a future state does not count.
  const active = affirmed.some(s => OPEN.test(s) && /lag|backlog|queue|consumer|delivery|fault|incident|orders?|messages?|problem|issue|fail|retry|shipments?|offset/i.test(s)
    && !LEAD.test(s) && !NOT_NOW.test(s.replace(NEGATED, ' ')));

  // Next step. A fix that unblocks Delivery: a consumer that reads v2 (or a converter). Rollback alone stops new v2 events,
  // but the stuck message and the v2 backlog stay in the topic: half credit.
  const rollback = clauses.some(c => {
    const h = head(c);
    return !DONT.test(h) && /\broll(?:ing)?[ -]?back\b|\brevert\w*\b|\bredeploy\w*\b|\bback out\b|\bundo\b|\bpin\b|\bv3\.3\.2\b/i.test(h)
      && /\border\b|v3\.4\.0|v3\.3\.2|\bdeploy\w*\b|\bchange\b|\brelease\b|\bit\b|\bthis\b/i.test(h) && !/\bcart\b|v2\.1\.0|\bredis\b/i.test(h);
  });
  const reader = clauses.some(c => {
    const h = head(c);
    return !DONT.test(h) && RECOMMEND.test(h)
      && /\bdelivery\b|\bconsumer\b|\breader\b/i.test(h)
      && (/\b(?:read\w*|pars\w+|handl\w+|support\w*|accept\w*|understand\w*|deserializ\w+|process\w*|compatible)\b[^.]{0,40}(?:\bv2\b|version 2|\bobjects?\b|\bnested|new (?:schema|format)|both|address|order\.paid|(?:bad |stuck |failing )?(?:message|event)s?\b)/i.test(h)
        || /\b(?:delivery|consumer|reader) (?:fix|patch|hotfix)\b|\b(?:fix|patch|hotfix) (?:for |to )?(?:the )?(?:delivery|consumer|reader)\b/i.test(h));
  }) || affirmed.some(s => !DONT.test(head(s)) && /\bconverter\b|\badapter\b|\btranslat\w+ (?:layer|the)\b/i.test(s));

  // Harmful action: skip, ignore, delete, purge or move aside the stuck message, or move the offset. Orders would never ship.
  // A warning in the same sentence ("do not skip") or in the next sentence ("deleting is not an option") is correct.
  const skip = all.some(s => {
    const h = head(s);
    if (FUTURE.test(h)) return false;
    return [...h.matchAll(SKIP)].some(m => {
      const before = h.slice(0, m.index);
      if (/\bwithout\b/i.test(before) || DONT.test(before)) return false;
      if (/\b(?:not|nor|never|nothing|no)\s+(?:(?:be|been|being|get|gets|to)\s+)*$/i.test(before)) return false;
      return !(WARNING.test(s) && !/\botherwise\b|\bor else\b/i.test(s));
    });
  });

  return {
    // The deploy and the failure, linked in one or two sentences, with no false lead as the cause.
    names_order_deploy: cause ? 1 : 0,
    // The deploy and the schema change together.
    deploy_changed_the_schema: cause && schema ? 1 : 0,
    names_delivery_consumer_stuck: stuck ? 1 : 0,
    // Needs a diagnosis with the Order deploy as the cause. An answer with no cause, or with a false lead as the cause, gets 0.
    no_false_lead_as_cause: cause ? 1 : 0,
    gives_start_time: cause && START.test(text) ? 1 : 0,
    says_orders_not_shipping: noShip ? 1 : 0,
    says_fault_still_active: active ? 1 : 0,
    // 1: a Delivery fix that reads v2 (or a converter). 0.5: a rollback alone. Both need the right cause.
    recommends_unblocking_fix: cause ? (reader ? 1 : rollback ? 0.5 : 0) : 0,
    // A harmful action gives 0. An answer without a diagnosis (the Order deploy and its fault) gets 0.
    does_not_skip_messages: cause && !skip ? 1 : 0,
  };
}
