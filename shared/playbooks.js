// Support playbooks: recurring support topics (shared/insights.js supportTopics) turned into a help article and a
// standard reply. Pure module, used by the server (src/lib/playbooks.js), the AI fallback (shared/aiAssist.js,
// feature "playbookDraft"), the UI and the mock.
//
//  - playbookTemplate(topic, { tickets, lang }) – the rule-based draft: symptoms from the topic's ticket summaries,
//    steps as clearly marked placeholders, a friendly standard reply with the topic's real numbers. No AI involved.
//  - validPlaybook(input, prev) – what may be stored: capped strings and lists, known fields only.
//  - canReadPlaybooks / canEditPlaybooks – the existing rights: the Support tab to read; dispatching tickets
//    (or maintaining capacities) to change them; Jira admins always.
// Nothing here posts to Jira: a playbook lives in the app's storage and the reply is only ever copied by a person.

export const PLAYBOOK_LIMITS = Object.freeze({ max: 200, title: 120, topic: 120, item: 300, list: 10, reply: 1500, keys: 8 });
const L = PLAYBOOK_LIMITS;
const T = (lang, de, en) => (lang === 'en' ? en : de);
const KEY_RE = /^[A-Z][A-Z0-9_]{0,19}-\d{1,9}$/;
const ID_RE = /^pb-[a-z0-9]{6,24}$/;
const TOPIC_RE = /^[A-Za-z0-9:_. äöüÄÖÜß-]{1,120}$/;

export const canReadPlaybooks = (roles) => !!(roles?.admin || (roles?.rights || []).includes('support'));
export const canEditPlaybooks = (roles) => !!(roles?.admin || (canReadPlaybooks(roles) && (roles?.dispatch || roles?.editCapacity)));

const oneLine = (v, n) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const block = (v, n) => (typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, n) : '');
const list = (v) => (Array.isArray(v) ? v : []).map((x) => oneLine(x, L.item)).filter(Boolean).slice(0, L.list);

export const newPlaybookId = (rnd = Math.random) => `pb-${Math.floor(rnd() * 36 ** 8).toString(36).padStart(8, '0')}`;

// What a stored playbook looks like. `prev` (the stored version) keeps id and creation; who/when is set by the server.
export function validPlaybook(input, prev = null) {
  const x = input && typeof input === 'object' ? input : {};
  const title = oneLine(x.title, L.title);
  if (!title) throw Object.assign(new Error('title'), { code: 'INVALID' });
  const id = prev?.id || (typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : null);
  return {
    id, title,
    topic: typeof x.topic === 'string' && TOPIC_RE.test(x.topic.trim()) ? x.topic.trim() : null,
    topicName: oneLine(x.topicName, L.topic) || null,
    symptoms: list(x.symptoms), steps: list(x.steps), reply: block(x.reply, L.reply),
    keys: (Array.isArray(x.keys) ? x.keys : []).filter((k) => typeof k === 'string' && KEY_RE.test(k)).slice(0, L.keys),
    source: x.source === 'ai' ? 'ai' : 'rule',
    createdAt: prev?.createdAt || (typeof x.createdAt === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(x.createdAt) ? x.createdAt.slice(0, 30) : null),
  };
}

// The topic's tickets in their own words: the most frequent distinct summaries (normalised), newest first on ties.
export function symptomsOf(topic, tickets = [], n = 5) {
  const ids = new Set((topic?.ids || []).map(String));
  const keys = new Set(topic?.exampleKeys || []);
  const mine = (tickets || []).filter((t) => t && (ids.has(String(t.id)) || keys.has(t.key)) && t.summary);
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9äöüß ]+/gi, ' ').replace(/\s+/g, ' ').trim();
  const by = new Map();
  for (const t of mine) {
    const k = norm(t.summary);
    if (!k) continue;
    const e = by.get(k) || by.set(k, { text: oneLine(t.summary, 140), n: 0, at: '' }).get(k);
    e.n++; if (String(t.created || '') > e.at) e.at = String(t.created || '');
  }
  return [...by.values()].sort((a, b) => b.n - a.n || b.at.localeCompare(a.at) || a.text.localeCompare(b.text)).slice(0, n).map((x) => (x.n > 1 ? `${x.text} (${x.n}×)` : x.text));
}

