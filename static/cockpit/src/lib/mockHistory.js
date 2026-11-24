// Local mock mode: 'insights.history' and 'insights.comments' with realistic, deterministic demo data – the same
// teams, people and project keys as lib/mock.js. Done stories of the last 12 months in four recurring project
// families (portal, interfaces, mobile app, reporting) and resolved support tickets of the last 26 weeks with
// recurring topics (password reset, export error, VPN, access for new colleagues, printer) plus one-offs.
// No imports, so it also runs under node:test. Shapes: see src/lib/history.js.
const DAY = 864e5;
const isoOf = (i) => new Date(i * DAY).toISOString().slice(0, 10);
const dow = (i) => (((i + 4) % 7) + 7) % 7;
const weekdayBack = (i) => { let d = i; while (dow(d) === 0 || dow(d) === 6) d -= 1; return d; };

function rng(seed) { // mulberry32: the same demo on every reload
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const TEAM = { 't-web': 'Web', 't-ux': 'UX', 't-int': 'Integration', 't-mob': 'Mobile', 't-data': 'Data', 't-netz': 'Netz' };
const team = (id) => ({ id, name: TEAM[id] });
const people = (ids) => ids.map((n) => `u${n}`);
// family: project keys, team, people, typical overrun (time spent ÷ estimate), epics and story templates [summary, estimate h]
const FAMILIES = [
  { keys: ['KPR', 'CRM'], team: 't-web', who: people([5, 11, 1]), over: 1.2, components: ['Portal'], epics: ['Self-Service', 'Rechnungen', 'Anmeldung'],
    stories: [['Login-Seite responsive umbauen', 16], ['Passwort-Reset per E-Mail-Link', 12], ['Rechnungsübersicht im Kundenportal', 24], ['Export der Rechnungen als PDF', 16],
      ['Kontaktformular mit Spam-Schutz', 8], ['Benutzerprofil bearbeiten', 12], ['Zwei-Faktor-Anmeldung einführen', 24]] },
  { keys: ['ERP', 'BIL'], team: 't-int', who: people([2, 8, 14]), over: 1.45, components: ['Schnittstellen'], epics: ['Auftragsschnittstelle', 'Stammdaten', 'Abrechnung'],
    stories: [['REST-Schnittstelle Aufträge an ERP', 32], ['Schnittstelle Kundenstammdaten SAP', 24], ['Mapping Artikelstamm', 16], ['Fehlerhandling Schnittstelle Rechnungen', 12],
      ['CSV-Import Preislisten', 12], ['Abrechnungslauf an Billing übergeben', 24]] },
  { keys: ['MOB'], team: 't-mob', who: people([3, 9, 15]), over: 1.1, components: ['App'], epics: ['App 2.0', 'Offline'],
    stories: [['Push-Benachrichtigungen iOS und Android', 20], ['Offline-Modus Auftragsliste', 32], ['Login mit Face ID', 12], ['App-Store-Release vorbereiten', 8], ['Absturz beim Foto-Upload beheben', 6]] },
  { keys: ['DAT', 'DSG'], team: 't-data', who: people([4, 10, 16]), over: 1.25, components: ['Reporting'], epics: ['Dashboards', 'Datenstrecken', 'Löschkonzept'],
    stories: [['Dashboard Umsatz je Region', 16], ['ETL-Strecke CRM in den Data Lake', 32], ['Datenqualitäts-Checks Kundenstamm', 12], ['Report Auftragseingang monatlich', 8],
      ['Löschlauf personenbezogene Daten', 20]] },
];
const VARIANTS = ['', ' (Geschäftskunden)', ' – Phase 2'];

// Support topics: [summary variants, request type, component, label, hours per ticket, how many, recent boost]
const TOPICS = [
  { s: ['Passwort zurücksetzen', 'Passwort vergessen – bitte zurücksetzen', 'Kennwort abgelaufen, Anmeldung nicht möglich', 'Passwort für Portal zurücksetzen'], rt: 'Zugang & Konten', h: [0.25, 0.75], n: 26, recent: 0.35 },
  { s: ['Export nach Excel schlägt fehl', 'Fehler beim CSV-Export der Aufträge', 'Export bricht mit Fehlermeldung ab', 'Export der Rechnungen liefert leere Datei'], rt: 'Technisches Problem', comp: 'Portal', h: [1, 2.5], n: 16, recent: 0.15 },
  { s: ['VPN-Verbindung bricht ständig ab', 'VPN Zugang funktioniert nicht', 'Keine VPN-Verbindung aus dem Homeoffice', 'VPN Client meldet Zertifikatsfehler'], rt: 'Netzwerk & VPN', h: [0.5, 1.5], n: 14, recent: 0.2 },
  { s: ['Zugang für neuen Kollegen einrichten', 'Neuer Mitarbeiter braucht Zugang zu Jira', 'Zugang für Werkstudentin anlegen'], rt: 'Zugang & Konten', h: [0.5, 1], n: 10, recent: 0.2 },
  { s: ['Drucker im 2. OG druckt nicht', 'Drucker zeigt Papierstau an'], rt: 'Arbeitsplatz', h: [0.25, 0.5], n: 5, recent: 0.1 },
];
const ONE_OFFS = ['Monitor flackert', 'Lizenz für Visio benötigt', 'Teams-Kalender synchronisiert nicht', 'Webseite lädt langsam', 'Rechte für SharePoint-Ordner', 'Tastatur defekt',
  'Bestellung neues Headset', 'Frage zur Urlaubsbuchung', 'Outlook-Signatur anpassen', 'Datenbank-Backup prüfen', 'Zertifikat Webserver läuft ab', 'Telefon umleiten',
  'Fehler im Lieferschein-Druck', 'Software-Installation Python', 'Netzlaufwerk nicht erreichbar', 'Speicherplatz Postfach voll'];
const SUP_TEAMS = ['t-web', 't-ux', 't-int', 't-mob'];
const SUP_PEOPLE = { 't-web': people([5, 11]), 't-ux': people([6, 12]), 't-int': people([2, 8]), 't-mob': people([3, 9]) };

export function mockHistory({ today = Math.floor(Date.now() / DAY), months = 12, supportMonths = 6 } = {}) {
  const rnd = rng(4711);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const half = (x) => Math.round(x * 2) / 2;
  const stories = [];
  let n = 5000;
  const span = Math.round(months * 30.4);
  for (const f of FAMILIES) {
    f.stories.forEach(([summary, oe0], si) => {
      const copies = 2 + ((si + f.keys.length) % 2); // 2–3 similar stories per template
      for (let c = 0; c < copies; c++) {
        const pk = f.keys[c % f.keys.length];
        const oe = half(oe0 * (0.75 + rnd() * 0.5));
        // spent: the family's typical overrun with noise; now and then a story far off (estimate missed)
        const factor = rnd() < 0.08 ? f.over * 2.2 : f.over * (0.8 + rnd() * 0.4);
        const ts = half(Math.max(0.5, oe * factor));
        const resolved = weekdayBack(today - 3 - Math.floor(rnd() * (span - 10)));
        const dur = 3 + Math.floor(rnd() * 18);
        const start = rnd() < 0.85 ? weekdayBack(resolved - Math.round(dur * 1.4)) : null;
        const created = (start ?? resolved - dur) - 5 - Math.floor(rnd() * 20);
        const epic = f.epics[si % f.epics.length];
        const id = String(++n);
        stories.push({
          id, key: `${pk}-${200 + (n % 700)}`, summary: summary + VARIANTS[c % VARIANTS.length], type: 'Story', projectKey: pk,
          components: rnd() < 0.7 ? [...f.components] : [], labels: rnd() < 0.3 ? ['tech-debt'] : [], team: team(f.team), assignee: pick(f.who),
          oe: rnd() < 0.06 ? 0 : oe, ts: rnd() < 0.04 ? 0 : ts, created: isoOf(created), start: start != null ? isoOf(start) : null, resolved: isoOf(resolved),
          parentId: String(4000 + FAMILIES.indexOf(f) * 10 + (si % f.epics.length)), parentKey: `${pk}-${10 + (si % f.epics.length)}`, parentSummary: epic,
          statusCat: 'done', commentCount: Math.floor(rnd() * 7),
        });
      }
    });
  }
  stories.sort((a, b) => b.resolved.localeCompare(a.resolved) || a.key.localeCompare(b.key));

  const support = [];
  const supSpan = Math.round(supportMonths * 30.4);
  const since = today - supSpan;
  let k = 0;
  const ticket = (summary, rt, comp, hours, created) => {
    const tm = pick(SUP_TEAMS);
    const who = rnd() < 0.9 ? pick(SUP_PEOPLE[tm]) : null;
    const resolved = Math.min(today - 1, created + (rnd() < 0.8 ? Math.floor(rnd() * 3) : 3 + Math.floor(rnd() * 10)));
    const spentH = half(hours) || 0.25;
    // one or two worklogs between creation and resolution, adding up to the time spent
    const parts = spentH >= 1 && rnd() < 0.5 ? [half(spentH / 2) || 0.25] : [];
    if (parts.length) parts.push(spentH - parts[0]);
    else parts.push(spentH);
    const worklogs = parts.map((h, i) => ({ d: isoOf(Math.min(resolved, created + i * Math.max(1, resolved - created))), h, a: who }));
    support.push({
      id: String(70000 + k), key: `SUP-${1000 + k}`, summary, requestType: rt, components: comp ? [comp] : [], labels: ['support'], team: team(tm), assignee: who,
      spentH, created: isoOf(created), resolved: isoOf(resolved), statusCat: 'done', worklogs,
    });
    k += 1;
  };
  for (const t of TOPICS) {
    for (let i = 0; i < t.n; i++) {
      // a share of the tickets in the last four weeks (password resets are rising)
      const created = rnd() < t.recent ? today - 1 - Math.floor(rnd() * 27) : since + Math.floor(rnd() * (supSpan - 28));
      ticket(t.s[i % t.s.length], t.rt, t.comp || null, t.h[0] + rnd() * (t.h[1] - t.h[0]), created);
    }
  }
  ONE_OFFS.forEach((s) => ticket(s, pick(['Technisches Problem', 'Arbeitsplatz', 'Sonstiges']), null, 0.25 + rnd() * 2, since + Math.floor(rnd() * (supSpan - 2))));
  support.sort((a, b) => b.resolved.localeCompare(a.resolved) || a.key.localeCompare(b.key));
  return {
    asOf: isoOf(today), months, supportMonths, since: isoOf(today - span), supportSince: isoOf(since),
    stories, support, truncated: { stories: false, support: false }, personLevel: true,
  };
}

// Comments of a few work items: counts always, the last three texts only when texts may be shared.
const COMMENT_TEXTS = [
  'Achtung: Die Testumgebung braucht vorher die aktuellen Stammdaten, sonst schlägt der Import fehl.',
  'Haben wir wie bei der letzten Schnittstelle gelöst – Mapping-Tabelle im Wiki, Seite „Artikelstamm“.',
  'Abnahme durch den Fachbereich hat zwei Runden gebraucht, früh einen Termin blocken.',
  'Performance war erst mit Paging ok (500 Datensätze pro Seite).',
  'Für iOS muss das Zertifikat jedes Jahr erneuert werden, Erinnerung gesetzt.',
  'PDF-Generierung über den bestehenden Service, nicht neu bauen.',
];
export function mockComments(ids = [], { texts = false } = {}) {
  const out = {};
  for (const id of (ids || []).slice(0, 20)) {
    const r = rng(Number(id) || 1);
    const count = Math.floor(r() * 6);
    const last = texts ? Array.from({ length: Math.min(3, count) }, (_, i) => ({ created: isoOf(Math.floor(Date.now() / DAY) - 30 - i * 3), text: COMMENT_TEXTS[Math.floor(r() * COMMENT_TEXTS.length)] })) : [];
    out[id] = { count, last };
  }
  return out;
}
