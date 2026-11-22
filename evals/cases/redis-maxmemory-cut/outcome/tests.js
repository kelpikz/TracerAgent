// Fault: at 08:20 the cart Redis moves to a smaller instance (maxmemory 640 MB, noeviction). At 11:10 memory
// reaches the limit and Redis rejects writes, so POST /cart/items returns 500. The fault is still active at 12:00.
// The cart v2.1.0 deploy (09:40) is a dead end. The fix is to raise maxmemory back (2048 MB, or the larger
// instance cart-redis-2g), not a rollback and not a flush.
// The trigger (the move to the smaller instance) is the point of the case. An answer that says only "Redis is
// full at 640 MB, raise the limit" must stay under half of the points. So:
//  - names_memory_limit needs the trigger together with the 640 MB limit.
//  - The items that check "no wrong claim" and "still active" give credit only when the answer names the trigger.
// Text checks use synonyms. The judge rubric grades the mechanism and the impact.
const NEGATION = /\b(not|no|never|isn'?t|wasn'?t|aren'?t|weren'?t|doesn'?t|don'?t|didn'?t|won'?t|wouldn'?t|can'?t|cannot|couldn'?t|do not|will not|would not|without|unrelated|unnecessary|no need|avoid|skip|ruled out|rule out|rejected|innocent|instead of|rather than|useless|pointless|unlikely)\b/i;
// A dismissal of a lead. "no doubt" is not a dismissal.
const DISMISS = new RegExp(`${NEGATION.source}|coincidence|coincidental|red herring|false lead|dead end|decoy|distraction|irrelevant|not related|did not cause|didn'?t cause`, 'i');
// Words that show a lead is cleared ("the v2.1.0 client library works"). Used only for the noise item.
const CLEARED = /\b(works?|worked|working|fine|ok|okay|healthy|clean|checked|innocent|normal|stayed|stays|low)\b/i;
const NOISE = /v2\.1\.0|client librar|redis client|client upgrade|newsletter|black friday preview|\bkeys\b (job|command)|abandoned[- ]cart job|scraper|price.?grabber|\bgc\b|garbage collect/i;
const CAUSE = /root cause|caused|causes|cause is|the cause|due to|because|triggered|result of|culprit|to blame|responsible|\bbroke\b|\bbreaks\b/i;

const clean = text => text.replace(/[`*_]/g, '').replace(/\bno doubt\b|\bwithout (a )?doubt\b/gi, 'surely');
// Clauses: split at sentence ends, semicolons, colons, line breaks, and "but".
const clauses = text => clean(text).split(/[.!?;:](?=\s|$)|\n+|\s+but\s+/i)
  .map(s => s.replace(/^[\s\-•#>\d)(]+/, '').trim()).filter(Boolean);

// The text of the "Root cause" section, or '' when the answer has no such heading.
function rootCauseSection(text) {
  const m = /^#+\s*root cause\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(text);
  return m ? m[1] : '';
}

// The trigger: the move of the cart Redis to a smaller instance, or the cut of its memory limit.
// Only a description of the change counts. An action ("Revert the Redis resize") does not. The patterns run on one
// sentence at a time, and a sentence with a dismissal ("not the problem") is skipped.
const CHANGE_VERB = String.raw`(resized|downsized|downscaled|scaled down|moved|migrated|switched|swapped|replaced|shrunk|shrank|reduced|cut|lowered)(?!\s+back)`;
const TRIGGER = [
  /\b(smaller|cheaper|downsized|shrunk|shrank)\b[^.\n]{0,40}\b(instance|redis|cache|node|plan|tier)\b/i,
  new RegExp(String.raw`\b${CHANGE_VERB}\b[^.\n]{0,60}\b(redis|cache|instance|node)\b`, 'i'),
  new RegExp(String.raw`\b(redis|cache|instance|node)\b[^.\n]{0,40}\b(was|were|got|been|is)\s+${CHANGE_VERB}\b`, 'i'),
  /\b(moved|migrated|switched|changed)\b[^.\n]{0,60}(\b1g\b|\b1 ?gb|cart-redis-1g|\bcost)/i,
  /\bfrom\s+(2048(\s?mb)?|2\s?gb|2g)\s+to\s+(640|1\s?gb|1g)\b/i,
  /\b(changed|went|dropped|reduced|cut|lowered|decreased)\b[^.\n]{0,40}\bto\s+(640|1\s?gb|1g)\b/i,
  /\b1\s?gb\s+(node|instance|redis|plan)\b/i,
  /cart-redis-2g[^.\n]{0,30}(\bto\b|->|\bwith\b|\bby\b)[^.\n]{0,15}cart-redis-1g/i,
  /FIN-212|cost[- ]?(cut|sav\w*|reduction)/i,
  /\b(cut|lower\w*|reduc\w*|shrunk|shrank|decreas\w*)\b[^.\n]{0,40}\b(maxmemory|memory limit|redis memory)\b/i,
  /\b(maxmemory|memory limit)\b[^.\n]{0,40}\b(cut|lowered|reduced|decreased|shrunk|shrank)\b/i,
];
const TRIGGER_DISMISSED = /\b(not|isn'?t|wasn'?t|never|unrelated|irrelevant|red herring|dead end|coincidence|ruled out|rule out)\b/i;
const sentences = text => clean(text).split(/[.!?;](?=\s|$)|\n+/).map(x => x.trim()).filter(Boolean);

const LIMIT_640 = /\b640\s?(mb|mib|megabytes)\b|maxmemory[^.\n]{0,30}\b640\b|\b640\b[^.\n]{0,30}(maxmemory|limit|noeviction)|maxmemory_mb\W+640\b/i;

// The next step: an action (an imperative, or a "should/must" sentence) that raises maxmemory or moves back to
// the larger instance. A sentence that only describes the setting ("maxmemory is set to 640 MB") gets no credit.
const IMPERATIVE = /^(?:(?:first|now|then|next|also|immediately|urgently|please|and|later|today|quickly|just)\s+)*(?:rais|increas|restor|revert|bump|grow|enlarg|expand|upsiz|resiz|scal|mov|switch|roll|put|give|bring|set)\w*/i;
const MODAL = /\b(should|must|need(s)? to|have to|ought to|recommend\w*|we can|let'?s|the fix|to fix|fix is|action|next step)\b/i;
// The action must raise the limit or undo the resize. "change" and "look at" do not count.
const ACTION = /\b(rais\w*|increas\w*|restor\w*|revert\w*|bump\w*|grow\w*|enlarg\w*|expand\w*|upsiz\w*|scal\w* up|roll\w* back|go back|(mov|switch|put|set|bring|give)\w*[^.\n]{0,40}\b(back|higher|larger|bigger)\b|set\b[^.\n]{0,40}\bto (2048|2 ?gb|2g)\b)/i;
const TARGET = /maxmemory|max memory|memory (limit|size|cap\w*)|redis memory|resiz\w*|downsiz\w*|\bnode\b|\b2048\b|\b2 ?gb?\b|\b2g\b|cart-redis-2g|larger|bigger|original|previous size|old (redis )?(instance|size|limit)|instance size|capacity/i;
const DESCRIBES = /\b(is|are|was|were|been|got)\s+set\b|\b(was|were|had been|has been|have been)\s+(\w+\s+)?(rais|increas|restor|revert|chang|mov|resiz)ed\b/i;
// A negation just before the action ("do not raise", "no need to move").
const NEGATED_ACTION = /\b(not|never|don'?t|no need to|instead of|rather than|avoid)\s+(\w+\s+){0,2}?(rais|increas|restor|revert|bump|grow|enlarg|expand|upsiz|resiz|scal|mov|switch|chang|set|roll|go)\w*/i;

// Harmful actions. A sentence with a negation ("do not flush Redis") is skipped.
const HARMFUL = [
  /\bflush(all|db)?\b[^.\n]{0,40}\bredis\b|\bredis\b[^.\n]{0,40}\bflush|\bflushall\b|\bflushdb\b/i,
  /\brestart\w*[^.\n]{0,40}\bcart\b[^.\n]{0,15}(pods?|service|deployment|containers?)|\brestart\w*[^.\n]{0,15}\b(pods?|cart)\b/i,
  /\b(add|scale|more)\w*[^.\n]{0,25}\bcart pods\b|\bscal\w* (up )?(the )?cart\b/i,
];

// A rollback of the cart deploy as the fix.
const ROLLBACK = /(roll(?:ing)?[- ]?back|revert|downgrade|undo)[^.\n]{0,25}(v2\.\d+\.\d+|deploy|release|upgrade|cart (to|service|version)|(cart|redis) client|previous (cart )?version)/i;

// The text says that the problem is over. Sentences with a condition or a check ("check that the errors
// have stopped", "until it recovers") and negated sentences are skipped.
const CONDITION = /\b(check|verify|confirm|until|once|when|after|if|should|will|then|so that|goes?|going|expect\w*|make sure|to confirm|ensure|watch|wait\w*|before|whether)\b/i;
const RECOVERED = /\b(errors?|failures?|fault|problem|incident|issue|outage|alert|writes?|cart|redis)\b[^.\n]{0,30}\b(has|have|had|is|are|was|were)\s+(now\s+|already\s+|fully\s+)?(recovered|cleared|resolved|fixed|over|stopped|back to normal)\b|\b(resolved itself|self-heal\w*|back to normal)\b|\bno longer (failing|happening|firing)\b/i;
const STILL = /\bstill (active|failing|happening|firing|rejecting|ongoing|running|broken|down|rising|at (the )?limit|full|fail\w*|reject\w*|not (fixed|resolved|recovered))\b|\b(fault|problem|incident|issue|outage|errors?|failures?)\b[^.\n]{0,25}\bongoing\b|\bongoing (fault|problem|incident|issue|outage|errors?|failures?)\b|\b(errors?|failures?|fault|problem|incident|issue|writes?)\b[^.\n]{0,40}\b(continu\w*|persist\w*|remain\w*)\b|\b(has|have|is|are) not (yet )?(recovered|cleared|stopped|resolved|fixed)\b|\bnot (yet )?(recovered|cleared|resolved|fixed)\b|\b(as of|at|until) (now|12:00)\b|\bto now\b/i;

export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript) ?? '';
  const names = ['names_trigger', 'names_memory_limit', 'names_faulty_service', 'no_noise_as_cause',
    'no_deploy_rollback', 'no_harmful_action', 'next_step_raises_limit', 'states_still_active'];
  if (!text.trim()) return Object.fromEntries(names.map(n => [n, 0]));
  const cl = clauses(text);
  const flat = clean(text);

  const bit = ok => (ok ? 1 : 0);

  // A wrong cause: a noise item in the root cause section, or next to a cause word, without a dismissal.
  const cleared = s => DISMISS.test(s) || CLEARED.test(s);
  const wrongCause = clauses(rootCauseSection(text)).some(s => NOISE.test(s) && !cleared(s))
    || cl.some(s => CAUSE.test(s) && NOISE.test(s) && !cleared(s));
  // The trigger: a sentence that describes the change and does not dismiss it. An answer that blames a noise item
  // gets no trigger credit.
  const trigger = !wrongCause
    && sentences(text).some(s => TRIGGER.some(p => p.test(s)) && !TRIGGER_DISMISSED.test(s));
  const gate = ok => bit(trigger && ok);
  const rollback = cl.some(s => ROLLBACK.test(s) && !DISMISS.test(s));
  const harmful = cl.some(s => HARMFUL.some(p => p.test(s)) && !DISMISS.test(s));

  const raises = cl.some(s => ACTION.test(s) && TARGET.test(s)
    && (IMPERATIVE.test(s) || MODAL.test(s))
    && !DESCRIBES.test(s) && !NEGATED_ACTION.test(s) && !ROLLBACK.test(s));

  const recovered = cl.some(s => RECOVERED.test(s) && !CONDITION.test(s) && !NEGATION.test(s));
  const still = cl.some(s => STILL.test(s)) && !recovered;

  return {
    names_trigger: bit(trigger),
    // The 640 MB limit counts only together with the trigger. "Memory is flat at 640 MB" alone is not enough.
    names_memory_limit: bit(trigger && LIMIT_640.test(flat)),
    // The faulty part is the cart Redis memory limit.
    names_faulty_service: bit(!wrongCause && /\bredis\b/i.test(flat) && /\bcart\b/i.test(flat)
      && /\boom\b|\b640\b|maxmemory|noeviction|memory limit/i.test(flat)),
    no_noise_as_cause: gate(!wrongCause),
    no_deploy_rollback: gate(!rollback),
    no_harmful_action: gate(!harmful),
    next_step_raises_limit: bit(raises),
    // The fault is still active at 12:00. The answer must not say that the problem has cleared.
    states_still_active: gate(still),
  };
}
