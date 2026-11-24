// "Heute zu tun": one header button with a count, one panel with everything to do today – each with its
// one-click action (re-confirm a health that has not changed, apply every smart suggestion, open a blocked story).
// All actions use the normal permission-checked writes and can be undone from the history.
import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { todayInbox } from '@shared/inbox.js';
import { useApp } from '../state.jsx';
import { tr, fmt, usageName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { openIssue } from '../lib/api.js';
import { useApplySuggestions } from '../lib/smartRun.js';
import { Drawer, Empty, useTip, stagger } from './ui.jsx';
import ChangePreview from './ChangePreview.jsx';

const hName = (s) => ({ onTrack: tr('Im Plan', 'On track'), atRisk: tr('Gefährdet', 'At risk'), critical: tr('Kritisch', 'Critical') }[s] || tr('Keine Health', 'No health'));

export default function Inbox() {
  const [preview, setPreview] = useState(null); // bulk change preview (nothing is written before the confirm)
  const { computed, boot, roles, lang, setHealth, setView, toast, stale } = useApp();
  const tip = useTip();
  const applyAll = useApplySuggestions();
  // test builds only (compiled away otherwise): the live harness runs this same apply on a sandbox-only list
  if (import.meta.env.VITE_SELFTEST === '1') window.__pcApplySuggestions = applyAll;
  const [open, setOpen] = useState(false);
  useEffect(() => { const h = () => setOpen(true); window.addEventListener('pc-open-inbox', h); return () => window.removeEventListener('pc-open-inbox', h); }, []);
  const [busy, setBusy] = useState(null);
  const inbox = useMemo(() => todayInbox({ computed, me: boot.me, roles, lang }), [computed, boot.me, roles, lang]);
  const run = async (id, fn) => { setBusy(id); try { await fn(); } catch (e) { toast({ text: e.message, error: true }); } finally { setBusy(null); } };
  const n = inbox.total;
  return (
    <>
      <button type="button" className={`btn btn-ghost btn-sm inbox-btn ${n ? 'has' : ''}`} onClick={() => setOpen(true)} aria-label={tr(`Heute zu tun: ${n} Punkte`, `To do today: ${n} items`)}
        {...tip(<div><b>{tr('Heute zu tun', 'To do today')}</b>{n ? ` · ${n}` : ` · ${tr('alles erledigt', 'all done')}`}</div>)}>
        <Icon name="check" />{n > 0 && <span className="inbox-count num">{n}</span>}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} title={tr('Heute zu tun', 'To do today')} sub={n ? tr(`${n} Punkte – jeder mit einer Aktion, alles rückgängig machbar`, `${n} items – each with one action, everything can be undone`) : tr('Nichts offen', 'Nothing open')}>
        {/* the list is built only while the drawer is open: closed, every app render would build it for nothing (one
            row per project on a big site) */}
        {!open ? null : n === 0 ? <Empty icon="check" title={tr('Alles erledigt für heute', 'All done for today')}>{tr('Keine fälligen Health-Updates, keine offenen Vorschläge, nichts seit über einer Woche blockiert.', 'No health updates due, no open suggestions, nothing blocked for over a week.')}</Empty> : (
          <div className="stack inbox" style={{ gap: 22 }}>
            {inbox.health.length > 0 && (
              <section aria-label={tr('Health-Updates fällig', 'Health updates due')}>
                <h3 className="inbox-h"><Icon name="heart" size={14} />{tr('Health-Updates fällig', 'Health updates due')} <span className="chip num">{inbox.health.length}</span></h3>
                <ul className="inbox-list">
                  {inbox.health.map((h, i) => (
                    <motion.li key={h.ref} data-ref={h.ref} {...stagger(i)}>
                      <div className="inbox-main">
                        <b>{h.rank}. {h.name}{h.mine ? <span className="chip chip-outline inbox-mine">{tr('deins', 'yours')}</span> : null}</b>
                        <span className="faint">{h.status ? `${hName(h.status)} · ${tr(`vor ${h.days} Tagen`, `${h.days} days ago`)}` : tr('noch nie aktualisiert', 'never updated')}{h.comment ? ` · „${h.comment.slice(0, 60)}“` : ''}</span>
                      </div>
                      <div className="inbox-act">
                        {h.status && <button type="button" className="btn btn-sm" disabled={!!busy || stale} onClick={() => run(h.ref, () => setHealth(h.ref, h.status, h.comment || hName(h.status)))}
                          {...tip(<div>{tr('Gleicher Status, gleicher Kommentar – als aktuell bestätigt', 'Same status, same comment – confirmed as current')}</div>)}>{busy === h.ref ? '…' : tr('Unverändert bestätigen', 'Confirm unchanged')}</button>}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setView('portfolio'); }}>{tr('Ändern', 'Change')}</button>
                      </div>
                    </motion.li>
                  ))}
                </ul>
              </section>
            )}
            {inbox.suggestions && (
              <section aria-label={tr('Vorschläge bereit', 'Suggestions ready')}>
                <h3 className="inbox-h"><Icon name="sparkle" size={14} />{tr('Vorschläge bereit', 'Suggestions ready')} <span className="chip num">{inbox.suggestions.n}</span></h3>
                <div className="inbox-card">
                  <div className="inbox-main">
                    <b>{tr(`${inbox.suggestions.n} fehlende Werte lassen sich aus euren Daten füllen`, `${inbox.suggestions.n} missing values can be filled from your data`)}</b>
                    <span className="faint">{Object.entries(inbox.suggestions.byField).map(([u, k]) => `${k} × ${usageName(u)}`).join(' · ')}</span>
                  </div>
                  <div className="inbox-act">
                    <button type="button" className="btn btn-dark btn-sm" disabled={!!busy || stale} onClick={() => setPreview(inbox.suggestions.list)}>{tr(`Alle ${inbox.suggestions.n} prüfen & übernehmen`, `Review & apply all ${inbox.suggestions.n}`)}</button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setView('quality'); }}>{tr('Einzeln ansehen', 'Review one by one')}</button>
                  </div>
                </div>
              </section>
            )}
            {inbox.blocked.length > 0 && (
              <section aria-label={tr('Lange blockiert', 'Blocked for long')}>
                <h3 className="inbox-h"><Icon name="alert" size={14} />{tr('Seit über einer Woche blockiert', 'Blocked for over a week')} <span className="chip num">{inbox.blocked.length}</span></h3>
                <ul className="inbox-list">{inbox.blocked.slice(0, 12).map((b, i) => (
                  <motion.li key={b.id} data-key={b.key} {...stagger(i, 0.03)}>
                    <div className="inbox-main"><b><span className="mono">{b.key}</span> {b.summary}</b><span className="faint">{b.project} · {tr(`seit ${b.days} Tagen`, `for ${b.days} days`)}{b.reason ? ` · „${b.reason.slice(0, 60)}“` : ''}</span></div>
                    <div className="inbox-act">
                      <button type="button" className="btn btn-sm" onClick={() => openIssue(b.key)}><Icon name="external" size={13} />{tr('In Jira öffnen', 'Open in Jira')}</button>
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setView('deps'); }}>{tr('Abhängigkeiten', 'Dependencies')}</button>
                    </div>
                  </motion.li>
                ))}</ul>
              </section>
            )}
            <div className="faint" style={{ fontSize: 12 }}>{tr(`Health fällig nach ${computed.model.cfg.rules?.healthRhythmDays || 7} Tagen · Vorschläge sind regelbasiert, jede mit Begründung unter Datenqualität · blockiert = Status Blocked seit über 7 Tagen.`, `Health due after ${computed.model.cfg.rules?.healthRhythmDays || 7} days · suggestions are rule-based, each with its reason under Data quality · blocked = status Blocked for over 7 days.`)}</div>
          </div>
        )}
      </Drawer>
      <ChangePreview open={!!preview} list={preview || []} busy={busy === 'sugg'} onClose={() => setPreview(null)}
        onConfirm={() => run('sugg', async () => { await applyAll(preview); setPreview(null); })} />
    </>
  );
}
