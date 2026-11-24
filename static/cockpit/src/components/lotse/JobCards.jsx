// Lotse orchestration in the thread ("Auftrag ausführen"): the plan as a pipeline, the personal sections as a tabbed
// set of story cards (exactly what goes into the PDF), the document outline in the preview, and the result card with
// "PDF herunterladen", the personal PDFs, the personal texts to copy and the proof of every number.
// Lotse never sends anything from here: copying and downloading are the person's own actions.
// Motion: transform / opacity only, enter animations only (no exit animations – they stall in the Jira frame).
import { useId, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { enter, press, layoutT } from '../../lib/motion.js';
import { tr, fmt } from '../../lib/i18n.js';
import { Icon } from '../../lib/icons.jsx';
import { track } from '../../lib/usage.js';
import { buildJobDoc } from '@shared/lotse/report/jobDoc.js';
import StoryCard, { toneWord } from './StoryCard.jsx';
import { ProofIcon } from '../ProofPanel.jsx';
import './jobs.css';

const TONE_ICON = { bad: 'alert', warn: 'alert', ok: 'check', info: 'info' };

// ---------- the plan: what Lotse will do, with which data ----------
export function JobPlan({ plan }) {
  if (!plan?.steps?.length) return null;
  return (
    <section className="lj-plan" aria-label={tr('So geht Lotse vor', 'How Lotse goes about it')}>
      <span className="lx-kicker"><Icon name="sparkle" size={12} />{tr('So geht Lotse vor', 'How Lotse goes about it')}</span>
      <ol className="lj-pipe">
        {plan.steps.map((s, i) => (
          <motion.li key={s.id} className="lj-pipe-step" {...enter(i, { y: 6 })}>
            <span className="lj-pipe-n" aria-hidden="true"><Icon name={s.icon} size={13} /></span>
            <span className="lj-pipe-t"><b>{s.title}</b><span>{s.detail}</span></span>
          </motion.li>
        ))}
      </ol>
      {plan.sources?.length > 0 && (
        <p className="lj-sources"><span className="faint">{tr('Daten:', 'Data:')}</span>{plan.sources.map((x) => <span key={x} className="lj-chip">{x}</span>)}</p>
      )}
    </section>
  );
}

// ---------- the personal sections: one tab per recipient, the story card that becomes their PDF page ----------
export function JobSections({ steps, onAsk }) {
  const [sel, setSel] = useState(steps[0]?.id);
  const id = useId();
  const cur = steps.find((x) => x.id === sel) || steps[0];
  if (!cur) return null;
  const count = { bad: steps.filter((x) => x.story?.tone === 'bad').length, warn: steps.filter((x) => x.story?.tone === 'warn').length };
  return (
    <section className="lj-sections" aria-label={tr('Persönliche Abschnitte', 'Personal sections')}>
      <header className="lj-sec-head">
        <span className="lx-kicker"><Icon name="users" size={12} />{tr(`Persönliche Abschnitte · ${steps.length}`, `Personal sections · ${steps.length}`)}</span>
        <span className="faint lx-small">{count.bad ? tr(`${count.bad} mit Handlungsbedarf`, `${count.bad} need action`) : ''}{count.bad && count.warn ? ' · ' : ''}{count.warn ? tr(`${count.warn} im Blick`, `${count.warn} to watch`) : ''}</span>
      </header>
      <div className="lj-tabs" role="tablist" aria-label={tr('Empfänger', 'Recipients')}>
        {steps.map((x) => {
          const on = x.id === cur.id;
          return (
            <button key={x.id} type="button" role="tab" id={`${id}-t-${x.subjectId}`} aria-selected={on} aria-controls={`${id}-p`} tabIndex={on ? 0 : -1}
              className={`lj-tab ${on ? 'on' : ''}`} onClick={() => setSel(x.id)}
              onKeyDown={(e) => { const k = steps.indexOf(x); const to = e.key === 'ArrowRight' ? steps[k + 1] : e.key === 'ArrowLeft' ? steps[k - 1] : null; if (to) { e.preventDefault(); setSel(to.id); document.getElementById(`${id}-t-${to.subjectId}`)?.focus(); } }}>
              <i className={`lj-dot ${x.story?.tone || 'info'}`} aria-hidden="true" />
              <span>{x.story?.subject?.name}</span>
              {on && <motion.span layoutId={`lj-tab-${id}`} className="lj-tab-hl" transition={layoutT('chip')} />}
            </button>
          );
        })}
      </div>
      <div id={`${id}-p`} role="tabpanel" aria-labelledby={`${id}-t-${cur.subjectId}`} className="lj-panel">
        <motion.div key={cur.id} {...enter(0, { y: 6, d: 'quick' })}>
          <StoryCard story={cur.story} onAsk={onAsk} nested />
          {cur.suggestions?.length > 0 && (
            <div className="lj-sugg" aria-label={tr('Vorschläge im PDF', 'Suggestions in the PDF')}>
              <b><Icon name="arrowRight" size={12} />{tr('Vorschläge im PDF', 'Suggestions in the PDF')}</b>
              <ul>{cur.suggestions.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
        </motion.div>
      </div>
    </section>
  );
}

// ---------- the preview: what the document will contain ----------
export function JobOutline({ outline }) {
  if (!outline) return null;
  return (
    <div className="lj-outline" aria-label={tr('Inhalt des Dokuments', 'Contents of the document')}>
      <div className="lj-doc" aria-hidden="true"><span className="lj-doc-band" /><span className="lj-doc-line w70" /><span className="lj-doc-line w45" /><span className="lj-doc-line w60" /></div>
      <ol>
        <li><Icon name="report" size={12} /><span className="grow">{tr('Deckblatt mit Inhalt', 'Cover with contents')}</span></li>
        <li><Icon name="layers" size={12} /><span className="grow">{tr('Überblick', 'Overview')}</span></li>
        {outline.sections.slice(0, 8).map((s) => <li key={s.id}><i className={`lj-dot ${s.tone}`} aria-hidden="true" /><span className="grow">{s.heading}</span><span className="faint lx-small">{toneWord(s.tone)}</span></li>)}
        {outline.sections.length > 8 && <li className="faint"><span className="grow">{tr(`+ ${fmt.n(outline.sections.length - 8)} weitere Abschnitte`, `+ ${fmt.n(outline.sections.length - 8)} more sections`)}</span></li>}
        <li><ProofIcon size={12} /><span className="grow">{tr(`Nachweis: ${fmt.n(outline.figures)} Belege mit Formel, Eingaben und Jira-Keys`, `Proof: ${fmt.n(outline.figures)} entries with formula, inputs and Jira keys`)}</span></li>
      </ol>
    </div>
  );
}

// ---------- the result: download again, personal PDFs, texts to copy, the proof ----------
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* the Jira frame may block the clipboard – fall back */ }
  try {
    const ta = Object.assign(document.createElement('textarea'), { value: text });
    ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
export function JobResult({ job, ctx }) {
  const doc = useMemo(() => { try { return job && ctx ? buildJobDoc(ctx, job) : null; } catch (e) { console.error('[lotse] job doc', e); return null; } }, [job, ctx]);
  const [copied, setCopied] = useState(null);
  const [busy, setBusy] = useState(null);
  const [open, setOpen] = useState(() => (job?.format === 'text' ? 0 : null));
  const [proof, setProof] = useState(false);
  const [q, setQ] = useState('');
  const pid = useId();
  if (!doc) return null;
  const pdf = job.format !== 'text';
  // the Jira frame may refuse the clipboard: then the text is shown selected, ready for Ctrl/⌘ + C
  const copy = async (key, text, i = null) => {
    const ok = await copyText(text);
    track('lotse:action:open');
    if (ok) { setCopied(key); setTimeout(() => setCopied((c) => (c === key ? null : c)), 2200); return; }
    setCopied(`fail:${key}`);
    if (i != null) setOpen(i);
    setTimeout(() => { const el = document.getElementById(i != null ? `${pid}-m${i}` : `${pid}-all`); if (el) { el.focus(); const r = document.createRange(); r.selectNodeContents(el); if (el.select) el.select(); else { const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); } } }, 60);
  };
  const download = async (which) => {
    setBusy(which);
    try {
      const m = await import('../../lib/jobPdf.js');
      if (which === 'all') await m.downloadJobPdf(doc);
      else await m.downloadSectionPdf(doc, which);
    } finally { setBusy(null); }
  };
  const allText = doc.messages.map((m) => `${tr('An', 'To')}: ${m.to}\n${tr('Betreff', 'Subject')}: ${m.subject}\n\n${m.text}`).join('\n\n———\n\n');
  const rows = proof ? doc.proof.filter((p) => !q || `${p.label} ${p.keys.join(' ')} ${p.values.map((v) => v.join(' ')).join(' ')}`.toLowerCase().includes(q.toLowerCase())) : [];
  return (
    <motion.section className="lj-result" aria-label={tr('Ergebnis des Auftrags', 'Result of the job')} {...enter(0, { y: 8, d: 'base' })} data-job-result={doc.sections.length}>
      {pdf && (
        <div className="lj-res-files">
          <div className="lj-file">
            <span className="lj-file-ic" aria-hidden="true"><Icon name="pdf" size={18} /></span>
            <span className="grow"><b>{doc.title}</b><span className="faint lx-small">{tr(`${fmt.n(doc.sections.length)} Abschnitte · ${fmt.n(doc.proof.length)} Belege`, `${fmt.n(doc.sections.length)} sections · ${fmt.n(doc.proof.length)} proofs`)}</span></span>
            <motion.button type="button" className="btn btn-primary btn-sm" onClick={() => download('all')} disabled={!!busy} aria-busy={busy === 'all'} {...press()}>
              <Icon name={busy === 'all' ? 'refresh' : 'download'} size={13} className={busy === 'all' ? 'lx-spin' : ''} />{tr('PDF herunterladen', 'Download PDF')}
            </motion.button>
          </div>
          {job.format === 'pdfEach' && (
            <ul className="lj-each" aria-label={tr('Persönliche PDFs', 'Personal PDFs')}>
              {doc.sections.map((s) => (
                <li key={s.id}><i className={`lj-dot ${s.tone}`} aria-hidden="true" /><span className="grow">{s.heading}</span>
                  <button type="button" className="btn btn-xs" onClick={() => download(s.id)} disabled={!!busy} aria-label={tr(`Persönliches PDF für ${s.heading}`, `Personal PDF for ${s.heading}`)}><Icon name={busy === s.id ? 'refresh' : 'pdf'} size={12} className={busy === s.id ? 'lx-spin' : ''} />PDF</button></li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="lj-msgs">
        <header className="lj-msgs-head">
          <b>{tr('Persönliche Texte', 'Personal texts')}</b>
          <span className="faint lx-small grow">{tr('zum Kopieren – Lotse sendet nichts', 'to copy – Lotse sends nothing')}</span>
          <button type="button" className="btn btn-sm" onClick={() => copy('all', allText)}><Icon name={copied === 'all' ? 'check' : 'layers'} size={13} />{copied === 'all' ? tr('Kopiert', 'Copied') : tr('Alle kopieren', 'Copy all')}</button>
        </header>
        {copied === 'fail:all' && (
          <div className="lj-copy-fallback">
            <p className="faint lx-small" role="status">{tr('Die Zwischenablage ist hier gesperrt – der Text ist markiert: Strg/⌘ + C.', 'The clipboard is blocked here – the text is selected: Ctrl/⌘ + C.')}</p>
            <textarea id={`${pid}-all`} readOnly value={allText} rows={8} aria-label={tr('Alle persönlichen Texte', 'All personal texts')} />
          </div>
        )}
        <ul>
          {doc.messages.map((m, i) => {
            const on = open === i;
            return (
              <li key={m.id} className={on ? 'on' : ''}>
                <div className="lj-msg-row">
                  <button type="button" className="lj-msg-to" aria-expanded={on} aria-controls={`${pid}-m${i}`} onClick={() => setOpen(on ? null : i)}>
                    <Icon name={on ? 'up' : 'chevronDown'} size={12} /><span className="grow"><b>{m.to}</b><span className="faint"> · {m.subject}</span></span>
                  </button>
                  <button type="button" className="btn btn-xs" onClick={() => copy(m.id, m.text, i)} aria-label={tr(`Text für ${m.to} kopieren`, `Copy the text for ${m.to}`)}>
                    <Icon name={copied === m.id ? 'check' : 'layers'} size={12} />{copied === m.id ? tr('Kopiert', 'Copied') : copied === `fail:${m.id}` ? tr('Bitte markieren', 'Select it') : tr('Kopieren', 'Copy')}
                  </button>
                </div>
                {on && <motion.pre id={`${pid}-m${i}`} className="lj-msg-text" tabIndex={0} {...enter(0, { y: 4, d: 'quick' })}>{m.text}</motion.pre>}
              </li>
            );
          })}
        </ul>
      </div>
      <div className="lj-proof">
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={proof} aria-controls={`${pid}-proof`} onClick={() => { setProof(!proof); if (!proof) track('proof:workflow'); }}>
          <ProofIcon size={13} />{proof ? tr('Nachweis ausblenden', 'Hide the proof') : tr(`Nachweis prüfen (${fmt.n(doc.proof.length)} Belege)`, `Check the proof (${fmt.n(doc.proof.length)} entries)`)}
        </button>
        {proof && (
          <motion.div id={`${pid}-proof`} className="lj-proof-list" {...enter(0, { y: 4, d: 'quick' })}>
            <label className="sr" htmlFor={`${pid}-q`}>{tr('Nachweis durchsuchen', 'Search the proof')}</label>
            <input id={`${pid}-q`} className="lj-proof-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Name, Woche oder Jira-Key …', 'Name, week or Jira key …')} />
            <ol>
              {rows.slice(0, 60).map((p) => (
                <li key={p.id}>
                  <b>{p.label}</b>
                  <span className="lj-proof-v">{p.values.map(([a, b]) => `${a}: ${b}`).join(' · ')}</span>
                  <span className="faint lx-small">{p.formula}</span>
                  {p.keys.length > 0 && <span className="lj-keys">{p.keys.slice(0, 12).map((k) => <span key={k} className="mono">{k}</span>)}{p.keys.length > 12 ? <span className="faint">+{fmt.n(p.keys.length - 12)}</span> : null}</span>}
                </li>
              ))}
            </ol>
            {rows.length > 60 && <p className="faint lx-small">{tr(`${fmt.n(rows.length - 60)} weitere – im PDF vollständig.`, `${fmt.n(rows.length - 60)} more – complete in the PDF.`)}</p>}
          </motion.div>
        )}
      </div>
    </motion.section>
  );
}
export { TONE_ICON };