const hours = (h, lang) => {
  const v = Number(h) || 0;
  const s = (Math.abs(v) >= 10 ? Math.round(v) : Math.round(v * 10) / 10).toString();
  return `${lang === 'en' ? s : s.replace('.', ',')} h`;
};
const trendWord = (t, lang) => ({ rising: T(lang, 'steigend', 'rising'), falling: T(lang, 'fallend', 'falling'), stable: T(lang, 'stabil', 'stable'), new: T(lang, 'neu', 'new') }[t] || T(lang, 'stabil', 'stable'));

// The rule-based draft. topic: a supportTopics() topic (name, count, spentTotal, spentMedian, trend, exampleKeys, ids).
export function playbookTemplate(topic, { tickets = [], lang = 'de' } = {}) {
  const name = oneLine(topic?.name, L.topic) || T(lang, 'Wiederkehrendes Thema', 'Recurring topic');
  const count = Math.max(0, Math.round(+topic?.count || 0));
  const symptoms = symptomsOf(topic, tickets);
  if (!symptoms.length) symptoms.push(T(lang, `Meldungen zu „${name}“`, `Reports about "${name}"`));
  const steps = [
    T(lang, `Prüfen, ob die Meldung zu „${name}“ passt (Symptome oben vergleichen).`, `Check that the report matches "${name}" (compare the symptoms above).`),
    T(lang, '[Erste Prüfung ergänzen – z. B. Zugang, Version, Zeitpunkt]', '[Add the first check – e.g. access, version, time]'),
    T(lang, '[Lösungsschritt ergänzen – was hat in den bisherigen Tickets geholfen?]', '[Add the fix – what helped in the earlier tickets?]'),
    T(lang, 'Standardantwort senden und das Ticket mit diesem Playbook verknüpfen.', 'Send the standard reply and note this playbook on the ticket.'),
    T(lang, '[Wann eskalieren und an wen?]', '[When to escalate, and to whom?]'),
  ];
  // The reply goes to the customer: no internal figures (ticket counts, hours) and no internal request-type names.
  const plain = String(name).replace(/\s*\([^)]*\)\s*$/, '') || name;
  const reply = T(lang,
    `Hallo,\n\ndanke für deine Meldung. Das Thema „${plain}“ kennen wir, und es gibt einen bewährten Weg.\n\nBitte probiere zunächst: [kurzer Schritt für den Kunden].\n\nWenn das nicht hilft, antworte einfach auf diese Nachricht – wir kümmern uns darum.\n\nViele Grüße\n[Name]`,
    `Hello,\n\nthank you for your report. We know the topic "${plain}", and there is a proven way to solve it.\n\nPlease try this first: [short step for the customer].\n\nIf that does not help, just reply to this message – we will take care of it.\n\nKind regards\n[Name]`);
  return {
    title: T(lang, `Playbook: ${name}`, `Playbook: ${name}`).slice(0, L.title),
    topic: typeof topic?.id === 'string' ? topic.id.slice(0, 120) : null, topicName: name,
    symptoms, steps, reply, keys: (topic?.exampleKeys || []).filter((k) => KEY_RE.test(k)).slice(0, L.keys), source: 'rule',
    why: T(lang, `Vorlage der App: Symptome aus ${count} Ticket-Titeln, Tendenz ${trendWord(topic?.trend, lang)}, zusammen ${hours(topic?.spentTotal, lang)}. Schritte in [Klammern] bitte ergänzen.`,
      `App template: symptoms from ${count} ticket summaries, trend ${trendWord(topic?.trend, lang)}, ${hours(topic?.spentTotal, lang)} in total. Please fill in the steps in [brackets].`),
  };
}

// Plain text of a playbook (for "Kopieren" of the whole article).
export function playbookText(pb, lang = 'de') {
  const lines = [pb.title, ''];
  if (pb.symptoms?.length) lines.push(T(lang, 'Symptome', 'Symptoms'), ...pb.symptoms.map((s) => `• ${s}`), '');
  if (pb.steps?.length) lines.push(T(lang, 'Schritte', 'Steps'), ...pb.steps.map((s, i) => `${i + 1}. ${s}`), '');
  if (pb.reply) lines.push(T(lang, 'Standardantwort', 'Standard reply'), pb.reply);
  return lines.join('\n').trim();
}
