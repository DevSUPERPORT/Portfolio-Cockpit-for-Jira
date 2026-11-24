// Confluence from the composer: publishes the COMPOSED report (the edited text, the order, the sections switched on) –
// not the stored snapshot. Before anything is written the server drafts the same report from fresh data and re-checks
// every number (report.publishComposed { dryRun }); the dialog shows that result first. A page published from here
// before can be updated in place. Undo: an update restores the previous version, a first publish withdraws the page
// (the app may create and update pages, not delete them). Motion: enter only, transform / opacity.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter } from '../../lib/motion.js';
import { useApp, errText } from '../../state.jsx';
import { call, openUrl } from '../../lib/api.js';
import { tr } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { Modal, Skeleton, Switch } from '../ui.jsx';
import { track } from '../../lib/usage.js';

// What the server needs from the document – only what the person shaped (the data blocks are recomputed there).
export const publishDoc = (doc, confidential) => ({
  v: doc.v, audience: doc.audience, lang: doc.lang, period: doc.period ? { quarter: doc.period.quarter } : null, projectRef: doc.projectRef || null, teamId: doc.teamId || null,
  title: doc.title, subtitle: doc.subtitle, confidential: confidential !== false,
  sections: doc.sections.map((s) => ({ id: s.id, kind: s.kind, title: s.title, on: s.on !== false, text: s.text || '', facts: (s.facts || []).map(({ id, label, value, unit, display }) => ({ id, label, value, unit, display })) })),
});

const KIND = () => ({ stale: tr('Wert hat sich geändert', 'value changed'), unsourced: tr('ohne Quelle', 'no source'), person: tr('Name einer Person', 'a person\'s name') });

