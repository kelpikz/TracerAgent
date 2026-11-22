// Checks on the final answer. The rubric grades the meaning. Each check needs an affirmed claim about this
// incident: a sentence that denies a fact ("the index is a red herring") or an action ("do not cancel")
// does not count, and a claim about another system (a Redis index, a checkout transaction) does not count.
// Sentences end at . ! ? ; or a new line, but not at the dots in a version or a decimal.
const sentences = text => text.split(/[.!?;](?=\s|$)|\n+/).map(s => s.trim()).filter(Boolean);

// A sentence that says a fact is not the cause or not true.
const DENY = /red herring|\bnot (?:the|a) (?:root |real |main )?cause|\bnot related|\bunrelated|\bruled? out|\birrelevant|\binnocent|false lead|\bdistraction|\b(?:is|was|are|were) (?:fine|healthy|ok|okay)\b|\bdid(?: not|n't) (?:cause|matter)|\bnot (?:the )?(?:problem|issue)\b|\bno (?:index )?(?:problem|issue)\b/i;
// Words that tell the reader not to do the action that follows them.
const DONT = /\b(?:do not|don't|never|avoid|should not|shouldn't|must not|no need to)\b/i;
// "X rather than Y" and "X instead of Y": only X is recommended.
const head = s => s.split(/\b(?:rather than|instead of)\b/i)[0];

// The stock index: by name, by columns, or "index" next to "stock".
const STOCK_INDEX = /stock_sku(?:_warehouse)?_idx|\(sku, ?warehouse_id\)|\bstock\b[^.]{0,30}\bindex\b|\bindex\b[^.]{0,30}\bstock\b|index_valid\s*=\s*false/i;
const BROKEN = /\binvalid\b|\bmissing\b|\bdropped\b|\bfailed\b|\bbroken\b|\bunusable\b|\bnot usable\b|\bnever (?:became|got|was) (?:usable|valid|built|created)|\bnot (?:being )?used\b|\bno (?:usable |valid |working )?index\b|\bindisvalid\b|\bhalf[- ]built\b|\bincomplete\b|lock timeout|timed out|index_valid\s*=\s*false|seq(?:uential)?[ _-]?scan|full[ -]table scan/i;
// A sentence that says the index is valid, fixed or repaired.
const FINE = /(?:indisvalid|index_valid)\s*=\s*true|\b(?:fixed|repaired|restored|resolved)\b|\bis (?:now )?valid\b/i;
const SCAN = /\bindex(?:es)?\b|seq(?:uential)?[ _-]?scan|full[ -]table scan/i;
const CATALOG_MIGRATION = /\b0142\b|catalog_migrations|\bcatalog migration\b|\bmigration\b|\bDDL\b/i;
const OTHER_MIGRATION = /\b0087\b|orders migration|orders_migrations|gift_note/i;
const SYNC = /warehouse_stock_sync|stock sync|\bsync\b|\brestock\b|black friday/i;
const SYNC_TX = /warehouse_stock_sync|stock sync|\bsync\b|\brestock\b|\b5089\b|blocking[_ ]pid|pg_pid/i;
const LEAD = /newsletter|traffic spike|\bcart\b|\bredis\b|v2\.1\.0|\bgc\b|garbage collect|stripe|payment provider|\bdlq\b|dead[- ]letter|node-3|scraper|pricegrabber|stats refresh|0087|orders migration|gift_note/i;
const CAUSAL_AFTER = /\b(?:caused|causes|is causing|was responsible|is responsible|explains|is behind|was behind|triggered|broke|is to blame|(?:is|was) the (?:root |real |main )?cause|(?:is|was) the (?:sole |main |real )?culprit)\b/i;
const CAUSAL_BEFORE = /\b(?:caused by|due to|because of|blame|(?:root|real|main) cause (?:is|was)|culprit\W+(?:is|was)?)\b/i;
const OPEN = /\bstill\b|\bongoing\b|not (?:yet )?(?:recovered|resolved|cleared|committed|finished)|(?:had|has|is) yet to (?:commit|finish)|yet to (?:commit|finish)|has(?:n't| not) (?:yet )?(?:committed|finished)|\bremains? (?:open|active|running)\b|\bopen at (?:noon|12:00)\b|\bcontinu\w*\b|\bpersist\w*\b|\bgrow\w*\b|\bworsen\w*\b|getting worse/i;

export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript) ?? '';
  const zero = { names_invalid_index: 0, names_migration_trigger: 0, explains_slow_sync: 0, explains_lock_wait: 0,
    no_false_lead_as_cause: 0, gives_mitigation: 0, gives_index_fix: 0, gives_impact_and_status: 0 };
  if (!text.trim()) return zero;
  const all = sentences(text);
  const affirmed = all.filter(s => !DENY.test(s));
  const any = (re, list = affirmed) => list.some(s => re.test(s));

  // Claims about the lock, the holder and the open transaction need a tool result that shows them.
  const results = helpers.toolCalls(transcript).filter(c => !c.error && c.result != null).map(c => JSON.stringify(c.result));
  const seen = re => results.some(r => re.test(r));
  const sawLock = seen(/Lock:transactionid|"msg":"lock wait"/);
  const sawHolder = seen(/"pg_pid":5089|"blocking_pid":5089/);
  const sawOpen = results.some(r => [...r.matchAll(/"ts":"(2026-11-20T11:(\d\d)[^"]*)","service":"cron","level":"info","msg":"warehouse stock sync progress"/g)]
    .some(m => Number(m[2]) >= 40));

  // A sentence that starts with a pronoun or "the job" continues the sentence before it.
  const joined = all.map((s, k) => k && /^(?:its|it|this|that|these|each|every|so|the job|the migration|the index|the sync|the run)\b/i.test(s) ? `${all[k - 1]} ${s}` : s).filter(s => !DENY.test(s));
  // Cause: the stock index is invalid or unusable.
  const indexCause = affirmed.some(s => STOCK_INDEX.test(s) && BROKEN.test(s) && !FINE.test(s));
  // Trigger: the catalog migration failed or broke the stock index.
  const migration = joined.some(s => CATALOG_MIGRATION.test(s) && !OTHER_MIGRATION.test(s) && !FINE.test(s)
    && (STOCK_INDEX.test(s) || /\b0?6:41\b|\b0142\b/.test(s))
    && /\bfail\w*|\bbroke\b|\bleft\b|\bdropp\w*|\binvalid\b|timed out|lock timeout|\bunusable\b|index_valid/i.test(s));

  // Why the restock runs so long: in one sentence, the sync or stock writes, their slowness, and the reason.
  // Allow two sentences in a row. The reason must be the index, the migration, the time or the per-row cost.
  const pairs = [...affirmed, ...affirmed.slice(1).map((s, k) => `${affirmed[k]} ${s}`)];
  const slowSync = indexCause && pairs.some(s => /sync|restock|stock (?:update|write)s?|update stock|UPDATE stock|row (?:update|write)s?/i.test(s)
    && /\bslow\w*|rows\/s|rows per s|\bminutes?\b|\blonger\b|\b\d+ ?ms\b|milliseconds?\b/i.test(s)
    && (SCAN.test(s) || CATALOG_MIGRATION.test(s) || /\b0?6:41\b|access path|\b\d+ ?ms\b|milliseconds? (?:per|each|a) (?:row|update)/i.test(s)));

  // Mechanism: the sync transaction holds the row locks, and the stock reservation times out (Catalog 503).
  const NOLOCK = /\bwithout (?:any |holding )?(?:row )?locks?\b|\bno (?:row )?locks?\b|\bno time ?outs?\b|\bwithout (?:a |any )?time ?out/i;
  const lockList = affirmed.filter(s => !NOLOCK.test(s));
  const locks = lockList.some(s => /\brow[- ]?locks?\b|\block(?:s|ed)? (?:on )?(?:the |each |every )?(?:stock |updated )?rows?\b|lock[_ ]wait|transactionid|\bhold(?:s|ing)? (?:the |its |their )?locks?\b/i.test(s) && SYNC_TX.test(s))
    && lockList.some(s => /time ?out|timed out|statement[_ ]timeout|\b503\b|deadline|service unavailable/i.test(s) && /reserv|checkout|stock|catalog/i.test(s));

  // A false lead named as the cause. A false lead after "before" or "after" is only a time reference.
  const blamesLead = affirmed.some(s => {
    const clause = s.replace(/\b(?:before|after|until|since|while)\b[^,;]*/gi, '');
    return new RegExp(`(?:${LEAD.source})[^,;]{0,60}?${CAUSAL_AFTER.source}`, 'i').test(clause)
      || new RegExp(`${CAUSAL_BEFORE.source}[^,;]{0,40}?(?:${LEAD.source})`, 'i').test(clause);
  });
  const blamesRestock = affirmed.some(s => SYNC.test(s) && /\b(?:is|was) the (?:root|real|main|underlying) cause\b|\b(?:root|real|main|underlying) cause (?:is|was)\b/i.test(s)
    && !SCAN.test(s) && !CATALOG_MIGRATION.test(s) && !/\bonly\b|\bexpos/i.test(s));
  const clauses = all.flatMap(s => s.split(/,|\band then\b|\bthen\b|\band\b(?= (?:roll|revert|restart|rate|contact|cancel|kill|stop|terminat|abort))/i).map(x => x.trim()).filter(Boolean));
  const wrongAction = clauses.some(s => /\b(?:roll(?:ing)?[ -]?back|revert\w*|restart\w*|rate[- ]limit\w*|contact\w* stripe|open\w* a (?:stripe )?ticket)\b/i.test(head(s))
    && /\bcart\b|v2\.1\.0|\bredis\b|newsletter|\bcatalog (?:pods?|service)\b|stripe/i.test(head(s)) && !DONT.test(head(s)));

  // Mitigation now: stop or roll back the open sync transaction. A named pid must be the holder (5089).
  // "That transaction" counts when the sentence before names the sync or the pid.
  const pids = s => [...s.matchAll(/pg_(?:cancel|terminate)_backend\s*\(\s*(\d+)\s*\)|\bpid\D{0,6}(\d{3,6})|\bbackend\D{0,3}(\d{3,6})/gi)].map(m => m[1] ?? m[2] ?? m[3]);
  const mitigation = all.some((s, k) => clauses.filter(c => s.includes(c)).some(c => {
    const h = head(c);
    const target = SYNC_TX.test(h) || (/\b(?:that|this|its|the open|the running) transaction\b/i.test(h) && SYNC_TX.test(all[k - 1] ?? ''));
    return !DONT.test(h) && target && !/\bcart\b|v2\.1\.0|\bredis\b|checkout transaction/i.test(h)
      && /\b(?:cancel\w*|kill\w*|stop\w*|end|terminat\w*|abort\w*|roll(?:ing|ed)?[ -]?back|pg_(?:cancel|terminate)_backend)\b/i.test(h)
      && !/\b(?:was|were|has been|have been|got) (?:terminated|cancell?ed|killed|stopped|ended|aborted|rolled back)\b/i.test(h)
      && pids(s).every(p => p === '5089');
  }));
  // A cancel stops only the current statement: the answer must also check the rollback or use terminate.
  const cancelOnly = /pg_cancel_backend/i.test(text) && !/pg_terminate_backend|roll(?:ed|s)? back|rollback|pg_stat_activity|idle in transaction|terminat/i.test(text);
  // The plan checks that the locks are gone or that checkout recovers.
  const verifies = all.some(s => /\b(?:check(?!out)|verify|confirm|watch|make sure|ensure)\w*\b/i.test(s) && /lock|checkout|recover|success|pg_locks/i.test(s));
  // Repair: build the stock index again.
  const indexFix = all.some((s, k) => {
    const h = head(s);
    const named = STOCK_INDEX.test(h) || /\b(?:the|that) (?:invalid |replacement |new |broken |failed )?index\b/i.test(h)
      || (/\b(?:it|them)\b/i.test(h) && STOCK_INDEX.test(all[k - 1] ?? ''));
    return !DONT.test(h) && named && !/\bredis\b|\bsearch\b|products_v3|\borders\b|blocking build|without concurrently/i.test(h)
      && /\b(?:re-?creat\w*|re-?build\w*|reindex\w*|create index|drop\w* and (?:re)?creat\w*|re-?run\w* the migration|retry\w* the (?:index|migration)|re-?creat\w* it|re-?build\w* it)\b/i.test(h);
  });

  // Impact: a measured rate or count for checkouts in the outage window, the no-charge boundary, and the status.
  // About 35% of attempts fail on the stock reservation from 11:15 to 12:00 (467 of 1,334), about 62% in the
  // last 10 minutes. Checkout success over the window is about 62%.
  const inWindow = s => {
    const times = [...s.matchAll(/\b(\d{1,2}):(\d{2})\b/g)].map(m => Number(m[1]) * 60 + Number(m[2]));
    if (times.length) return times.every(t => t >= 11 * 60 && t <= 12 * 60);
    return /last \d+ ?min|last hour|past hour|since the restock|during the restock|\bwindow\b/i.test(s);
  };
  const ratios = s => {
    const words = { 'one in three': 1 / 3, 'a third': 1 / 3, 'one third': 1 / 3, 'two in three': 2 / 3, 'two thirds': 2 / 3, 'two-thirds': 2 / 3, 'half': 0.5, 'one in two': 0.5, 'three in five': 0.6 };
    const out = Object.entries(words).filter(([w]) => s.toLowerCase().includes(w)).map(([, v]) => v);
    for (const m of s.matchAll(/(?<![\d.,])(\d{1,3}(?:\.\d+)?)\s?%/g)) if (![82.8, 90].includes(Number(m[1]))) out.push(Number(m[1]) / 100);
    for (const m of s.matchAll(/(?<![\d.,])(\d{2,3}(?:,\d{3})?)\s+(?:of|out of|\/)\s+(\d{2,3}(?:,\d{3})?|1,?\d{3})/g)) {
      out.push(Number(m[1].replace(',', '')) / Number(m[2].replace(',', '')));
    }
    return out;
  };
  const counts = s => [...s.matchAll(/(?<![\d.,:])(\d{3}|1,\d{3})(?![\d,:])(?!\s?ms)/g)].map(m => Number(m[1].replace(',', '')));
  const sized = affirmed.some(s => /checkout|attempt|reservation|order/i.test(s) && inWindow(s) && (() => {
    const r = ratios(s);
    if (/success/i.test(s) && !/fail|unsuccess/i.test(s)) {
      return /last \d+ ?min/i.test(s) ? r.some(x => x >= 0.25 && x <= 0.5) : r.some(x => x >= 0.55 && x <= 0.7);
    }
    return r.some(x => x >= 0.25 && x <= 0.85) || counts(s).some(n => n >= 390 && n <= 560);
  })());
  const noCharge = any(/never reach(?:es|ed)? payment|(?:fail\w*|stop\w*|abort\w*|end\w*)[^.]{0,40}before (?:the )?payment|not charged|nobody (?:is|was) charged|no (?:one|customer) (?:is|was) charged|no payment (?:intent|request|attempt|is made|was made)|zero payment intents?|never charged|stop(?:s|ped)? before payment/i);
  const ongoing = affirmed.some(s => OPEN.test(s) && !/improv|recover(?:s|ed|ing)\b(?! yet)|back to normal/i.test(s) && /sync|restock|transaction|checkout|fail|lock|5089|backend|reservation|\bjob\b|running/i.test(s)
    && !LEAD.test(s) && !/\bhealthy\b|\brecovered\b(?! yet)/i.test(s));

  return {
    names_invalid_index: indexCause ? 1 : 0,
    names_migration_trigger: migration ? 1 : 0,
    explains_slow_sync: slowSync ? 1 : 0,
    explains_lock_wait: locks && sawLock && sawHolder ? 1 : 0,
    // Needs a real diagnosis: an answer with no cause, or with the restock as the root cause, gets 0.
    no_false_lead_as_cause: (indexCause || migration) && !blamesLead && !blamesRestock && !wrongAction ? 1 : 0,
    gives_mitigation: mitigation && sawHolder && !cancelOnly && verifies ? 1 : 0,
    gives_index_fix: indexFix ? 1 : 0,
    gives_impact_and_status: sized && noCharge && ongoing && sawOpen ? 1 : 0,
  };
}
