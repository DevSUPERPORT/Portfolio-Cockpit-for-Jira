# Buchungskontrolle – was vor einem Versand von Hinweisen geklärt sein muss

**Stand heute:** Das Cockpit **zeigt** je Person Möglich / Gebucht / Quote / Status – nur mit „Werte auf Personenebene“ und nur für Kapazitäts-Pflege, C-Level-Report-Gruppe und Jira-Admins (serverseitig erzwungen). Es **verschickt nichts**. Dieses Dokument listet, was Datenschutz und Betriebsrat sehen müssen, bevor automatische Hinweise oder Eskalationen eingeschaltet werden.

> Keine Rechtsberatung. Diese Liste bereitet das Gespräch mit Datenschutzbeauftragtem und Betriebsrat vor.

## Warum das ein Thema ist

- Eine Auswertung, wie viel jede Person gebucht hat, ist eine **Leistungs- und Verhaltenskontrolle** durch eine technische Einrichtung. In Deutschland ist sie in der Regel **mitbestimmungspflichtig (§ 87 Abs. 1 Nr. 6 BetrVG)**, schon wenn sie dazu *geeignet* ist.
- Die Verarbeitung personenbezogener Daten braucht eine **Rechtsgrundlage (Art. 6 DSGVO, § 26 BDSG)** und meist eine **Datenschutz-Folgenabschätzung (Art. 35 DSGVO)**, weil systematisch Beschäftigte überwacht werden könnten.

## Checkliste für die Freigabe

### 1. Zweck und Notwendigkeit
- [ ] Zweck schriftlich: *vollständige Ist-Stunden für Kapazitäts- und Projektplanung* – **nicht** Leistungsbewertung.
- [ ] Warum reicht die Team-Ebene nicht? (Die Team-Summen zeigen fehlende Buchungen ebenfalls, ohne Personenbezug.)
- [ ] Mildere Mittel geprüft: Erinnerung an alle statt Einzelhinweis; nur Selbstansicht für die eigene Person.

### 2. Daten und Zugriff
- [ ] Datenarten: Worklogs (Datum, Dauer, Vorgang), Wochenstunden, Standort, Abwesenheit **ohne Grund** (Gründe sieht nur die Kapazitäts-Pflege).
- [ ] Wer sieht Personenwerte: Kapazitäts-Pflege, Report-Gruppe, Jira-Admins – Namensliste beilegen.
- [ ] Keine Speicherung der Auswertung: Werte werden bei jedem Aufruf aus Jira gelesen, nichts wird im Cockpit abgelegt.
- [ ] Abschaltbar: „Werte auf Personenebene anzeigen“ aus → Tabelle und Server-Abfrage sind gesperrt.

### 3. Hinweise und Eskalationen (noch nicht gebaut)
- [ ] Wer bekommt was: Hinweis nur an die Person selbst; Eskalation an Team-Lead – nicht an Management, nicht an HR.
- [ ] Schwellen festgelegt und begründet (Vorschlag: unter 90 % Hinweis, ab 20 % fehlend Eskalation, 2 Arbeitstage Nachbuchfrist).
- [ ] Ausnahmen: Teilzeit, Krankheit, Elternzeit, Feiertage je Standort – Abwesenheiten müssen gepflegt sein, sonst entstehen falsche Hinweise.
- [ ] Rhythmus: wöchentlich, nicht täglich.
- [ ] Kein Ranking, keine Bestenliste, keine Historie je Person über mehr als den Prüfzeitraum.

### 4. Betriebsrat
- [ ] Information vorab mit Screenshots und dieser Liste.
- [ ] Betriebsvereinbarung oder Ergänzung der bestehenden IT-Rahmenvereinbarung.
- [ ] Verwertungsverbot: keine arbeitsrechtlichen Maßnahmen allein auf Basis dieser Auswertung.

### 5. Datenschutz-Folgenabschätzung (Kurzform)
- [ ] Beschreibung der Verarbeitung (Abschnitt 2).
- [ ] Risiken: Überwachungsdruck, Fehlinterpretation bei fehlenden Abwesenheiten, Zugriff zu breit.
- [ ] Maßnahmen: Rollenbeschränkung (umgesetzt), Abschalter (umgesetzt), Nachbuchfrist (umgesetzt), keine Speicherung (umgesetzt), Versand nur nach Freigabe (offen).
- [ ] Freigabe durch Datenschutzbeauftragten mit Datum.

## Was technisch bereits so umgesetzt ist

| Maßnahme | Wo |
|---|---|
| Nur mit Personenebene, nur bestimmte Rollen | `src/index.js` › `booking.worklogs`, `static/cockpit/src/components/BookingCard.jsx` |
| Abwesenheitsgründe nur für Kapazitäts-Pflege | `src/lib/dataset.js` (buildDataset) |
| Keine Speicherung der Auswertung | Werte werden je Aufruf gelesen |
| Kein Versand | Es gibt keinen Code, der Hinweise verschickt |
| Nachbuchfrist | `shared/booking.js` › `bookingRange` |
