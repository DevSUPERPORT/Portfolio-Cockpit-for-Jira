# Kennzahlen-Karten – Portfolio Cockpit

Je Zahl: welche Entscheidung sie stützt, wer entscheidet, die Formel, wer die Daten pflegt, Randfälle, Schwellen und wie man sie ohne die App prüft. Erzeugt aus `shared/metricCards.js` (dieselbe Quelle wie die Ansicht „Nachweis“).

**Freigabe:** Bitte je Karte abzeichnen oder Änderung notieren. Eine Zahl ohne Entscheidung wird entfernt.

## Fortschritt

- **Entscheidung:** Ist das Projekt so weit, wie der Kalender sagt – oder muss der Termin auf den Tisch?
- **Entscheidet:** Projekt-Owner, Management
- **Formel:** `Time Spent ÷ (Time Spent + Remaining Estimate + offene T-Shirt Size)`
- **Quellen und Verantwortliche:**
  - Time Spent (Σ Stories inkl. Sub-tasks) – Jede Person (eigene Buchungen)
  - Remaining Estimate (offene Stories) – Assignee der Story
  - T-Shirt Size, Quarter/s (Epic) – Lead-Team des Epics
- **Randfälle:**
  - Nichts geschätzt → „–“, nicht 0 %.
  - Erledigte Stories zählen nur mit Time Spent (kein Remaining).
- **Schwellen:** Keine Ampel – der Wert wird mit dem Zeitverlauf gelesen.
- **Selbst prüfen:** JQL: Stories des Projekts; Σ timespent ÷ (Σ timespent + Σ timeestimate der offenen + offene T-Shirt Size).

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Prognose

- **Entscheidung:** Reicht das Budget (Original Estimate), oder muss nachverhandelt werden?
- **Entscheidet:** Projekt-Owner, Management
- **Formel:** `(Time Spent + Remaining Estimate) ÷ Original Estimate − 1`
- **Quellen und Verantwortliche:**
  - Time Spent – Jede Person (eigene Buchungen)
  - Remaining Estimate – Assignee der Story
  - Original Estimate – Assignee der Story
- **Randfälle:**
  - Ohne Original Estimate → „–“.
  - Remaining Estimate, das nicht gepflegt wird, macht die Prognose zu optimistisch – die Gegenprobe „Treffsicherheit“ zeigt, wie gut sie bisher war.
- **Schwellen:** Rot ab +10 % (Konfiguration „Warnschwelle Prognose“).
- **Selbst prüfen:** JQL: Σ timespent + Σ timeestimate (offen) gegen Σ timeoriginalestimate der Stories.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Reife

- **Entscheidung:** Wie belastbar sind die Zahlen – darf ich auf dieser Basis zusagen?
- **Entscheidet:** Management (Zusagen), Lead-Team (Feinschätzung)
- **Formel:** `Original Estimate ÷ (Original Estimate + offene T-Shirt Size)`
- **Quellen und Verantwortliche:**
  - Original Estimate – Assignee der Story
  - T-Shirt Size, Quarter/s – Lead-Team des Epics
- **Randfälle:**
  - Keine T-Shirt Size → „–“ (unbekannt, wie viel fehlt; nie 100 %).
  - T-Shirt Size nur in abgelaufenen Quartalen und nichts geschätzt → „–“, „verfallen“.
  - Nur Epics mit T-Shirt Size zählen; der Rest wird genannt.
- **Schwellen:** Keine Ampel; unter ca. 50 % beruhen die Zahlen überwiegend auf T-Shirt Sizes.
- **Selbst prüfen:** Epic-Feld T-Shirt Size + Quarter/s, je Quartal minus Original Estimate der Stories darunter (mindestens 0).

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Datenqualität

- **Entscheidung:** Kann ich den anderen Zahlen trauen, oder muss zuerst gepflegt werden?
- **Entscheidet:** Lead-Team, Assignees
- **Formel:** `(Epics vollständig + Stories vollständig) ÷ (Epics + Stories)`
- **Quellen und Verantwortliche:**
  - Pflichtfelder laut Konfiguration – Jira-Admin
  - Feldwerte – Lead-Team des Epics, Assignee der Story
