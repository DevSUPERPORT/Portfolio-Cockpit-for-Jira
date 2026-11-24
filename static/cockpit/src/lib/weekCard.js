// One person-week explained in a tooltip (My work: the 8-week strip and "Load this week"). Boss 2026-11-23:
// "add the calculation in the box" and "the complete period and the information for the free days – holidays etc.":
//   KW 50 · 07.12. – 11.12.2026
//   40 h week − 8 h holiday / absent (1 day) − 4 h daily business & internal = 28 h time for projects
//   20,25 h planned → 28 h − 20,25 h = 7,75 h free · 20,25 h ÷ 28 h = 72 %
// and the days off by name. The numbers are the board's (personBoardWeeks) – the same as Weekly planning and Teams.
import { tr, fmt } from './i18n.js';

const EPS = 0.05;
/** The hour format of the calculation – also for the sentence above it (fitSentence(fit, null, hExact)). */
export const hExact = (v) => fmt.h(v || 0, Math.abs((v || 0) - Math.round(v || 0)) < 0.001 ? 0 : 2);
const H = hExact;
const dm = (iso, year = false) => fmt.date(iso, { day: '2-digit', month: '2-digit', ...(year ? { year: 'numeric' } : {}) });
const wd = (iso) => fmt.date(iso, { weekday: 'short' });

/** "07.12. – 11.12.2026" (Monday to Friday of the week) */
export const weekPeriod = (w) => (w?.to ? `${dm(w.from)} – ${dm(w.to, true)}` : dm(w?.from, true));

/** The calculation as lines (white-space: pre-line in the card), or null when nothing is planned and there is no time. */
export function weekCalc(w) {
  if (!w) return null;
  const plan = w.plan ?? w.load ?? 0, cap = w.cap ?? w.avail ?? 0;
  const lines = [];
  if (w.nominal > EPS) {
    const offDays = (w.holidays || 0) + (w.absent || 0);
    lines.push(tr(`${H(w.nominal)} Wochenstunden`, `${H(w.nominal)} weekly hours`));
    const what = (w.holidays || 0) > 0 && (w.absent || 0) > 0 ? tr('Feiertag / abwesend', 'holiday / absent') : (w.absent || 0) > 0 ? tr('abwesend', 'absent') : tr('Feiertag / frei', 'holiday / day off');
    if (w.off > EPS) lines.push(tr(`− ${H(w.off)} ${what} (${offDays} ${offDays === 1 ? 'Tag' : 'Tage'})`, `− ${H(w.off)} ${what} (${offDays} ${offDays === 1 ? 'day' : 'days'})`));
    if (w.daily > EPS) lines.push(tr(`− ${H(w.daily)} Tagesgeschäft & Intern`, `− ${H(w.daily)} daily business & internal`));
    lines.push(tr(`= ${H(cap)} Zeit für Projekte`, `= ${H(cap)} time for projects`));
    lines.push('');
  }
  if (plan > EPS) {
    const parts = (w.support || 0) > EPS && (w.tasks || 0) > EPS ? tr(` (Tasks ${H(w.tasks)} + Support ${H(w.support)})`, ` (tasks ${H(w.tasks)} + support ${H(w.support)})`) : '';
    lines.push(tr(`${H(plan)} geplant${parts}`, `${H(plan)} planned${parts}`));
    if (cap > EPS) {
      lines.push(plan - cap > EPS
        ? tr(`${H(plan)} − ${H(cap)} = ${H(plan - cap)} zu viel`, `${H(plan)} − ${H(cap)} = ${H(plan - cap)} too much`)
        : tr(`${H(cap)} − ${H(plan)} = ${H(cap - plan)} frei`, `${H(cap)} − ${H(plan)} = ${H(cap - plan)} free`));
      lines.push(`${H(plan)} ÷ ${H(cap)} = ${fmt.pct(plan / cap)}`);
    } else lines.push(tr('keine Zeit in dieser Woche – passt nicht hinein', 'no time this week – does not fit'));
  } else if (lines.length) lines.push(tr('nichts geplant', 'nothing planned'));
  while (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines.length ? lines.join('\n') : null;
}

const offLabel = (d) => (d.kind === 'holiday' ? tr(`Feiertag${d.name ? `: ${d.name}` : ''}`, `Public holiday${d.name ? `: ${d.name}` : ''}`)
  : d.kind === 'own' ? tr(`Betriebsfrei${d.name ? `: ${d.name}` : ''}`, `Company day off${d.name ? `: ${d.name}` : ''}`)
    : d.type === 'vacation' ? tr('Urlaub', 'Vacation') : d.type === 'training' ? tr('Schulung', 'Training') : tr('Abwesend', 'Absent'));

/** The days off of the week as card items: "Fr 25.12. · Feiertag: 1. Weihnachtstag" */
export const daysOffItems = (w) => (w?.daysOff || []).map((d) => ({ text: `${wd(d.iso)} ${dm(d.iso)} · ${offLabel(d)}`, tone: d.kind === 'absent' ? 'warn' : null }));

/** The whole infoCard for one week of My work. */
// text: the fit sentence (LoadFit's fitSentence – passed in, so this module stays plain JS for the tests)
export function weekInfo(w, { text = null, hint = null } = {}) {
  const items = daysOffItems(w);
  const allOff = w.nominal > EPS && (w.days || 0) === 0 && w.daysOff?.length > 0;
  return {
    title: fmt.week(w.from),
    sub: `${weekPeriod(w)}${allOff ? tr(' · ganze Woche frei', ' · whole week off') : w.days > 0 && w.days < 5 ? tr(` · ${w.days} Arbeitstage`, ` · ${w.days} working days`) : ''}`,
    text,
    calc: weekCalc(w),
    items, itemsTitle: items.length ? tr('Freie Tage', 'Days off') : null,
    hint,
  };
}
