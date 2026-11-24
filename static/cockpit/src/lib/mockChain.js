// The mock's "model" for Lotse chains (lotse.llm modes 'plan' and 'write'): deterministic, so the demo and the browser
// checks always see the same thing. It reads only what the server would send – the masked request and the tool
// catalogue for a plan, the verified story for a text – and answers in the same shape a real model must (strict JSON /
// plain prose). ?ai=differs makes the planner propose a different step, ?lotse=differs makes the writer misquote a number.
import { splitClauses } from '@shared/lotse/act/chain/split.js';

const flag = (name, value) => typeof location !== 'undefined' && new URLSearchParams(location.search).getAll(name).includes(value);
const RULES = [
  [/sla/, () => ({ tool: 'query.ticketsSla', params: {} })],
  [/support/, () => ({ tool: 'query.teamsSupport', params: {} })],
  [/buchungsziel|booking target|zu wenig gebucht|too little/, () => ({ tool: 'query.belowBooking', params: {} })],
  [/nicht besetzbar|not staffable|unstaffable/, (q) => ({ tool: 'query.notStaffable', params: /q4/.test(q) ? { quarter: 'Q4' } : {} })],
  [/über 100|ueber 100|over 100|überlast|overload/, (q) => ({ tool: 'query.overloaded', params: /(\d+) (wochen|weeks)/.test(q) ? { next: +/(\d+) (wochen|weeks)/.exec(q)[1] } : {} })],
  [/blockiert|blocked/, () => ({ tool: 'query.storiesBlocked', params: {} })],
  [/ohne schätzung|without (an )?estimate/, () => ({ tool: 'query.storiesNoEstimate', params: {} })],
  [/auf 100|to 100|100 ?%/, () => ({ tool: 'plan.balance', params: {}, wantsSet: true })],
  [/erinner|remind/, () => ({ tool: 'notify.remind', params: {}, wantsSet: true })],
  [/liste|list/, () => ({ tool: 'doc.list', params: {}, wantsSet: true })],
  [/c-?level|vorstand|board|geschäftsführung/, () => ({ tool: 'wf.cLevelReport', params: { audience: 'board' } })],
  [/rangfolge|ranking/, () => ({ tool: 'wf.reRankQuarter', params: {} })],
  [/schätzung|estimate/, () => ({ tool: 'fill.estimates', params: {} })],
  [/wasserlinie|waterline/, () => ({ tool: 'check.waterline', params: {} })],
  [/zusammenfass|summari|summary/, () => ({ tool: 'doc.brief', params: { audience: 'owners' } })],
  [/weekly/, () => ({ tool: 'wf.weeklyPrep', params: {} })],
  [/pdf|bericht|report|dokument/, (q) => ({ tool: 'doc.job', params: { format: /je |jede|each|every|jeweils/.test(q) ? 'pdfEach' : 'pdfAll' }, wantsSet: true })],
];
export function mockChainPlanModel(system, user) {
  const req = user.slice(user.indexOf('<request>') + 9, user.indexOf('</request>'));
  const { clauses } = splitClauses(req);
  const steps = [];
  let lastSet = null;
  for (const c of clauses) {
    const q = c.text.toLowerCase();
    const hit = RULES.find(([re]) => re.test(q));
    const s = hit ? hit[1](q) : { tool: 'skill.portfolioBrief', params: {} };
    const step = { tool: s.tool, params: s.params, input: s.wantsSet && lastSet ? lastSet : null };
    steps.push(step);
    if (/^query\./.test(s.tool) || s.tool === 'plan.balance') lastSet = `s${steps.length}`;
  }
  if (flag('ai', 'differs') && steps.length > 1) steps.splice(1, 0, { tool: 'skill.overtime', params: {}, input: null });
  return JSON.stringify({ steps, note: 'Plan aus dem Satz, Schritt für Schritt.' });
}
export function mockChainWriteModel(system, user) {
  const facts = JSON.parse(user.slice(user.indexOf('<story>') + 7, user.indexOf('</story>')));
  const de = facts.lang !== 'en';
  const k = facts.kpis?.[0];
  const num = k ? (flag('lotse', 'differs') ? Math.round(k.value * 1.3 + 2) : k.value) : null;
  const unit = k ? (k.unit === 'n' ? '' : k.unit === '%' ? (de ? ' %' : '%') : ` ${k.unit}`) : '';
  const first = facts.findings?.[0]?.text || facts.headline;
  if (/ONE opening sentence/.test(system)) return de ? `Hier ist deine Übersicht – ${k ? `${k.label}: ${num}${unit}.` : 'die Zahlen kommen direkt aus Jira.'}` : `Here is your overview – ${k ? `${k.label}: ${num}${unit}.` : 'the numbers come straight from Jira.'}`;
  return de ? `${facts.headline} ${first} ${k ? `${k.label} liegt bei ${num}${unit}.` : ''} Melde dich, wenn du Fragen hast.` : `${facts.headline} ${first} ${k ? `${k.label} is at ${num}${unit}.` : ''} Let me know if you have questions.`;
}