export default function PublishComposed({ open, doc, confidential, onClose, onPublished, onRedraft }) {
  const { toast, done } = useApp();
  const [spaces, setSpaces] = useState(null);
  const [space, setSpace] = useState('');
  const [title, setTitle] = useState('');
  const [update, setUpdate] = useState(true);
  const [check, setCheck] = useState(null);
  const [busy, setBusy] = useState(false);
  const body = useMemo(() => (open && doc ? publishDoc(doc, confidential) : null), [open, doc, confidential]);
  const prev = doc?.published || null;

  useEffect(() => {
    if (!open) return undefined;
    let alive = true;
    setTitle(doc?.title || '');
    setCheck(null);
    setSpace(prev?.spaceId || '');
    setUpdate(true);
    call('confluence.spaces', {}).then((r) => alive && setSpaces(r)).catch(() => alive && setSpaces({ available: false }));
    call('report.publishComposed', { doc: body, dryRun: true }).then((r) => alive && setCheck(r)).catch((e) => alive && setCheck({ error: e }));
    return () => { alive = false; };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const go = async () => {
    setBusy(true);
    try {
      const pageId = prev?.pageId && prev.spaceId === space && update ? prev.pageId : undefined;
      const r = await call('report.publishComposed', { doc: body, spaceId: space, title: title.trim(), ...(pageId ? { pageId } : {}) });
      if (!r?.ok) { setCheck(r); return; }
      track('report:confluence');
      onPublished?.({ pageId: r.pageId, spaceId: r.spaceId, url: r.url, at: new Date().toISOString() });
      onClose();
      const label = r.mode === 'update' ? tr('Confluence-Seite aktualisiert', 'Confluence page updated') : tr('Report in Confluence veröffentlicht', 'Report published to Confluence');
      done(tr(`${label} – ${r.checked} Abschnitte, jede Zahl frisch geprüft`, `${label} – ${r.checked} sections, every number freshly checked`), 'send', label, async () => {
        const u = await call('report.unpublishComposed', { pageId: r.pageId });
        if (u?.mode === 'withdraw') onPublished?.(null);
        toast({ text: u?.mode === 'restore' ? tr('Vorige Fassung der Seite wiederhergestellt', 'Previous version of the page restored') : tr('Seite zurückgezogen – löschen kannst du sie in Confluence', 'Page withdrawn – you can delete it in Confluence'), icon: 'history' });
      }, [`confluence:${r.pageId}`]);
      if (r.url) openUrl(r.url);
    } catch (e) { toast({ text: errText(e), error: true }); } finally { setBusy(false); }
  };

  const problems = check?.problems || [];
  const blocked = !check || check.error || problems.length > 0;
  const kinds = KIND();
  return (
    <Modal open={open} onClose={onClose} icon="send" width={560} title={tr('Report in Confluence veröffentlichen', 'Publish the report to Confluence')}
      sub={tr('Genau dieser Report – dein Text, deine Reihenfolge, nur eingeblendete Abschnitte. Diagramme kommen als Tabellen mit denselben Zahlen; Namen von Personen werden nie veröffentlicht.', 'Exactly this report – your text, your order, only the sections shown. Charts arrive as tables with the same numbers; names of people are never published.')}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose}>{tr('Abbrechen', 'Cancel')}</button>
        <button className="btn btn-primary" data-rc-publish disabled={blocked || !space || !title.trim() || busy || !spaces?.available} onClick={go}>
          <Icon name="send" />{busy ? tr('Veröffentliche …', 'Publishing …') : prev?.pageId && prev.spaceId === space && update ? tr('Seite aktualisieren', 'Update the page') : tr('Veröffentlichen', 'Publish')}
        </button>
      </>}>
      <div className="stack rc-pub">
        {/* 1 · the fresh re-check */}
        {!check ? (
          <div className="rc-pub-check is-wait" role="status"><span className="rc-shimmer" aria-hidden="true" />{tr('Der Server rechnet den Report frisch und prüft jede Zahl …', 'The server recomputes the report and checks every number …')}</div>
        ) : check.error ? (
          <div className="rc-pub-check is-bad" role="alert"><Icon name="alert" size={15} />{errText(check.error)}</div>
        ) : problems.length === 0 ? (
          <motion.div className="rc-pub-check is-ok" role="status" {...enter(0, { y: 4 })}>
            <Icon name="shield" size={15} /><span>{tr(`Geprüft: ${check.checked} Abschnitte stimmen mit den aktuellen Daten überein.`, `Checked: ${check.checked} sections match the current data.`)}</span>
          </motion.div>
        ) : (
          <motion.div className="rc-pub-check is-bad" role="alert" {...enter(0, { y: 4 })}>
            <div className="row" style={{ gap: 8 }}><Icon name="alert" size={15} /><b>{tr(`${problems.length} ${problems.length === 1 ? 'Stelle verhindert' : 'Stellen verhindern'} das Veröffentlichen`, `${problems.length} ${problems.length === 1 ? 'issue blocks' : 'issues block'} publishing`)}</b></div>
            <ul className="rc-pub-list">
              {problems.slice(0, 8).map((p, i) => <li key={i}><span className="faint">{p.title || tr('Titel', 'Title')}:</span> „{p.text}“ – {kinds[p.kind] || p.kind}{p.expected ? tr(` (aktuell: ${p.expected})`, ` (now: ${p.expected})`) : ''}</li>)}
            </ul>
            <p className="faint" style={{ margin: 0 }}>{problems.some((p) => p.kind === 'stale') ? tr('Die Daten haben sich seit dem Entwurf geändert – entwirf neu, dann stimmt jede Zahl wieder.', 'The data changed since the draft – redraft and every number is right again.') : tr('Ersetze Zahlen über „Zahl einfügen“ durch geprüfte Werte und nimm Namen heraus.', 'Replace numbers with verified values via "Insert number" and take names out.')}</p>
            {problems.some((p) => p.kind === 'stale') && onRedraft && <button type="button" className="btn btn-xs" onClick={() => { onClose(); onRedraft(); }}><Icon name="refresh" size={12} />{tr('Mit aktuellen Zahlen neu entwerfen', 'Redraft with current figures')}</button>}
          </motion.div>
        )}
        {/* 2 · where */}
        {spaces == null ? <Skeleton h={80} /> : spaces.available && spaces.approvedCount === 0 ? (
          <div className="callout"><Icon name="lock" />{tr('Veröffentlichen in Confluence ist für diese Site nicht eingerichtet – den Report als PDF exportieren und teilen.', 'Publishing to Confluence is not set up for this site – export the report as a PDF and share it.')}</div>
        ) : !spaces.available ? (
          <div className="callout accent"><Icon name="info" />{tr('Confluence ist für diese App noch nicht verbunden. Bis dahin: PDF herunterladen.', 'Confluence is not connected for this app yet. Until then: download the PDF.')}</div>
        ) : (
          <>
            <div><label className="label" htmlFor="rc-pub-space">Space</label><select id="rc-pub-space" className="select" style={{ width: '100%' }} value={space} onChange={(e) => setSpace(e.target.value)}><option value="">{tr('Space wählen …', 'Choose space …')}</option>{spaces.spaces.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.key})</option>)}</select></div>
            <div><label className="label" htmlFor="rc-pub-title">{tr('Seitentitel', 'Page title')}</label><input id="rc-pub-title" className="input" style={{ width: '100%' }} value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></div>
            {prev?.pageId && prev.spaceId === space && <Switch on={update} onChange={setUpdate} label={tr('Die zuletzt veröffentlichte Seite aktualisieren (statt einer neuen)', 'Update the page published last (instead of a new one)')} />}
          </>
        )}
        <p className="faint rc-pub-undo"><Icon name="undo" size={12} />{tr('Rückgängig: Eine aktualisierte Seite bekommt ihre vorige Fassung zurück; eine neue Seite wird zurückgezogen – löschen kannst du sie in Confluence.', 'Undo: an updated page gets its previous version back; a new page is withdrawn – you can delete it in Confluence.')}</p>
      </div>
    </Modal>
  );
}
