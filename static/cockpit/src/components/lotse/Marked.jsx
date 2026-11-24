// An AI text with every checked claim marked in place (✓ green / ✗ red) – shared by Lotse's "KI-Lesart" (CrossCheck.jsx)
// and the teamwork panels (AiAssist.jsx), so both read the same.
import { tr } from '../../lib/i18n.js';

export default function Marked({ text, claims, className = 'lx-ai-text' }) {
  const marks = (claims || []).filter((c) => c.text && c.verified != null && text.includes(c.text));
  if (!marks.length) return <p className={className}>{text}</p>;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // whole tokens only: the claim "2" must not light up the 2 inside "2027" or "KPR-12"
  const re = new RegExp(`(?<![\\p{L}\\p{N}-])(${marks.map((c) => esc(c.text)).sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'gu');
  return (
    <p className={className}>
      {text.split(re).map((part, i) => {
        const c = marks.find((m) => m.text === part);
        if (!c) return <span key={i}>{part}</span>;
        const exp = c.expected || tr('nicht in den Daten', 'not in the data');
        return <mark key={i} className={c.verified ? 'ok' : 'bad'} title={c.verified ? tr('geprüft – stimmt', 'checked – correct') : tr(`geprüft: ${exp}`, `checked: ${exp}`)}>{part}<sup aria-hidden="true">{c.verified ? '✓' : '✗'}</sup><span className="sr">{c.verified ? tr(' (stimmt)', ' (correct)') : tr(` (falsch, geprüft: ${exp})`, ` (wrong, checked: ${exp})`)}</span></mark>;
      })}
    </p>
  );
}
