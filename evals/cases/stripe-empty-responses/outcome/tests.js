// Checks on the final answer. The rubric grades the meaning.
// Sentences end at . ! ? ; or a new line, but not at the dots in a version such as v4.11.3.
const sentences = text => text.split(/[.!?;](?=\s|$)|\n+/).map(s => s.trim()).filter(Boolean);
const negated = s => /\b(?:not|never|no need|avoid|unnecessary|pointless|rather than|instead of|ruled? out|unrelated)\b|n't\b|\bno\b(?! delay)/i.test(s);
// "Stripe is healthy" clears Stripe. "The Stripe error rate is fine (0%)" is a correct fact, not a verdict.
const clearsStripe = s => /\bstripe\b/i.test(s)
  && (/\b(?:healthy|not the (?:root )?cause|not involved|not failing|ruled? out)\b/i.test(s)
    || (/\b(?:is|looks|was) (?:fine|normal)\b/i.test(s) && !/error rate/i.test(s)));

export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript) ?? '';
  const zero = { names_stripe_as_cause: 0, names_empty_response: 0, names_parse_failure: 0,
    rejects_order_deploy: 0, gives_impact_size: 0, states_ongoing: 0 };
  if (!text.trim()) return zero;
  const all = sentences(text);
  const any = re => all.some(s => re.test(s));

  const emptyBody = /\bempty\b|\bblank\b|no (?:response )?body|no content|zero[- ]length|zero[- ]byte|\b0[- ]byte|body_bytes\s*=?\s*0|content[_ -]length\s*=?\s*0/i;
  const stripeCause = all.some(s => /\bstripe\b/i.test(s) && !clearsStripe(s) && !negated(s)
    && /\b(?:slow|latency|degraded|empty|cause|outage|incident|failing|broken|p95)\b/i.test(s));
  const namesStripe = stripeCause && !all.some(clearsStripe);

  const deploy = /\b(?:deploy\w*|v4\.12\.0|release)\b/i;
  const rollsBackOrder = all.some(s => ((/\b(?:roll(?:ing)?[ -]?back|revert)\b/i.test(s) && /\b(?:order|v4\.1[12]|deploy)/i.test(s))
    || /\bre-?deploy\w* (?:order )?v4\.11/i.test(s)) && !negated(s));
  const blamesDeploy = all.some(s => deploy.test(s)
    && /\b(?:caused|causes|broke|breaks|triggered|is the (?:root )?cause|due to)\b/i.test(s) && !negated(s));

  // The fault makes about 58% of checkouts fail (success about 39%, 1,182 attempts, about 725 not successful).
  // Only numbers in a sentence about checkouts count. Skip parts of bigger numbers such as 9,791 ms, and the alert rule.
  const sized = all.some(s => /checkout/i.test(s) && !/<\s*90%/.test(s)
    && [...s.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d+)?)\s?%/g)].some(m => Number(m[1]) >= 30 && Number(m[1]) <= 70));
  const counted = all.some(s => /checkout|attempt/i.test(s) && /(?<![\d.,])(?:6\d{2}|7\d{2}|1,?1\d{2})(?![\d,])(?!\s?ms)/.test(s));

  return {
    names_stripe_as_cause: namesStripe ? 1 : 0,
    names_empty_response: namesStripe && any(emptyBody) ? 1 : 0,
    names_parse_failure: namesStripe && any(/\bpars(?:e|ing)\b|deseriali[sz]|decod(?:e|ing)|unexpected end of json|invalid json/i) ? 1 : 0,
    rejects_order_deploy: !rollsBackOrder && !blamesDeploy && any(deploy) ? 1 : 0,
    gives_impact_size: sized || counted ? 1 : 0,
    states_ongoing: namesStripe && any(/\bstill\b|\bongoing\b|not (?:yet )?(?:recovered|resolved|cleared)|has(?:n't| not) (?:recovered|cleared|resolved)|\bcontinues\b|\bpersists\b|\bactive\b/i) ? 1 : 0,
  };
}
