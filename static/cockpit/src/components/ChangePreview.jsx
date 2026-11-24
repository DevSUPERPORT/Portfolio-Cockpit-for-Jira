// "Before it changes Jira": every bulk action shows exactly what will be written – work item, field, new value and
// why – and only the explicit confirm applies it. Undo stays available afterwards (top right).
import { tr, usageName } from '../lib/i18n.js';
import { Icon } from '../lib/icons.jsx';
import { Modal } from './ui.jsx';
import { openIssue } from '../lib/api.js';

export default function ChangePreview({ open, list, onClose, onConfirm, busy }) {
  const n = list?.length || 0;
  const items = new Set((list || []).map((s) => s.gap?.key || s.gap?.issueId)).size;
  const byField = Object.entries((list || []).reduce((m, s) => ({ ...m, [s.usage]: (m[s.usage] || 0) + 1 }), {}));
  return (
    <Modal open={open} onClose={onClose} icon="edit" width={640}
      title={tr(`${n} ${n === 1 ? 'Änderung' : 'Änderungen'} an ${items} ${items === 1 ? 'Vorgang' : 'Vorgängen'}`, `${n} ${n === 1 ? 'change' : 'changes'} to ${items} work ${items === 1 ? 'item' : 'items'}`)}
      sub={tr('Das wird in Jira gespeichert – bitte kurz prüfen.', 'This will be saved in Jira – please check briefly.')}
      footer={<>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>{tr('Abbrechen', 'Cancel')}</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy || !n} data-confirm>{busy ? tr('Speichere …', 'Saving …') : tr(`Ja, ${n} ${n === 1 ? 'Änderung' : 'Änderungen'} speichern`, `Yes, save ${n} ${n === 1 ? 'change' : 'changes'}`)}</button>
      </>}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row wrap" style={{ gap: 6 }}>{byField.map(([u, k]) => <span key={u} className="chip chip-outline">{k} × {usageName(u)}</span>)}</div>
        <div className="change-list" role="list">
          {(list || []).map((s) => (
            <div key={s.id} className="change-row" role="listitem">
              <button type="button" className="tkey" onClick={() => openIssue(s.gap?.key)} title={tr('In Jira öffnen', 'Open in Jira')}>{s.gap?.key}</button>
              <span className="change-sum" title={s.gap?.summary}>{s.gap?.summary}</span>
              <span className="change-what"><span className="faint">{usageName(s.usage)}</span> <Icon name="arrowRight" size={11} /> <b>{s.show}</b></span>
              {s.why && <span className="faint change-why">{s.why}</span>}
            </div>
          ))}
        </div>
        <div className="callout"><Icon name="undo" size={15} />{tr('Danach lässt sich alles mit einem Klick zurücksetzen – oben rechts über „Rückgängig“.', 'Afterwards everything can be reverted in one click – top right via "Undo".')}</div>
      </div>
    </Modal>
  );
}