- **Randfälle:**
  - Erledigte Stories zählen nur mit Original Estimate.
  - Due Date nach dem Meilenstein macht eine Story unvollständig.
- **Schwellen:** Rot unter 70 %.
- **Selbst prüfen:** JQL je Pflichtfeld: „Team is EMPTY“, „originalEstimate is EMPTY“, „duedate is EMPTY“ …

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Abhängigkeiten

- **Entscheidung:** Bremst ein anderes Projekt oder Team dieses aus?
- **Entscheidet:** Projekt-Owner beider Seiten
- **Formel:** `Verknüpfungen der konfigurierten Link-Typen; Konflikt: Due Date der Voraussetzung > Start Date des wartenden Vorgangs (beide offen)`
- **Quellen und Verantwortliche:**
  - Issue Links „Blocks“/„Depends“ – Assignee der Story
  - Start/Due date – Assignee der Story
- **Randfälle:**
  - „Relates“ ist nur Bezug, nie Konflikt.
- **Schwellen:** Rot bei mindestens einem Terminkonflikt.
- **Selbst prüfen:** JQL: issueLinkType in ("blocks") und Due/Start der beiden Seiten vergleichen.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Über Due Date

- **Entscheidung:** Welche Zusagen sind gerissen und brauchen einen neuen Termin oder Hilfe?
- **Entscheidet:** Assignee, Lead-Team
- **Formel:** `Offene Stories mit Due Date < heute`
- **Quellen und Verantwortliche:**
  - Due date, Status – Assignee der Story
- **Randfälle:**
  - Sub-tasks zählen nicht (keine Termine auf Kleinst-Tasks).
- **Schwellen:** Rot ab 1, wenn „Warnung bei überschrittenem Due Date“ an ist.
- **Selbst prüfen:** JQL: duedate < now() AND statusCategory != Done AND issuetype = Story

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Kapazität

- **Entscheidung:** Bekommt das Projekt die Leute, die es braucht – jetzt und in den nächsten Quartalen?
- **Entscheidet:** Management (Rang), Team-Leads (Verteilung)
- **Formel:** `Team-Quartale nicht voll besetzbar + Personen mit Wochen-Problem (über 100 %, abwesend mit geplanten Stunden, ohne Assignee)`
- **Quellen und Verantwortliche:**
  - Remaining Estimate, Start/Due, Assignee – Assignee der Story
  - Wochenstunden, Abwesenheiten – Gruppe „Kapazitäten pflegen“
  - Portfolio-Rang – Gruppe „Portfolio-Rang ändern“
- **Randfälle:**
  - Ohne gepflegte Kapazität gelten 40 h/Woche je Assignee (abgeleitet, markiert).
- **Schwellen:** „OK“ bei 0, sonst rot.
- **Selbst prüfen:** Tab Kapazität: dieselben Wochen- und Quartalszellen.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Wasserlinie

- **Entscheidung:** Welche Projekte schaffen wir mit den vorhandenen Leuten – und was fällt raus?
- **Entscheidet:** Management
- **Formel:** `Je Team und Quartal: Kapazität − Support, dann Bedarf (Remaining + offene T-Shirt Size) in Rangfolge abziehen; erstes Projekt, das nicht mehr passt = Wasserlinie`
- **Quellen und Verantwortliche:**
  - Rang – Gruppe „Portfolio-Rang ändern“
  - Kapazität – Gruppe „Kapazitäten pflegen“
  - Bedarf – Assignee der Story, Lead-Team des Epics
- **Randfälle:**
  - Support hat immer Vorrang vor Rang 1.
- **Schwellen:** Orange: teilweise besetzbar, voll orange: nicht besetzbar.
- **Selbst prüfen:** Teamdetails: Kapazität nach Support − Projektbedarf = Frei/fehlt.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Support-Reservierung

- **Entscheidung:** Wie viel Team-Kapazität frisst der Support, bevor ein Projekt drankommt?
- **Entscheidet:** Management, Service-Lead
- **Formel:** `Ø Time Spent je Woche auf Support-Tickets (letzte 4/8 Wochen; steigt er in den letzten 2 Wochen über 1,2 × Ø, der höhere Wert) × 12 Wochen`
- **Quellen und Verantwortliche:**
  - Worklogs auf Support-Tickets – Service-Team (SUP)
  - Team-Feld der Tickets – Service-Team (SUP)
