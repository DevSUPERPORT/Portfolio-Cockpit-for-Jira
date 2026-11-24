# Verständnistest – Portfolio Cockpit

**Ziel:** Prüfen, ob Führungskräfte aus dem Bildschirm die richtige Entscheidung ableiten – ohne Erklärung, ohne Hilfe. Gemessen wird Richtigkeit und Zeit, nicht Gefallen.

**Teilnehmende:** 5 Personen, die Portfolio-Entscheidungen treffen oder vorbereiten (Management, Projekt-Owner, Team-Lead). Niemand, der am Cockpit mitgebaut hat.

**Dauer:** 20 Minuten je Person, einzeln, Bildschirm geteilt, laut denken.

**Daten:** Sandbox PCX auf superportdev (keine echten Projekte). Vorher einmal die Gegenprobe im Tab „Nachweis“ laufen lassen, damit die Zahlen bestätigt sind.

## Ablauf

1. **Begrüßung (2 Min.).** „Wir testen das Cockpit, nicht Sie. Sagen Sie laut, was Sie denken und wo Sie suchen. Ich helfe nicht – das ist Absicht.“
2. **Erster Eindruck (1 Min.).** Portfolio offen lassen, 10 Sekunden schauen, dann wegsehen: „Was ist Ihnen aufgefallen? Was ist das Wichtigste auf dieser Seite?“
3. **Sechs Aufgaben (je max. 2 Min.).** Frage vorlesen, Zeit stoppen, nicht helfen. Notieren: richtig/teilweise/falsch, Zeit, wo gesucht wurde, welche Worte unklar waren.
4. **Abschluss (3 Min.).** „Welche Zahl würden Sie Ihrem Chef zeigen? Welcher würden Sie nicht trauen – und warum?“

## Die sechs Fragen

| # | Frage | Richtige Antwort führt über | Erfolgskriterium |
|---|---|---|---|
| 1 | Welches Projekt braucht zuerst Hilfe – und warum? | Portfolio: Health, Warnungen am Stunden-Balken, Wasserlinie | Nennt das Projekt mit roter Health oder Prognose-Warnung **und** einen Grund aus dem Bildschirm |
| 2 | Wie belastbar sind die Zahlen von „KI-Kundenservice“? Dürfen Sie darauf einen Termin zusagen? | Reife-Spalte bzw. Kachel Reife + Mouseover | Erklärt Reife sinngemäß („wie viel schon fein geschätzt ist“) und folgert richtig |
| 3 | Welches Team ist im nächsten Quartal überlastet, und um wie viele Stunden? | Teamdetails › „Frei / fehlt“ oder Portfolio-Quartalszelle | Richtiges Team **und** Stunden ±10 % |
| 4 | Was steht gerade still, und seit wann? | Abhängigkeiten › Blockiert (oder Teamdetails) | Findet die Liste; nennt „Seit“ richtig oder sagt korrekt „nichts blockiert“ |
| 5 | Wer hat im Oktober zu wenig Zeit gebucht? | Time Spent vs. Estimate › Gebuchte Stunden | Findet die Tabelle und liest den Status richtig (nur Testperson mit Rolle) |
| 6 | Woher wissen Sie, dass die Zahl „Original Estimate“ von SEPA stimmt? | Nachweis › Gegenprobe oder Kennzahlen-Karte | Findet einen Beleg ohne Hilfe (Gegenprobe ✓ oder „Selbst prüfen“) |

## Auswertung

- **Erfolgsquote je Frage** (richtig = 1, teilweise = 0,5). Ziel: ≥ 80 % je Frage, ≥ 90 % gesamt.
- **Median-Zeit je Frage.** Ziel: < 60 Sekunden für 1–4.
- **Wörter, die stockten** (z. B. „offene T-Shirt Size“, „Wasserlinie“): je Nennung eine Zeile. Wiederholt sich ein Wort bei 2+ Personen, wird es umbenannt oder erklärt.
- **Vertrauensfrage (Abschluss):** Jede Zahl, der jemand nicht traut, bekommt eine Notiz in der Kennzahlen-Karte.

## Protokollvorlage

| Person | Rolle | F1 | F2 | F3 | F4 | F5 | F6 | Unklare Wörter | Würde zeigen | Würde nicht trauen |
|---|---|---|---|---|---|---|---|---|---|---|
| | | ☐ ☐ ☐ s | | | | | | | | |

(☐ richtig ☐ teilweise ☐ falsch, s = Sekunden)
