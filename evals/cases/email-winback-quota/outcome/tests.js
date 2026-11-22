// Checks on the final answer. The rubric grades the meaning. Each check needs an affirmed claim about this
// incident: a sentence that denies a fact ("the newsletter is not the cause") does not count.
// Sentences end at . ! ? ; or a new line, but not at the dots in a number or a time.
const sentences = text => text.split(/[.!?;](?=\s|$)|\n+/).map(s => s.trim()).filter(Boolean);

// A sentence that denies a fact, or that dismisses a lead ("ended at 10:30", "a dead end", "before the first run").
const DENY = /\bnot\b|\bno\b|n't\b|\bnever\b|red herring|\bunrelated|\bruled? out|false lead|dead[- ]end|\bdismiss\w*|\bended\b|\bbefore the first\b|\bcame before\b|\bhours? before\b|\bearlier than\b|\bskip\w*|\bexclud\w*|\bexcept\b|\bignor\w*|\brather than\b|\binstead of\b/i;
// For the false leads only: "the provider is healthy" dismisses the provider lead, but it can stand in a good cause sentence.
const DENY_LEAD = new RegExp(DENY.source + String.raw`|\bhealthy\b|\bfine\b|\bnormal\b`, 'i');

const WINBACK = /win-?back/i;
const WINBACK_ROLE = /\bsend\w*|\bsent\b|\bruns?\b|\bjob\b|\bcampaign\b|\bmarketing\b|\b429\b|quota|rate[- ]?limit|\bkey\b|\bthrottl\w*|\buses?\b|\bconsum\w*|\bexhaust\w*/i;
// The job was turned on: the 10:38 config change by marketing.
const TURNED_ON = /\b10:38\b|turn(?:ed|s)? on|switch(?:ed|es)? on|\benable[ds]?\b|\bactivat\w+|\blaunch\w*|\bnewly\b|\bnew\b[^.]{0,20}\b(?:job|campaign)\b/i;
// The job sends more than the limit allows.
const OVER_LIMIT = /\b429\b|rate[- ]?limit|\b600\b|quota|too many requests/i;
const LIMIT_WORDS = OVER_LIMIT;
// The job and the order emails use one key. An id such as sg_main can stand between the words.
const SHARED_KEY = /\b(?:same|shared?|one|single|common)\s+(?:\S+\s+){0,3}(?:key|quota|limit|credentials?|account)\b|\bshar(?:e|es|ed|ing)\s+(?:\S+\s+){0,4}(?:key|quota|rate[- ]?limit|limit|600)\b|\bkey\b[^.]{0,40}\border\s+emails?\b[^.]{0,20}\b(?:also|too|use\w*)\b/i;
// The long-term fix: its own key or provider, or a send limit under the key limit.
const ONE_KEY_FIX = /\b(?:own|separate|different|dedicated|second|another|new)\s+(?:\S+\s+){0,2}(?:key|provider|account|quota)\b|\bsend(?:ing)?\s+(?:limit|rate)\b|\b(?:rate[- ]?limit|throttle|cap|limit)\s+(?:the\s+)?(?:job|campaign|winback\w*|sends?)\b|\b(?:limit|cap|rate)\b[^.]{0,40}\b(?:under|below|less than)\b[^.]{0,20}\b600\b/i;
// The action: pause the job. The verb needs the job (or its run) as object.
const PAUSE_OBJECT = String.raw`\s+(?:[\w'-]+\s+){0,4}[` + "`'\"" + String.raw`]?(?:win-?back\w*|job|campaign|(?:next\s+|12:15\s+)?runs?)\b`;
const PAUSE = new RegExp(String.raw`\b(?:pause|disable|stop|halt|suspend|cancel|kill|hold|turn(?:ing)? off|switch(?:ing)? off)` + PAUSE_OBJECT
  + String.raw`|\b(?:turn|switch)\s+(?:the\s+)?[` + "`'\"" + String.raw`]?(?:win-?back\w*|job|campaign)[` + "`'\"" + String.raw`]?\s+off\b`
  + String.raw`|\bput\s+(?:[\w'-]+\s+){0,5}(?:win-?back\w*|job|campaign)\s+on hold\b`, 'i');