- **Randfälle:**
  - Tickets ohne Team zählen unter „Ohne Team“.
- **Schwellen:** „Steigt“-Hinweis bei > 1,2 × Ø.
- **Selbst prüfen:** JQL der Support-Queue; Worklogs der letzten Wochen summieren.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## SLA

- **Entscheidung:** Hält der Support seine Zusagen – braucht er mehr Leute?
- **Entscheidet:** Service-Lead, Management
- **Formel:** `eingehaltene SLAs ÷ (eingehaltene + verletzte)`
- **Quellen und Verantwortliche:**
  - JSM-SLA-Felder oder App-Ziele je Priorität – Service-Team (SUP)
- **Randfälle:**
  - Ohne SLA-Daten keine Health.
- **Schwellen:** Grün ab Ziel, gelb bis 5 Punkte darunter, rot darunter.
- **Selbst prüfen:** JSM-Bericht „SLA-Erfüllung“ für denselben Zeitraum.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Blocked

- **Entscheidung:** Wo steht Arbeit still – und wer muss sie lösen?
- **Entscheidet:** Lead-Team, Projekt-Owner
- **Formel:** `Offene Stories und Sub-tasks im Status Blocked; „Seit“ = letzter Wechsel nach Blocked (Jira-Historie)`
- **Quellen und Verantwortliche:**
  - Status – Assignee der Story
  - Kommentar (Grund) – Assignee der Story
  - Status-Auswahl – Jira-Admin
- **Randfälle:**
  - Ohne Status „Blocked“ im Workflow immer 0 – die Konfiguration sagt es.
- **Schwellen:** Rot ab 8 Tagen.
- **Selbst prüfen:** JQL: status = Blocked AND statusCategory != Done

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Buchungsquote

- **Entscheidung:** Sind die Ist-Stunden vollständig – oder fehlen Buchungen, die alle anderen Zahlen verfälschen?
- **Entscheidet:** Team-Lead (Hinweis), Management (Eskalation)
- **Formel:** `gebucht ÷ (Wochenstunden ÷ 5 × (Arbeitstage − Feiertage − Abwesenheit))`
- **Quellen und Verantwortliche:**
  - Worklogs (alle Vorgänge) – Jede Person (eigene Buchungen)
  - Wochenstunden, Standort, Abwesenheit,Weekly hours, location, absence – Gruppe „Kapazitäten pflegen“
- **Randfälle:**
  - Die letzten 2 Arbeitstage zählen nicht (Nachbuchfrist).
  - Nur mit Werten auf Personenebene; nur für Kapazitäts-Pflege, Report-Gruppe, Jira-Admins.
- **Schwellen:** OK ab 90 %, Eskalation ab 20 % fehlend, sonst Hinweis.
- **Selbst prüfen:** JQL: worklogAuthor = <Person> AND worklogDate >= … ; Worklogs der Person summieren.

| Freigabe | Name | Datum | Anmerkung |
|---|---|---|---|
| ☐ ok ☐ ändern ☐ entfernen | | | |

## Datenvertrag

| Feld | Ebene | Verantwortlich | Wann |
|---|---|---|---|
| Owner | project | Jira-Admin | beim Anlegen |
| Health + Kommentar | project | Projekt-Owner | alle 7 Tage |
| T-Shirt Size | rough | Lead-Team des Epics | beim Anlegen des Epics |
| Quarter/s | rough | Lead-Team des Epics | beim Anlegen des Epics |
| Team | rough | Lead-Team des Epics | beim Anlegen des Epics |
| Team | estimate | Assignee der Story | vor „Ready“ |
| Original Estimate | estimate | Assignee der Story | vor „Ready“ |
| Start date | estimate | Assignee der Story | vor „Ready“ |
| Due date | estimate | Assignee der Story | vor „Ready“ |
| Remaining Estimate | estimate | Assignee der Story | laufend, bei jeder Buchung |
| Work Log | estimate | Jede Person (eigene Buchungen) | täglich, auf Stories |
| Wochenstunden, Standort, Abwesenheit | person | Gruppe „Kapazitäten pflegen“ | bei Änderung |
| Status (inkl. Blocked) | estimate | Assignee der Story | bei jeder Änderung |
