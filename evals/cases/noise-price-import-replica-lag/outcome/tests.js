export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript);
  const has = (...patterns) => helpers.mentions(text, ...patterns);
  const priceImport = has(/price[-_ ]import|import(?:ed|ing)? (?:the )?(?:supplier )?prices/);
  const scheduled = has(/\b(?:scheduled|nightly|cron)\b/);
  const recovers = has(/\b(?:recovers?|recovered|catches up|caught up|returned to normal|back to normal|resolved)\b/);
  const expected = has(/\b(?:expected|normal|temporary|transient)\b/);
  const safeCheckout = has(/\bno (?:customer|checkout|payment) impact\b|\b(?:checkout|payments?) (?:was|were|remained|stayed) (?:unaffected|normal|healthy)\b|\b(?:paid|charged|charges) (?:the )?correct prices?\b/)
    && !has(/\b(?:did not|didn't) (?:pay|charge) (?:the )?correct prices?\b/);
  const oldPrices = has(/\b(?:old|stale|outdated) prices?\b/);
  const noAction = has(/\bno (?:immediate |urgent )?(?:action|intervention|mitigation)(?: is)? (?:needed|required|necessary)\b|\bno (?:immediate |urgent )?action\./);
  const recommendsAction = text.split(/[\n.!?]+/).some(clause =>
    /\b(?:roll[ -]?back|restart|escalat\w*|page (?:the|on-call))\b/i.test(clause)
      && !/\b(?:no|not|never|without|unnecessary|avoid|unless|only if)\b|n't\b/i.test(clause));
  return {
    names_scheduled_price_import: priceImport && scheduled ? 1 : priceImport ? 0.5 : 0,
    explains_recovery: recovers && expected ? 1 : recovers || expected ? 0.5 : 0,
    describes_customer_impact: safeCheckout && oldPrices ? 1 : safeCheckout ? 0.5 : 0,
    recommends_no_immediate_action: noAction && !recommendsAction,
  };
}
