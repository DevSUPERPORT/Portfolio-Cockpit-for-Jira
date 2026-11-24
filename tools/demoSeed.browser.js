// Demo data for testers (boss 2026-11-23: "a LOT of data, super realistic, test how scalable the app gets").
// Runs in a browser tab on https://superportdev.atlassian.net (same-origin REST, as the signed-in user). Writes ONLY to
// the sandbox space PCX; every item carries the label pc-demo (projects, epics, stories, sub-tasks, bugs; workstreams
// have no label field – they are listed in window.__demo.created). Deterministic (seeded), so a rerun creates the same
// shape. Remove all:  JQL `project = PCX AND labels = pc-demo` + the workstream keys in docs/DEMO-DATA.md.
//
// Usage (in the page): paste this file, then `await __demo.run({ dry: false })`; progress in window.__demo.log.
(() => {
  const TODAY = '2026-11-23';
  const P = 'PCX';
  const T = { project: '10041', ws: '10040', epic: '10000', story: '10008', task: '10010', bug: '10009', sub: '10007' };
  // Fill in the Atlassian team ids and account ids of YOUR test site before running (Jira › Teams; people's profile URLs).
  const TEAM = { Data: '<team-id Data>', Integration: '<team-id Integration>', Netz: '<team-id Netz>', Web: '<team-id Web>', UX: '<team-id UX>', Mobile: '<team-id Mobile>' };
  const U = { dev: '<accountId Dev Team>', colleagueA: '<accountId colleague A>', colleagueB: '<accountId colleague B>', colleagueC: '<accountId colleague C>', tester: '<accountId Test Tester>' };
  const F = { start: 'customfield_10015', team: 'customfield_10001', tshirt: 'customfield_10210', quarters: 'customfield_10209' };
  const LABEL = 'pc-demo';

  // ---------- seeded random ----------
  let seed = 20261123;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p) => rnd() < p;
  const weighted = (pairs) => { const tot = pairs.reduce((s, [, w]) => s + w, 0); let x = rnd() * tot; for (const [v, w] of pairs) { if ((x -= w) <= 0) return v; } return pairs.at(-1)[0]; };

  // ---------- dates (working days) ----------
  const D = (iso) => new Date(`${iso}T00:00:00Z`);
  const iso = (d) => d.toISOString().slice(0, 10);
  const addDays = (s, n) => { const d = D(s); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const wk = (s) => { let d = D(s); while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1); return iso(d); };
  const wkBack = (s) => { let d = D(s); while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1); return iso(d); };
  const diff = (a, b) => Math.round((D(b) - D(a)) / 864e5);
  const quartersOf = (a, b) => { const out = []; let d = D(a); d.setUTCDate(1); while (iso(d) <= b) { const q = `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; if (!out.includes(q)) out.push(q); d.setUTCMonth(d.getUTCMonth() + 1); } return out; };
  const adf = (text) => ({ type: 'doc', version: 1, content: text.split('\n\n').map((p) => ({ type: 'paragraph', content: [{ type: 'text', text: p }] })) });

  // ---------- the portfolio: 14 programmes of a mid-size utility / telco ----------
  const PROJECTS = [
    { name: 'ERP-Migration S/4HANA', team: 'Integration', owner: 'colleagueA', start: '2026-05-04', due: '2027-09-30', size: 'XL', ws: ['Finanzen & Controlling', 'Einkauf & Logistik', 'Datenmigration', 'Go-live & Hypercare'], vocab: ['Buchungskreise', 'Kreditorenstamm', 'Anlagenbuchhaltung', 'Bestellprozess', 'Lagerverwaltung', 'Kostenstellen', 'Mahnwesen', 'Zahlungslauf', 'Materialstamm', 'Berechtigungsrollen SAP'] },
    { name: 'Kundenportal Relaunch 2027', team: 'Web', owner: 'colleagueC', start: '2026-09-01', due: '2027-06-30', size: 'L', ws: ['Design & UX', 'Frontend', 'Backend & APIs'], vocab: ['Login mit Passkey', 'Vertragsübersicht', 'Rechnungsarchiv', 'Zählerstandserfassung', 'Umzugsmeldung', 'Abschlagsrechner', 'Barrierefreiheit (BFSG)', 'Postfach', 'Tarifwechsel', 'Cookie-Consent'] },
    { name: 'Mobile App 2.0', team: 'Mobile', owner: 'colleagueB', start: '2026-10-05', due: '2027-05-28', size: 'L', ws: ['App-Kern', 'Push & Benachrichtigungen', 'Store-Release'], vocab: ['Offline-Modus', 'Push-Benachrichtigungen', 'Biometrie-Login', 'Deep Links', 'Crash-Reporting', 'Dark Mode', 'In-App-Feedback', 'App-Store-Freigabe', 'Tablet-Layout'] },
    { name: 'Data Warehouse Modernisierung', team: 'Data', owner: 'colleagueA', start: '2026-07-01', due: '2027-08-31', size: 'XL', ws: ['Plattform', 'Datenstrecken', 'Reporting & Self-Service'], vocab: ['Lakehouse-Zone', 'CDC-Strecke ERP', 'Datenkatalog', 'Data-Quality-Regeln', 'Historisierung SCD2', 'Kostenmonitoring', 'Zugriffskonzept', 'Semantic Layer', 'Ladejobs Nacht'] },
    { name: 'Netzausbau Süd (Glasfaser)', team: 'Netz', owner: 'tester', start: '2026-03-02', due: '2027-03-31', size: 'XL', ws: ['Planung & Genehmigung', 'Tiefbau', 'Aktivierung'], vocab: ['Trassenplanung', 'Genehmigung Gemeinde', 'Tiefbau Los', 'Hausanschlüsse', 'PoP-Standort', 'Spleißarbeiten', 'Abnahmemessung', 'Kundenaktivierung', 'Dokumentation GIS'] },
    { name: 'IT-Security Programm ISO 27001', team: 'Integration', owner: 'colleagueC', start: '2026-08-03', due: '2027-12-17', size: 'L', ws: ['ISMS & Richtlinien', 'Technische Maßnahmen', 'Audit-Vorbereitung'], vocab: ['Asset-Inventar', 'Risikoanalyse', 'Patch-Management', 'MFA flächendeckend', 'SIEM-Anbindung', 'Notfallhandbuch', 'Awareness-Schulung', 'Lieferantenbewertung', 'Pentest'] },
    { name: 'CRM-Konsolidierung', team: 'Web', owner: 'colleagueA', start: '2026-04-06', due: '2026-12-18', size: 'M', ws: ['Datenbereinigung', 'Prozesse', 'Ablösung Altsystem'], vocab: ['Dublettenbereinigung', 'Kontaktmodell', 'Lead-Prozess', 'Kampagnenmodul', 'Schnittstelle Telefonie', 'Berichtswesen Vertrieb', 'Altsystem abschalten'] },
    { name: 'E-Rechnung (XRechnung/ZUGFeRD) 2027', team: 'Integration', owner: 'colleagueB', start: '2026-11-02', due: '2027-01-29', size: 'M', ws: ['Eingangsrechnungen', 'Ausgangsrechnungen'], vocab: ['XRechnung-Validierung', 'ZUGFeRD-Profil', 'Peppol-Anbindung', 'Archivierung GoBD', 'Freigabe-Workflow', 'Fehlerqueue'] },
    { name: 'Cloud-Migration Rechenzentrum West', team: 'Netz', owner: 'tester', start: '2027-01-11', due: '2027-11-26', size: 'XL', ws: ['Landing Zone', 'Migration Wellen', 'Rückbau RZ'], vocab: ['Netzwerk-Hub', 'Identity-Föderation', 'Backup-Konzept', 'Migrationswelle', 'Lizenzprüfung', 'Monitoring', 'Rückbau Racks', 'Kosten-Tagging'] },
    { name: 'Smart-Meter-Rollout', team: 'Netz', owner: 'dev', start: '2026-06-01', due: '2027-10-29', size: 'XL', ws: ['Gateway-Administration', 'Rollout-Steuerung', 'Marktkommunikation'], vocab: ['Gateway-Zertifikate', 'Einbautermine', 'Montage-App', 'Messwertverarbeitung', 'MaKo-Prozesse', 'Störfallmanagement', 'Pilotgebiet'] },
    { name: 'HR-Self-Service', team: 'UX', owner: 'colleagueC', start: '2027-02-01', due: '2027-07-30', size: 'M', ws: ['Mitarbeiterportal', 'Prozesse HR'], vocab: ['Urlaubsantrag', 'Gehaltsnachweis digital', 'Onboarding-Checkliste', 'Adressänderung', 'Zeugnisanforderung', 'Single Sign-on'] },
    { name: 'Logistik-Tracking in Echtzeit', team: 'Data', owner: 'colleagueB', start: '2027-03-01', due: '2027-12-17', size: 'L', ws: ['Telematik', 'Kundeninformation'], vocab: ['GPS-Datenstrom', 'Geofencing', 'ETA-Prognose', 'Kundenbenachrichtigung', 'Fahrer-App', 'Störungsmeldung'] },
    { name: 'BI-Dashboard Vertrieb', team: 'Data', owner: 'dev', start: '2026-10-12', due: '2027-02-26', size: 'S', ws: ['Dashboards'], vocab: ['Umsatz je Region', 'Pipeline-Ansicht', 'Abschlussquote', 'Kundenwert', 'Export für Management'] },
    { name: 'Onboarding-Automatisierung', team: 'Web', owner: 'tester', start: '2026-02-02', due: '2026-10-30', size: 'S', ws: ['Automatisierung'], vocab: ['Konto anlegen', 'Hardware bestellen', 'Zugänge vergeben', 'Willkommensmail', 'Checkliste Führungskraft'] },
  ];
  const VERBS = ['Konzept', 'Umsetzung', 'Schnittstelle', 'Test', 'Migration', 'Abnahme', 'Dokumentation', 'Optimierung', 'Prototyp', 'Review', 'Rollout', 'Datenmodell', 'Berechtigungen', 'Lasttest', 'Monitoring'];
  const SUBS = ['Code-Review', 'Testfälle schreiben', 'Doku aktualisieren', 'Deployment vorbereiten', 'Fachliche Abnahme', 'Security-Check'];
  const PEOPLE = [['dev', 14], ['colleagueA', 10], ['colleagueB', 10], ['colleagueC', 9], ['tester', 12], [null, 45]];
  const TEAMS_ALT = ['Web', 'Data', 'Integration', 'Netz'];

  // ---------- the plan (pure data) ----------
  function plan() {
    seed = 20261123;
    const projects = [];
    for (const [pi, p] of PROJECTS.entries()) {
      const span = diff(p.start, p.due);
      const wsN = p.ws.length;
      const project = { kind: 'project', name: p.name, team: p.team, owner: p.owner, start: p.start, due: p.due, size: p.size, workstreams: [], pi };
      p.ws.forEach((wsName, wi) => {
        const ws = { kind: 'ws', name: `${wsName} – ${p.name.split(' ')[0]}`, team: wi === 0 ? p.team : (chance(0.7) ? p.team : pick(TEAMS_ALT)), size: pick(['S', 'M', 'M', 'L']), epics: [] };
        // workstreams overlap: each covers a slice of the project with 20 % overlap
        const a = addDays(p.start, Math.floor((span * wi) / wsN * 0.85));
        const b = addDays(p.start, Math.min(span, Math.floor((span * (wi + 1)) / wsN * 1.1)));
        ws.start = wk(a); ws.due = wkBack(b);
        const epN = p.size === 'S' ? int(2, 3) : int(3, 4);
        const wsSpan = Math.max(20, diff(ws.start, ws.due));
        for (let ei = 0; ei < epN; ei++) {
          const ea = addDays(ws.start, Math.floor((wsSpan * ei) / epN * 0.8));
          const eb = addDays(ws.start, Math.min(wsSpan, Math.floor((wsSpan * (ei + 1)) / epN * 1.15)));
          const topic = p.vocab[(wi * 3 + ei) % p.vocab.length];
          const epic = { kind: 'epic', name: `${topic}`, team: ws.team, owner: weighted(PEOPLE.filter(([k]) => k)), start: wk(ea), due: wkBack(eb), size: pick(['S', 'M', 'L']), stories: [] };
          const stN = int(4, 8);
          const eSpan = Math.max(10, diff(epic.start, epic.due));
          for (let si = 0; si < stN; si++) {
            const sa = addDays(epic.start, Math.floor((eSpan * si) / stN));
            const len = int(3, 15);
            let start = wk(sa), due = wkBack(addDays(sa, len));
            if (due < start) due = start;
            const verb = VERBS[(si + ei + wi) % VERBS.length];
            const big = chance(0.06);
            const st = {
              kind: chance(0.15) ? 'task' : 'story',
              name: `${verb} ${topic}${si > 2 ? ` (Teil ${si - 1})` : ''}`,
              team: chance(0.9) ? ws.team : pick(TEAMS_ALT),
              assignee: weighted(PEOPLE),
              start, due,
              oe: big ? int(60, 120) : pick([4, 6, 8, 8, 12, 16, 16, 20, 24, 32, 40]),
              subs: [],
            };
            // deliberate data problems testers should find (each a few %)
            if (chance(0.04)) st.oe = null; // no estimate
            if (chance(0.02)) [st.start, st.due] = [st.due, addDays(st.start, -int(3, 10))]; // start after due
            if (chance(0.03)) { st.team = null; st.assignee = null; }
            if (chance(0.03)) st.start = null;
            if (chance(0.22)) for (let k = 0; k < int(1, 3); k++) st.subs.push({ name: SUBS[(k + si) % SUBS.length], oe: pick([2, 3, 4, 6]), assignee: st.assignee });
            epic.stories.push(st);
          }
          ws.epics.push(epic);
        }
        project.workstreams.push(ws);
      });
      projects.push(project);
    }
    // parentless work in the space (no project known – "project unclear")
    const orphans = Array.from({ length: 12 }, (_, i) => ({ kind: 'story', name: pick(['Hotfix Rechnungsdruck', 'Anfrage Fachbereich: Export', 'Technische Schuld abbauen', 'Lizenzverlängerung prüfen', 'Dashboard-Kachel ergänzen', 'Log-Rotation einstellen']) + ` #${i + 1}`, team: pick(TEAMS_ALT), assignee: weighted(PEOPLE), start: wk(addDays(TODAY, int(-20, 60))), oe: pick([4, 8, 16]), subs: [] })).map((o) => ({ ...o, due: wkBack(addDays(o.start, int(3, 12))) }));
    // support tickets (Bug, no parent): the IT-Support queue
    const BUGS = ['Login schlägt nach Passwortänderung fehl', 'PDF-Rechnung lädt nicht', 'Zählerstand wird doppelt übernommen', 'Abschlag falsch berechnet', 'Push kommt verspätet', 'Export bricht bei 10.000 Zeilen ab', 'Umlaute im Namen werden falsch angezeigt', 'SEPA-Mandat ohne Gläubiger-ID', 'Störungskarte zeigt alte Daten', 'VPN-Zugang für Monteure gesperrt', 'Rechnungsmail landet im Spam', 'App stürzt beim Start ab (Android 15)', 'Dashboard lädt sehr langsam', 'Termin-SMS an falsche Nummer', 'Benutzer kann sich nicht registrieren', 'Druckerwarteschlange hängt', 'Backup-Report fehlt', 'Zeitzone in Berichten falsch', 'Tarifrechner zeigt 0 €', 'Lieferschein ohne Positionen'];
    const AREAS = ['Kundenportal', 'Mobile App', 'SAP', 'Netzleitstelle', 'DWH', 'Arbeitsplatz-IT', 'CRM', 'Abrechnung'];
    const bugs = Array.from({ length: 120 }, (_, i) => {
      const area = pick(AREAS);
      const r = rnd();
      return { kind: 'bug', name: `${area}: ${BUGS[(i * 7) % BUGS.length]}`, team: { Kundenportal: 'Web', 'Mobile App': 'Mobile', SAP: 'Integration', Netzleitstelle: 'Netz', DWH: 'Data', 'Arbeitsplatz-IT': 'Integration', CRM: 'Web', Abrechnung: 'Integration' }[area], assignee: weighted([['dev', 30], ['colleagueB', 15], ['tester', 20], ['colleagueA', 5], [null, 30]]), oe: pick([1, 2, 2, 3, 4, 6, 8]), state: r < 0.4 ? 'done' : r < 0.62 ? 'progress' : 'todo' };
    });
    return { projects, orphans, bugs };
  }

  // ---------- Jira helpers ----------
  const j = async (u, o = {}) => {
    for (let a = 0; a < 6; a++) {
      const r = await fetch(u, { headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-Atlassian-Token': 'no-check' }, ...o });
      if (r.status === 429 || r.status >= 500) { await new Promise((x) => setTimeout(x, 1500 * (a + 1))); continue; }
      return { s: r.status, b: r.status === 204 ? null : await r.json().catch(() => null) };
    }
    return { s: 599, b: null };
  };
  const pool = async (list, n, fn) => { const out = new Array(list.length); let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k], k); } })); return out; };
  const S = window.__demo = window.__demo || {};
  S.log = S.log || [];
  S.created = S.created || { project: [], ws: [], epic: [], story: [], task: [], sub: [], bug: [], orphan: [] };
  const log = (m) => { S.log.push(`${new Date().toISOString().slice(11, 19)} ${m}`); };

  const fieldsOf = (x, type, parentKey) => {
    const f = { project: { key: P }, issuetype: { id: type }, summary: x.name.slice(0, 250) };
    if (parentKey) f.parent = { key: parentKey };
    const lab = type !== T.ws;
    if (lab) f.labels = [LABEL];
    if (x.team && TEAM[x.team]) f[F.team] = TEAM[x.team];
    if (type !== T.ws && x.start !== undefined && x.start) f[F.start] = x.start;
    if (type !== T.ws && x.due) f.duedate = x.due;
    if ([T.project, T.ws, T.epic].includes(type) && x.size) f[F.tshirt] = x.size;
    if ([T.project, T.ws].includes(type) && x.start && x.due) f[F.quarters] = quartersOf(x.start, x.due).join(', ');
    const who = x.assignee !== undefined ? x.assignee : x.owner;
    if (type !== T.project && type !== T.ws && who && U[who]) f.assignee = { accountId: U[who] };
    if ([T.story, T.task, T.sub, T.bug].includes(type) && x.oe) f.timetracking = { originalEstimate: `${x.oe}h` };
    if (type === T.project) f.description = adf(`${x.name} – Programm im Portfolio (Demo-Daten für Tests der Portfolio Cockpit App).\n\nZiel: ${x.name} bis ${x.due} abschließen. Verantwortliches Team: ${x.team}.`);
    return f;
  };
  // bulk create, 50 per call; returns keys aligned with the input (null = failed)
  async function bulk(items) {
    const keys = new Array(items.length).fill(null);
    const chunks = [];
    for (let i = 0; i < items.length; i += 50) chunks.push(i);
    await pool(chunks, 3, async (at) => {
      const part = items.slice(at, at + 50);
      const r = await j('/rest/api/3/issue/bulk', { method: 'POST', body: JSON.stringify({ issueUpdates: part.map((x) => ({ fields: x })) }) });
      const ok = r.b?.issues || [];
      const errs = new Map((r.b?.errors || []).map((e) => [e.failedElementNumber, e]));
      let k = 0;
      part.forEach((_, i) => { if (errs.has(i)) { log(`FAIL ${part[i].summary}: ${JSON.stringify(errs.get(i).elementErrors?.errors || errs.get(i)).slice(0, 200)}`); } else { keys[at + i] = ok[k++]?.key || null; } });
    });
    return keys;
  }

  // walk the workflow to a status category ('indeterminate' | 'done'), never through Cancelled
  async function moveTo(key, cat) {
    const seen = new Set();
    for (let step = 0; step < 7; step++) {
      const r = await j(`/rest/api/3/issue/${key}/transitions`);
      const ts = (r.b?.transitions || []).filter((t) => !/cancel/i.test(t.name) && !/cancel/i.test(t.to?.name || '') && !seen.has(t.to?.id));
      const here = ts.find((t) => t.to?.statusCategory?.key === cat);
      const t = here || ts.find((x) => x.to?.statusCategory?.key === 'indeterminate' && cat === 'done') || (cat === 'indeterminate' ? ts.find((x) => x.to?.statusCategory?.key === 'indeterminate') : null);
      if (!t) return false;
      seen.add(t.to.id);
      const x = await j(`/rest/api/3/issue/${key}/transitions`, { method: 'POST', body: JSON.stringify({ transition: { id: t.id } }) });
      if (x.s >= 300) { log(`transition ${key} → ${t.to.name}: ${x.s}`); return false; }
      if (here) {
        if (cat === 'indeterminate' && t.to.name !== 'In Progress' && step < 4) { continue; }
        return true;
      }
    }
    return false;
  }

  S.plan = plan;
  S.run = async ({ dry = true, only = null } = {}) => {
    const data = plan();
    const count = { projects: data.projects.length, ws: 0, epics: 0, stories: 0, subs: 0, orphans: data.orphans.length, bugs: data.bugs.length };
    for (const p of data.projects) for (const w of p.workstreams) { count.ws++; for (const e of w.epics) { count.epics++; for (const s of e.stories) { count.stories++; count.subs += s.subs.length; } } }
    S.count = count;
    if (dry) return count;
    S.done = false;
    log(`start ${JSON.stringify(count)}`);
    // 1 projects
    const pKeys = await bulk(data.projects.map((p) => fieldsOf(p, T.project)));
    data.projects.forEach((p, i) => { p.key = pKeys[i]; if (pKeys[i]) S.created.project.push(pKeys[i]); });
    log(`projects ${pKeys.filter(Boolean).length}`);
    if (only === 'projects') { S.done = true; return S.created; }
    // owners (the Project screen has no assignee on create)
    await pool(data.projects.filter((p) => p.key), 4, (p) => j(`/rest/api/3/issue/${p.key}/assignee`, { method: 'PUT', body: JSON.stringify({ accountId: U[p.owner] }) }));
    // 2 workstreams
    const wss = data.projects.flatMap((p) => p.workstreams.map((w) => ({ w, parent: p.key }))).filter((x) => x.parent);
    const wKeys = await bulk(wss.map(({ w, parent }) => fieldsOf(w, T.ws, parent)));
    wss.forEach(({ w }, i) => { w.key = wKeys[i]; if (wKeys[i]) S.created.ws.push(wKeys[i]); });
    log(`workstreams ${wKeys.filter(Boolean).length}`);
    // 3 epics
    const eps = wss.flatMap(({ w }) => w.epics.map((e) => ({ e, parent: w.key }))).filter((x) => x.parent);
    const eKeys = await bulk(eps.map(({ e, parent }) => fieldsOf(e, T.epic, parent)));
    eps.forEach(({ e }, i) => { e.key = eKeys[i]; if (eKeys[i]) S.created.epic.push(eKeys[i]); });
    log(`epics ${eKeys.filter(Boolean).length}`);
    // 4 stories / tasks
    const sts = eps.flatMap(({ e }) => e.stories.map((s) => ({ s, parent: e.key }))).filter((x) => x.parent);
    const sKeys = await bulk(sts.map(({ s, parent }) => fieldsOf(s, s.kind === 'task' ? T.task : T.story, parent)));
    sts.forEach(({ s }, i) => { s.key = sKeys[i]; if (sKeys[i]) S.created[s.kind].push(sKeys[i]); });
    log(`stories+tasks ${sKeys.filter(Boolean).length}`);
    // 5 sub-tasks
    const subs = sts.flatMap(({ s }) => s.subs.map((x) => ({ x: { ...x, start: s.start, due: s.due, team: s.team }, parent: s.key }))).filter((x) => x.parent);
    const subKeys = await bulk(subs.map(({ x, parent }) => fieldsOf(x, T.sub, parent)));
    subKeys.forEach((k) => k && S.created.sub.push(k));
    log(`sub-tasks ${subKeys.filter(Boolean).length}`);
    // 6 orphans + support bugs
    const oKeys = await bulk(data.orphans.map((o) => fieldsOf(o, T.story)));
    oKeys.forEach((k) => k && S.created.orphan.push(k));
    const bKeys = await bulk(data.bugs.map((b) => fieldsOf(b, T.bug)));
    data.bugs.forEach((b, i) => { b.key = bKeys[i]; if (bKeys[i]) S.created.bug.push(bKeys[i]); });
    log(`orphans ${oKeys.filter(Boolean).length} · bugs ${bKeys.filter(Boolean).length}`);
    S.data = data;
    // 7 progress: past work done (mostly), current work in progress, a few overdue left open
    const all = sts.map(({ s }) => s).filter((s) => s.key);
    const toDone = all.filter((s) => s.due && s.due < addDays(TODAY, -10) && chance(0.85));
    const toProg = all.filter((s) => !toDone.includes(s) && s.start && s.start <= TODAY && (!s.due || s.due >= addDays(TODAY, -10)) && chance(0.6));
    const bugsDone = data.bugs.filter((b) => b.key && b.state === 'done'), bugsProg = data.bugs.filter((b) => b.key && b.state === 'progress');
    let n = 0;
    await pool([...toDone.map((s) => [s.key, 'done']), ...bugsDone.map((b) => [b.key, 'done']), ...toProg.map((s) => [s.key, 'indeterminate']), ...bugsProg.map((b) => [b.key, 'indeterminate'])], 5, async ([k, c]) => { await moveTo(k, c); if (++n % 50 === 0) log(`status ${n}`); });
    // projects/epics that are running
    const runP = data.projects.filter((p) => p.key && p.start <= TODAY);
    const runE = eps.map(({ e }) => e).filter((e) => e.key && e.start <= TODAY);
    await pool([...runP.map((p) => p.key), ...runE.map((e) => e.key)], 5, (k) => moveTo(k, 'indeterminate'));
    const doneP = data.projects.filter((p) => p.key && p.due < TODAY);
    await pool(doneP.map((p) => p.key), 3, (k) => moveTo(k, 'done'));
    log(`status done: ${toDone.length + bugsDone.length} done, ${toProg.length + bugsProg.length} in progress`);
    // 8 booked time: the signed-in account (Dev Team) books its own work – done/in-progress stories and bugs
    const mine = [...toDone, ...toProg].filter((s) => s.assignee === 'dev' && s.oe);
    const wl = [];
    for (const s of mine) {
      const total = Math.round(s.oe * (toDone.includes(s) ? 0.7 + rnd() * 0.7 : 0.2 + rnd() * 0.5) * 4) / 4;
      const days = Math.max(1, Math.min(5, Math.round(total / 6)));
      for (let d = 0; d < days; d++) {
        const when = wk(addDays(s.start || TODAY, Math.min(Math.max(0, diff(s.start || TODAY, TODAY) - 1), d * 2)));
        if (when > TODAY) continue;
        wl.push([s.key, when, Math.max(0.5, Math.round((total / days) * 4) / 4)]);
      }
    }
    for (const b of [...bugsDone, ...bugsProg].filter((b) => b.assignee === 'dev')) wl.push([b.key, wk(addDays(TODAY, -int(1, 30))), pick([0.5, 1, 1.5, 2, 3])]);
    await pool(wl, 4, ([k, day, h]) => j(`/rest/api/3/issue/${k}/worklog?notifyUsers=false&adjustEstimate=auto`, { method: 'POST', body: JSON.stringify({ started: `${day}T09:00:00.000+0000`, timeSpentSeconds: Math.round(h * 3600), comment: adf('Demo-Buchung (pc-demo)') }) }));
    log(`worklogs ${wl.length}`);
    // 9 dependencies (Blocks): mostly inside an epic in order, some across projects, some in conflict (starts before the blocker ends)
    const links = [];
    for (const { e } of eps) {
      const ss = e.stories.filter((s) => s.key);
      for (let i = 1; i < ss.length; i++) if (chance(0.18)) links.push([ss[i - 1].key, ss[i].key]);
    }
    for (let i = 0; i < 25; i++) { const a = pick(all), b = pick(all); if (a !== b && a.key && b.key) links.push([a.key, b.key]); }
    await pool(links, 4, ([a, b]) => j('/rest/api/3/issueLink', { method: 'POST', body: JSON.stringify({ type: { name: 'Blocks' }, inwardIssue: { key: a }, outwardIssue: { key: b } }) })); // Jira REST: inwardIssue gets the outward verb – "a blocks b"
    S.links = links;
    log(`links ${links.length}`);
    S.done = true;
    log('done');
    return S.created;
  };
})();
