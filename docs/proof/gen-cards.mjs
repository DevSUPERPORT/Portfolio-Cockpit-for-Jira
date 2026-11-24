// Generates docs/proof/METRIC-CARDS.md (German, for sign-off) from shared/metricCards.js – the same registry the
// app's "Nachweis" view shows, so the signed sheet and the screen can never drift apart.
// Usage: node docs/proof/gen-cards.mjs
import { writeFileSync } from 'node:fs';
import { metricCards, DATA_CONTRACT, OWNERS } from '../../shared/metricCards.js';

const cards = metricCards('de', { rules: { forecastThresholdPct: 10 }, booking: { minPct: 90, escalatePct: 20, graceDays: 2 } });
const lines = ['# Kennzahlen-Karten – Portfolio Cockpit', '', 'Je Zahl: welche Entscheidung sie stützt, wer entscheidet, die Formel, wer die Daten pflegt, Randfälle, Schwellen und wie man sie ohne die App prüft. Erzeugt aus `shared/metricCards.js` (dieselbe Quelle wie die Ansicht „Nachweis“).', '', '**Freigabe:** Bitte je Karte abzeichnen oder Änderung notieren. Eine Zahl ohne Entscheidung wird entfernt.', ''];
for (const c of cards) {
  lines.push(`## ${c.label}`, '', `- **Entscheidung:** ${c.question}`, `- **Entscheidet:** ${c.decider}`, `- **Formel:** \`${c.formula}\``);
  lines.push(`- **Quellen und Verantwortliche:**`, ...c.sources.map(([f, o]) => `  - ${f} – ${o}`));
  lines.push(`- **Randfälle:**`, ...c.edges.map((e) => `  - ${e}`));
  lines.push(`- **Schwellen:** ${c.thresholds}`, `- **Selbst prüfen:** ${c.verify}`, '', '| Freigabe | Name | Datum | Anmerkung |', '|---|---|---|---|', '| ☐ ok ☐ ändern ☐ entfernen | | | |', '');
}
lines.push('## Datenvertrag', '', '| Feld | Ebene | Verantwortlich | Wann |', '|---|---|---|---|');
for (const [, label, level, owner, when] of DATA_CONTRACT) lines.push(`| ${Array.isArray(label) ? label[0] : label} | ${level} | ${OWNERS[owner][0]} | ${when[0]} |`);
lines.push('');
writeFileSync(new URL('METRIC-CARDS.md', import.meta.url), lines.join('\n'));
console.log(`${cards.length} cards written`);
