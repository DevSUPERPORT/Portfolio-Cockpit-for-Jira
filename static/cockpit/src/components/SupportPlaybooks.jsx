// Support › Playbooks: the topics that keep coming back (shared/insights.js supportTopics over the resolved tickets of
// the history plus the current ones), and per topic a playbook – a short help article with a standard reply.
//  - "Playbook erstellen" opens the app's template draft (symptoms from the ticket summaries, steps as [placeholders],
//    a reply with the topic's real numbers) – or, when an admin switched it on, an AI draft (playbookDraft).
//  - Saved in app storage (playbooks.save / playbooks.delete), each save and delete with its own undo.
//  - "Antwort kopieren" copies the standard reply. Nothing is ever posted to a Jira ticket.
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../lib/motion.js';
import { supportTopics } from '@shared/insights.js';
import { playbookTemplate, playbookText } from '@shared/playbooks.js';
import { useApp, errText } from '../state.jsx';
import { tr, fmt, getLang } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { call, openIssue } from '../lib/api.js';
import { Empty, useTip, infoCard, stagger } from './ui.jsx';
import AiAssist from './AiAssist.jsx';
import { useInsightsHistory } from '../lib/insightsHistory.js';
import './Support.css';

const DAY = 864e5;
const TREND = { rising: ['chip-bad', 'steigend', 'rising'], falling: ['chip-ok', 'fallend', 'falling'], stable: ['chip-outline', 'stabil', 'stable'], new: ['chip-info', 'neu', 'new'] };
const lines = (s) => String(s || '').split('\n').map((x) => x.trim()).filter(Boolean);

// 12 weeks of tickets per topic as a tiny line – transform/opacity only for motion.
function Spark({ counts, label }) {
  const max = Math.max(1, ...counts);
  const W = 84, H = 22;
  const pts = counts.map((v, i) => `${(i / Math.max(1, counts.length - 1)) * W},${H - 2 - (v / max) * (H - 4)}`).join(' ');
  return (
    <motion.svg className="pb-spark" width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} {...enter(0, { y: 0, d: 'gentle' })}>
      <polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
    </motion.svg>
  );
}

async function copyText(text, toast, what) {
  try { await navigator.clipboard.writeText(text); toast({ text: what, icon: 'check' }); }
  catch { toast({ text: tr('Kopieren nicht möglich – Text bitte markieren.', 'Copy not possible – please select the text.'), error: true }); }
}

