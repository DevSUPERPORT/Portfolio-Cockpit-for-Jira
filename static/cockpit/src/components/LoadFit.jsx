// Load in plain words and one simple bar (boss 2026-11-20: "139 % / 125 % / 250 % – not so easy to understand; simpler,
// better visuals for inexperienced users; keep the percentage"). Used by the weekly board's cell heads and My work.
//   "8 h zu viel"  red, the bar's striped part beyond the line is what does not fit
//   "fast voll"    amber (above 85 %) · "12 h frei" green · "keine Zeit" (absent / no capacity)
import { fitOf, barOf, roundH } from '@shared/loadFit.js';
import { Icon } from '../lib/icons.jsx';
import { tr, fmt } from '../lib/i18n.js';

const hRound = (h) => fmt.h(roundH(h), h >= 9.95 ? 0 : 1);
const H = hRound;
export const fitWords = (f) => ({
  over: tr(`${H(f.over)} zu viel`, `${H(f.over)} too much`),
  noTime: tr('keine Zeit', 'no time'),
  full: tr('fast voll', 'nearly full'),
  ok: tr(`${H(f.free)} frei`, `${H(f.free)} free`),
  none: '',
}[f.kind]);
// the full sentence for hover cards and screen readers; h: the hour format – a card with a calculation passes the one
// its calculation uses, so the sentence and the box show the same numbers (boss 2026-11-23)
export const fitSentence = (f, who = null, H = hRound) => ({
  over: tr(`${H(f.load)} geplant, ${H(f.avail)} Zeit${who ? ` (${who})` : ''} – ${H(f.over)} passen nicht hinein.`, `${H(f.load)} planned, ${H(f.avail)} of time${who ? ` (${who})` : ''} – ${H(f.over)} do not fit.`),
  noTime: tr(`${H(f.load)} geplant, aber keine Zeit verfügbar.`, `${H(f.load)} planned, but no time available.`),
  full: tr(`${H(f.load)} geplant, ${H(f.avail)} Zeit – fast voll, noch ${H(f.free)} frei.`, `${H(f.load)} planned, ${H(f.avail)} of time – nearly full, ${H(f.free)} still free.`),
  ok: tr(`${H(f.load)} geplant, ${H(f.avail)} Zeit – ${H(f.free)} frei.`, `${H(f.load)} planned, ${H(f.avail)} of time – ${H(f.free)} free.`),
  none: tr('Nichts geplant.', 'Nothing planned.'),
}[f.kind]);
const ICON = { over: 'alert', noTime: 'alert', full: 'gauge', ok: 'check' };

// the bar: capacity line, planned part up to it, striped overflow beyond it
export function FitBar({ fit, className = '' }) {
  const b = barOf(fit);
  return (
    <span className={`fit-bar fit-${fit.kind} ${className}`} aria-hidden="true">
      <i className="fit-fill" style={{ width: `${b.fill * 100}%` }} />
      {b.over > 0 && <i className="fit-over" style={{ left: `${b.cap * 100}%`, width: `${b.over * 100}%` }} />}
      {b.over > 0 && b.cap > 0 && <b className="fit-cap" style={{ left: `${b.cap * 100}%` }} />}
    </span>
  );
}
// words with their icon (the colour comes from the surrounding tone)
export function FitWords({ fit, className = '' }) {
  if (fit.kind === 'none') return null;
  return <span className={`fit-words fit-${fit.kind} ${className}`}><Icon name={ICON[fit.kind]} size={11} />{fitWords(fit)}</span>;
}
export { fitOf };