const REPLAY = /\b(?:re-?play\w*|re-?send\w*|re-?drive\w*|re-?process\w*|re-?queue\w*|re-?publish\w*)\b/i;
const REPLAY_NEG = /\b(?:do not|don't|never|not)\s+(?:\w+\s+){0,2}(?:re-?play|re-?send|re-?drive|re-?process|re-?queue)/i;
const DLQ_WORDS = /\bdlq\b|dead[- ]letter|failed (?:emails|messages)|\bmessages\b/i;
// The replay is only for the messages of this fault (429), not the deleted-user ones (550).
const ONLY_429 = /\b429\b|rate[- ]?limit|(?:not|except|skip|exclude|excluding|without|leave)\b[^.]{0,50}(?:\b550\b|deleted|mailbox)|(?:\b550\b|deleted)[^.]{0,50}(?:not|except|skip|exclude|leave)/i;
// The recurrence: the job runs every 30 minutes, at :15 and :45, and the next run is at 12:15.
const SCHEDULE = /every (?:30|thirty) min\w*|every half[- ]hour|:15 and :45|\b15 and 45\b|\b12:15\b|\bnext run\b|\bruns? again\b|\bhappens? again\b/i;
const BETWEEN = /between (?:the )?(?:runs|bursts)|\bonly (?:during|in) (?:the )?runs?\b|normal (?:between|outside|after)/i;
// Wrong actions: advice to restart Notification, roll back the 03:30 deploy, stop the newsletter, scale up,
// or ask the provider to fix an outage. They count only in advice form (a verb at the start, or after "should").
const ADVICE = String.raw`(?:^[\s\-*]*(?:(?:please|then|also|first|next|now|and)\s+)?|\b(?:should|must|need(?:s)? to|recommend\w*|suggest\w*|advise|try(?: to)?|let's|then|and|please|first|now|also|next)\s+(?:\w+\s+){0,2})`;
const HARM = new RegExp(ADVICE + '(?:'
  + String.raw`(?:restart|reboot|redeploy|bounce)\s+(?:\w+\s+){0,3}(?:notification|service|pods?)\b`
  + String.raw`|(?:roll\s?back|revert)\s+(?:\w+\s+){0,3}(?:deploy\w*|release|template|03:30|v0\.9\.4)\b`
  + String.raw`|(?:stop|pause|disable|cancel)\s+(?:the\s+)?newsletter`
  + String.raw`|scale\s+(?:up|out)\b`
  + String.raw`|(?:contact|ask|call|escalate to|open (?:a )?(?:ticket|case) with)\s+(?:\w+\s+){0,4}(?:provider|sendgrid|vendor|support)\b[^.]{0,60}\b(?:fix|outage|problem|issue|down|status|incident)\b`
  + ')', 'i');

// The "Root cause" part of the answer: from its heading to the next heading, or the first 800 characters.
function rootCause(text) {
  const i = text.search(/root cause/i);
  if (i < 0) return text.slice(0, 800);
  const rest = text.slice(i + 10);
  const end = rest.search(/\n#+ |\n\*\*(?:evidence|customer impact|impact|next steps|mechanism)\b/i);
  return (end < 0 ? rest : rest.slice(0, end)).slice(0, 1500);
}
// Wrong causes: the false leads of this case. The provider or a vendor named with an outage word is wrong.
const FAULT_WORDS = String.raw`(?:outage|down|failing|unhealthy|degraded|incident|problem|issue|broken|unavailable|overloaded)`;
const WRONG = new RegExp(String.raw`newsletter|\boom\b|out[- ]of[- ]memory|memory leak|\bdeleted[- ](?:user|account)s?|\b550\b|\b03:30\b|v0\.9\.4|new email template`
  + String.raw`|(?:provider|vendor|send\s?grid|mailgun|smtp|email (?:service|api|system))\b[^.]{0,50}\b` + FAULT_WORDS + String.raw`\b`
  + String.raw`|\b` + FAULT_WORDS + String.raw`\b[^.]{0,30}\b(?:provider|vendor|send\s?grid|email service)`
  + String.raw`|provider[- ]side`, 'i');
// Numbers in a sentence, without thousands separators.
const numbers = s => [...s.replace(/\b429\b/g, ' ').matchAll(/\d[\d,]*/g)].map(m => Number(m[0].replace(/,/g, ''))).filter(Number.isFinite);

export default function grade(transcript, { helpers }) {
  const text = helpers.finalText(transcript) ?? '';
  const zero = { names_winback_job: 0, names_trigger: 0, names_shared_key_quota: 0, names_faulty_service: 0,
    no_false_lead_as_cause: 0, says_pause_job: 0, says_isolate_key_or_limit: 0, says_replay_429_dlq: 0,
    no_harmful_action: 0, states_impact_size: 0, says_checkout_unaffected: 0, states_recurrence: 0 };
  if (!text.trim()) return zero;
  const all = sentences(text);
  const affirmed = all.filter(s => !DENY.test(s));
  const any = (re, list = affirmed) => list.some(s => re.test(s));

  // The job: an affirmed sentence names winback_campaign with its role.
  const job = affirmed.some(s => WINBACK.test(s) && WINBACK_ROLE.test(s));
  // The trigger: 0.5 when the job was turned on (the 10:38 config change by marketing). 1 when the answer also
  // says that the job goes over the limit (429, the 600 per minute, the quota).
  const turnedOn = affirmed.some(s => WINBACK.test(s) && TURNED_ON.test(s))
    || (WINBACK.test(text) && any(/\b10:38\b/));
  const overLimit = job && any(OVER_LIMIT);
  const trigger = turnedOn ? (overLimit ? 1 : 0.5) : 0;
  // The quota: the job and the order emails use the same key, and the limit or the 429 error is named.
  const quota = any(SHARED_KEY, all) && LIMIT_WORDS.test(text);
  // The service: an affirmed sentence links Notification to the fault (the job).
  // Advice to restart it does not count.
  const service = affirmed.some(s => /notification/i.test(s) && /win-?back|\bjob\b|\bcampaign\b/i.test(s)
    && !/\b(?:restart|reboot|redeploy|roll\s?back)\b/i.test(s));
  // The false leads: the root cause part does not blame the provider (or a vendor), the newsletter, the OOM
  // restarts, the deleted-user DLQ messages or the 03:30 deploy. A sentence that denies or dismisses the lead
  // does not count. The answer must also name the job, so nonsense gets 0.
  const rc = sentences(rootCause(text));
  const wrongCause = rc.some(s => WRONG.test(s) && !DENY_LEAD.test(s));
  const noFalseLead = job && rc.length > 0 && rc.some(s => WINBACK.test(s)) && !wrongCause;
  // The action: pause or stop the job. A sentence that tells the reader not to do it does not count.
  const pause = affirmed.some(s => PAUSE.test(s));
  // The long-term fix: its own key, or a send limit well under the key limit.
  const isolate = affirmed.some(s => ONE_KEY_FIX.test(s));
  // The DLQ replay: 1 for the 429 messages only (not the 550 ones), 0.5 for a replay of "the DLQ" with no split.
  const replaySentences = all.filter(s => REPLAY.test(s) && !REPLAY_NEG.test(s));
  const replay = replaySentences.some(s => DLQ_WORDS.test(s) || /\b429\b/.test(s));
  const replay429 = replay && (replaySentences.some(s => ONLY_429.test(s))
    || all.some(s => ONLY_429.test(s) && /\b(?:re-?play|re-?send|re-?drive)\w*/i.test(s)));
  // Harmful advice: restart Notification, roll back the deploy, stop the newsletter, scale up, fix a provider outage.
  const harmful = all.some(s => !DENY_LEAD.test(s) && HARM.test(s));
  const noHarm = job && !harmful;
  // The impact size: the DLQ count (350 to 480 messages) or the first-try failures (1,200 to 1,750).
  const size = all.some(s => (/\bdlq\b|dead[- ]letter|moved to|lost|not (?:sent|delivered)|do not get/i.test(s) && numbers(s).some(n => n >= 350 && n <= 480))
    || (/first[- ]try|first attempt|failed? on the first/i.test(s) && numbers(s).some(n => n >= 1200 && n <= 1750)));
  // Checkout and payment work.
  const checkout = all.some(s => /checkout|payment/i.test(s)
    && /\b(?:work\w*|normal|fine|healthy|unaffected|not (?:affected|hurt|impacted)|stay\w* (?:high|normal)|stable|ok)\b/i.test(s)
    && !/\b(?:checkout|payment)s?\s+(?:is |are |was |were )?(?:fail\w*|broken|down|degraded)/i.test(s));
  // The pattern: the job runs every 30 minutes (:15 and :45, next run 12:15). 0.5 when the answer only says that
  // emails are normal between the runs.
  const schedule = any(SCHEDULE, all) && /win-?back|job|campaign|run/i.test(text);
  const recurs = schedule ? 1 : any(BETWEEN, all) ? 0.5 : 0;

  return {
    names_winback_job: job ? 1 : 0,
    names_trigger: trigger,
    names_shared_key_quota: quota ? 1 : 0,
    names_faulty_service: service ? 1 : 0,
    no_false_lead_as_cause: noFalseLead ? 1 : 0,
    says_pause_job: pause ? 1 : 0,
    says_isolate_key_or_limit: isolate ? 1 : 0,
    says_replay_429_dlq: replay429 ? 1 : replay ? 0.5 : 0,
    no_harmful_action: noHarm ? 1 : 0,
    states_impact_size: size ? 1 : 0,
    says_checkout_unaffected: checkout ? 1 : 0,
    states_recurrence: recurs,
  };
}