export default function SupportPlaybooks({ tickets }) {
  const { ds, done, toast } = useApp();
  const tip = useTip();
  const hist = useInsightsHistory(true);
  const lang = getLang();
  const [pbs, setPbs] = useState({ state: 'loading', items: [], canEdit: false });
  const [draft, setDraft] = useState(null); // { ...playbook fields as text, why, source }
  const [busy, setBusy] = useState(false);
  const editorRef = useRef(null);
  const draftKey = draft ? draft.id || draft.topic || 'new' : null;
  // the editor opens above the lists: bring it into view (the page scrolls, the card itself only fades in)
  useEffect(() => { if (draftKey) editorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [draftKey]);

  useEffect(() => {
    let live = true;
    call('playbooks.list').then((r) => live && setPbs({ state: 'ready', items: r.items || [], canEdit: !!r.canEdit }))
      .catch((e) => live && setPbs({ state: 'error', items: [], canEdit: false, e }));
    return () => { live = false; };
  }, []);

  const all = useMemo(() => {
    const seen = new Set(), out = [];
    for (const t of [...(hist.data?.support || []), ...(tickets || [])]) { const k = t?.id ?? t?.key; if (k != null && !seen.has(k)) { seen.add(k); out.push(t); } }
    return out;
  }, [hist.data, tickets]);
  const st = useMemo(() => supportTopics(all, { minCount: 3, lang, today: ds?.today || null }), [all, lang, ds?.today]);
  const createdOf = useMemo(() => new Map(all.map((t) => [String(t.id), t.created])), [all]);
  const weekly = (topic) => {
    const now = Date.parse(`${ds?.today || new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const c = new Array(12).fill(0);
    for (const id of topic.ids || []) { const d = Date.parse(createdOf.get(String(id)) || ''); if (!Number.isFinite(d)) continue; const w = 11 - Math.floor((now - d) / (7 * DAY)); if (w >= 0 && w < 12) c[w]++; }
    return c;
  };
  const byTopic = useMemo(() => new Map(pbs.items.filter((p) => p.topic).map((p) => [p.topic, p])), [pbs.items]);

  const open = (topic) => {
    const t = playbookTemplate(topic, { tickets: all, lang });
    setDraft({ id: null, title: t.title, topic: t.topic, topicName: t.topicName, symptoms: t.symptoms.join('\n'), steps: t.steps.join('\n'), reply: t.reply, keys: t.keys, source: 'rule', why: t.why, topicRef: topic });
  };
  const edit = (pb) => setDraft({ ...pb, symptoms: pb.symptoms.join('\n'), steps: pb.steps.join('\n'), why: null, topicRef: st.topics.find((x) => x.id === pb.topic) || null });
  const asPlaybook = (d) => ({ id: d.id || undefined, title: d.title, topic: d.topic, topicName: d.topicName, symptoms: lines(d.symptoms), steps: lines(d.steps), reply: d.reply, keys: d.keys || [], source: d.source, createdAt: d.createdAt });

  const replaceLocal = (pb, goneId) => setPbs((s) => ({ ...s, items: [pb, ...s.items.filter((x) => x.id !== pb?.id && x.id !== goneId)].filter(Boolean) }));
  const removeLocal = (id) => setPbs((s) => ({ ...s, items: s.items.filter((x) => x.id !== id) }));
  const save = async () => {
    if (!draft?.title?.trim()) return;
    setBusy(true);
    try {
      const r = await call('playbooks.save', { playbook: asPlaybook(draft) });
      replaceLocal(r.playbook);
      setDraft(null);
      const prev = r.previous;
      done(prev ? tr(`Playbook „${r.playbook.title}“ aktualisiert`, `Playbook "${r.playbook.title}" updated`) : tr(`Playbook „${r.playbook.title}“ gespeichert`, `Playbook "${r.playbook.title}" saved`), 'check',
        prev ? tr('Playbook geändert', 'playbook changed') : tr('Playbook angelegt', 'playbook created'),
        async () => {
          if (prev) { const u = await call('playbooks.save', { playbook: prev, restore: true }); replaceLocal(u.playbook); }
          else { await call('playbooks.delete', { id: r.playbook.id }); removeLocal(r.playbook.id); }
        }, [`playbook:${r.playbook.id}`]);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };
  const remove = async (pb) => {
    try {
      const r = await call('playbooks.delete', { id: pb.id });
      removeLocal(pb.id);
      done(tr(`Playbook „${pb.title}“ gelöscht`, `Playbook "${pb.title}" deleted`), 'trash', tr('Playbook gelöscht', 'playbook deleted'),
        async () => { const u = await call('playbooks.save', { playbook: r.deleted, restore: true }); replaceLocal(u.playbook); }, [`playbook:${pb.id}`]);
    } catch (e) { toast({ text: errText(e), error: true }); }
  };

  const topics = st.topics.slice(0, 20);
  const canEdit = pbs.canEdit;
  return (
    <div className="stack" style={{ gap: 20 }}>
      {draft && (
        <motion.section ref={editorRef} key={draft.id || draft.topic || 'new'} className="card pb-editor" {...enter(0, { y: 10, d: 'gentle' })} aria-label={tr('Playbook bearbeiten', 'Edit playbook')}>
          <div className="sp-head">
            <h2 className="card-title"><Icon name="edit" />{draft.id ? tr('Playbook bearbeiten', 'Edit playbook') : tr('Neues Playbook', 'New playbook')}</h2>
            <span className={`chip ${draft.source === 'ai' ? 'chip-accent' : 'chip-outline'}`}>{draft.source === 'ai' ? tr('KI-Entwurf', 'AI draft') : tr('Vorlage der App', 'App template')}</span>
            <span className="sp-head-end">
              {canEdit && draft.topicRef && (
                <AiAssist feature="playbookDraft" compact label={tr('KI-Entwurf', 'AI draft')} title={tr('Entwurf für dieses Thema', 'Draft for this topic')}
                  build={() => ({ topic: { id: draft.topicRef.id, name: draft.topicRef.name, count: draft.topicRef.count, spentTotal: draft.topicRef.spentTotal, spentMedian: draft.topicRef.spentMedian, trend: draft.topicRef.trend, open: draft.topicRef.open },
                    examples: all.filter((x) => (draft.topicRef.ids || []).map(String).includes(String(x.id))).slice(0, 8).map((x) => ({ key: x.key, summary: x.summary, created: String(x.created || '').slice(0, 10) })) })}
                  render={(r) => r.draft ? <div className="pb-ai-preview"><b>{r.draft.title}</b><span className="faint">{tr(`${r.draft.symptoms.length} Symptome · ${r.draft.steps.length} Schritte · Antwort mit ${r.draft.reply.split(/\s+/).length} Wörtern`, `${r.draft.symptoms.length} symptoms · ${r.draft.steps.length} steps · reply with ${r.draft.reply.split(/\s+/).length} words`)}</span></div> : null}
                  canApply={(r) => !!r.draft} applyLabel={tr('In den Entwurf übernehmen', 'Use as draft')}
                  onApply={(r) => setDraft((d) => ({ ...d, title: r.draft.title, symptoms: r.draft.symptoms.join('\n'), steps: r.draft.steps.join('\n'), reply: r.draft.reply, source: r.source === 'ai' ? 'ai' : 'rule', why: r.reasoning || d.why }))} />
              )}
              <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => setDraft(null)} aria-label={tr('Entwurf schließen', 'Close draft')}><Icon name="x" size={14} /></button>
            </span>
          </div>
          <fieldset className="pb-form" disabled={!canEdit || busy}>
            {draft.why && <p className="pb-why"><Icon name="info" size={13} />{draft.why}</p>}
            <label className="pb-field"><span className="label">{tr('Titel', 'Title')}</span><input className="input" value={draft.title} maxLength={120} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></label>
            <div className="pb-cols">
              <label className="pb-field"><span className="label">{tr('Symptome – eins pro Zeile', 'Symptoms – one per line')}</span><textarea className="input pb-area" rows={5} value={draft.symptoms} onChange={(e) => setDraft({ ...draft, symptoms: e.target.value })} /></label>
              <label className="pb-field"><span className="label">{tr('Schritte – einer pro Zeile, [Klammern] ergänzen', 'Steps – one per line, fill in [brackets]')}</span><textarea className="input pb-area" rows={5} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} /></label>
            </div>
            <label className="pb-field"><span className="label">{tr('Standardantwort', 'Standard reply')}</span><textarea className="input pb-area" rows={8} maxLength={1500} value={draft.reply} onChange={(e) => setDraft({ ...draft, reply: e.target.value })} /></label>
          </fieldset>
          <div className="pb-foot">
            <span className="faint">{tr('Wird nur in der App gespeichert – nichts geht an ein Ticket.', 'Stored in the app only – nothing goes to a ticket.')}</span>
            <span className="row" style={{ gap: 8 }}>
              <button type="button" className="btn btn-sm" onClick={() => copyText(draft.reply, toast, tr('Antwort kopiert', 'Reply copied'))}><Icon name="check" size={13} />{tr('Antwort kopieren', 'Copy reply')}</button>
              {canEdit && <button type="button" className="btn btn-sm btn-primary" disabled={busy || !draft.title.trim()} onClick={save}><Icon name="bookmark" size={13} />{busy ? tr('Speichere …', 'Saving …') : tr('Speichern', 'Save')}</button>}
            </span>
          </div>
        </motion.section>
      )}

      <section className="card">
        <div className="sp-head">
          <h2 className="card-title"><Icon name="waves" />{tr('Wiederkehrende Themen', 'Recurring topics')}</h2>
          <span className="sp-info" tabIndex={0} aria-label={tr('So entstehen die Themen', 'How the topics are found')} {...tip(infoCard({ title: tr('Wiederkehrende Themen', 'Recurring topics'),
            text: tr('Tickets werden nach ihrem wichtigsten wiederkehrenden Wort im Titel gruppiert (sonst nach Anfragetyp, Komponente oder Label). Ab 3 Tickets und 2 h Aufwand lohnt ein Playbook. Tendenz: letzte 4 Wochen gegen den Durchschnitt davor.', 'Tickets are grouped by the most important recurring word in their summary (otherwise request type, component or label). From 3 tickets and 2 h of effort a playbook pays off. Trend: last 4 weeks against the average before.'),
            calc: st.explain, inputs: [[tr('Tickets', 'Tickets'), String(st.tickets)], [tr('Verlauf', 'History'), hist.state === 'ready' ? tr(`${(hist.data?.support || []).length} gelöste Tickets`, `${(hist.data?.support || []).length} resolved tickets`) : hist.state === 'loading' ? tr('wird geladen …', 'loading …') : tr('nur aktuelle Tickets', 'current tickets only')]] }))}><Icon name="info" size={14} /></span>
          <span className="sp-head-end card-sub">{st.explain}</span>
        </div>
        {hist.state === 'loading' && <div className="pb-loading faint" role="status"><Icon name="refresh" size={13} />{tr('Lade gelöste Tickets der letzten Monate …', 'Loading resolved tickets of the last months …')}</div>}
        {!topics.length ? (
          <Empty icon="headset" title={tr('Noch keine wiederkehrenden Themen', 'No recurring topics yet')}>{tr('Sobald mindestens drei Tickets dasselbe Thema haben, erscheint es hier.', 'As soon as at least three tickets share a topic, it appears here.')}</Empty>
        ) : (
          <ul className="pb-topics">
            {topics.map((t, i) => {
              const has = byTopic.get(t.id);
              const [chip, de, en] = TREND[t.trend] || TREND.stable;
              const counts = weekly(t);
              return (
                <motion.li key={t.id} className={`pb-topic ${draft?.topic === t.id ? 'on' : ''}`} {...stagger(i)}>
                  <div className="pb-topic-main">
                    <b>{t.name}</b>
                    <span className="faint">{tr(`${t.count} Tickets · ${fmt.h(t.spentTotal)} · Median ${fmt.h(t.spentMedian, 1)}${t.open ? ` · ${t.open} offen` : ''}`, `${t.count} tickets · ${fmt.h(t.spentTotal)} · median ${fmt.h(t.spentMedian, 1)}${t.open ? ` · ${t.open} open` : ''}`)}</span>
                    <span className="pb-keys">{t.exampleKeys.slice(0, 3).map((k) => <button key={k} type="button" className="linkbtn" onClick={() => openIssue(k)}>{k}</button>)}</span>
                  </div>
                  <span className="pb-topic-trend" {...tip(infoCard({ title: t.name, text: t.explain, inputs: [[tr('Letzte 4 Wochen', 'Last 4 weeks'), String(t.recent)], [tr('Davor je Woche', 'Before, per week'), fmt.n(t.beforePerWeek, 1)], [tr('Zuletzt je Woche', 'Recently, per week'), fmt.n(t.recentPerWeek, 1)]] }))} tabIndex={0}>
                    <Spark counts={counts} label={tr(`Tickets je Woche, letzte 12 Wochen: ${counts.join(', ')}`, `Tickets per week, last 12 weeks: ${counts.join(', ')}`)} />
                    <span className={`chip ${chip}`}>{tr(de, en)}</span>
                  </span>
                  <span className="pb-topic-act">
                    {has ? <button type="button" className="btn btn-sm" onClick={() => edit(has)}><Icon name="bookmark" size={13} />{tr('Playbook öffnen', 'Open playbook')}</button>
                      : t.playbook && canEdit ? <button type="button" className="btn btn-sm" onClick={() => open(t)}><Icon name="plus" size={13} />{tr('Playbook erstellen', 'Create playbook')}</button>
                        : t.playbook ? <span className="chip chip-warn">{tr('Playbook-Kandidat', 'Playbook candidate')}</span> : null}
                  </span>
                </motion.li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="card">
        <div className="sp-head">
          <h2 className="card-title"><Icon name="bookmark" />{tr('Playbooks', 'Playbooks')}</h2>
          <span className="sp-head-end card-sub">{canEdit ? tr('Je Thema eine Anleitung mit Standardantwort', 'A guide with a standard reply per topic') : tr('Ansehen und Antworten kopieren – ändern darf, wer Support-Tickets verteilt', 'View and copy replies – people who dispatch support tickets can change them')}</span>
        </div>
        {pbs.state === 'loading' ? <div className="pb-loading faint" role="status">{tr('Lade Playbooks …', 'Loading playbooks …')}</div>
          : pbs.state === 'error' ? <div className="callout warn" style={{ margin: 16 }}><Icon name="alert" /><div>{errText(pbs.e)}</div></div>
            : !pbs.items.length ? <Empty icon="bookmark" title={tr('Noch keine Playbooks', 'No playbooks yet')}>{tr('Wähle oben ein Thema und „Playbook erstellen“ – die App schlägt einen Entwurf vor.', 'Pick a topic above and "Create playbook" – the app proposes a draft.')}</Empty>
              : (
                <ul className="pb-list">
                  {pbs.items.map((pb, i) => (
                    <motion.li key={pb.id} className="pb-item" {...stagger(i)}>
                      <div className="pb-item-main">
                        <b>{pb.title}</b>
                        <span className="faint">{[pb.topicName, tr(`${pb.steps.length} Schritte`, `${pb.steps.length} steps`), pb.source === 'ai' ? tr('KI-Entwurf', 'AI draft') : tr('Vorlage', 'template'), pb.updatedAt ? `${fmt.date(pb.updatedAt)}${pb.updatedBy ? ` · ${pb.updatedBy}` : ''}` : null].filter(Boolean).join(' · ')}</span>
                      </div>
                      <span className="row" style={{ gap: 4 }}>
                        <button type="button" className="btn btn-sm" onClick={() => copyText(pb.reply, toast, tr('Antwort kopiert', 'Reply copied'))}>{tr('Antwort kopieren', 'Copy reply')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => copyText(playbookText(pb, lang), toast, tr('Playbook kopiert', 'Playbook copied'))}>{tr('Alles kopieren', 'Copy all')}</button>
                        <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => edit(pb)} aria-label={tr(`„${pb.title}“ öffnen`, `Open "${pb.title}"`)}><Icon name="edit" size={14} /></button>
                        {canEdit && <button type="button" className="btn btn-ghost btn-icon btn-sm btn-danger" onClick={() => remove(pb)} aria-label={tr(`„${pb.title}“ löschen`, `Delete "${pb.title}"`)}><Icon name="trash" size={14} /></button>}
                      </span>
                    </motion.li>
                  ))}
                </ul>
              )}
      </section>
    </div>
  );
}
