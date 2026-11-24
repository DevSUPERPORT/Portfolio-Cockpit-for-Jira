// A section's narrative, edited in place. Numbers are tokens ({{id}}) shown as protected chips: they can be removed
// as a whole, never altered – so a number on the page always is the verified one. Plain typing in between is free.
// The element is uncontrolled while the person types (no caret jumps); a new text from outside (undo, "Lotse: neu
// formulieren", a redraft) replaces it.
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { tr } from '../../lib/i18n.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function toHtml(text, facts) {
  const by = new Map((facts || []).map((f) => [f.id, f]));
  return String(text || '').split(/(\{\{[A-Za-z0-9_.:-]{1,60}\}\})/).map((part) => {
    const m = /^\{\{(.+)\}\}$/.exec(part);
    if (!m) return esc(part).replace(/\n/g, '<br>');
    const f = by.get(m[1]);
    if (!f) return '';
    return `<span class="rc-chip" contenteditable="false" data-f="${esc(f.id)}" title="${esc(`${f.label} · ${tr('geprüft', 'verified')}`)}">${esc(f.display)}</span>`;
  }).join('');
}
// DOM → text with tokens (chips back to {{id}}; line breaks and the blocks browsers add on Enter → \n)
export function fromDom(root) {
  let out = '';
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.nodeValue.replace(/\{\{|\}\}/g, '').replace(/ /g, ' ');
      else if (c.nodeType === 1) {
        if (c.dataset?.f) { out += `{{${c.dataset.f}}}`; continue; }
        if (c.tagName === 'BR') { out += '\n'; continue; }
        const block = c.tagName === 'DIV' || c.tagName === 'P';
        if (block && out && !out.endsWith('\n')) out += '\n';
        walk(c);
      }
    }
  };
  walk(root);
  return out.replace(/\n{3,}/g, '\n\n').replace(/\n$/, '');
}

const Narrative = forwardRef(function Narrative({ text, facts, onChange, onCommit, label, placeholder, lang }, ref) {
  const el = useRef(null);
  const shown = useRef(null); // the text the DOM currently holds
  const range = useRef(null);
  useEffect(() => {
    if (!el.current || text === shown.current) return;
    el.current.innerHTML = toHtml(text, facts);
    shown.current = text;
  }, [text, facts]);
  const emit = () => { const t = fromDom(el.current); shown.current = t; onChange?.(t); };
  const save = () => { const s = window.getSelection(); if (s?.rangeCount && el.current?.contains(s.anchorNode)) range.current = s.getRangeAt(0).cloneRange(); };
  useImperativeHandle(ref, () => ({
    focus: () => el.current?.focus(),
    // a verified number at the caret (or at the end)
    insertFact(f) {
      if (!el.current) return;
      const tmp = document.createElement('div');
      tmp.innerHTML = toHtml(`{{${f.id}}}`, [f]);
      const chip = tmp.firstChild;
      const space = document.createTextNode(' ');
      const r = range.current && el.current.contains(range.current.startContainer) ? range.current : null;
      if (r) { r.deleteContents(); r.insertNode(space); r.insertNode(chip); } else { el.current.appendChild(document.createTextNode(' ')); el.current.appendChild(chip); }
      emit(); onCommit?.();
    },
  }));
  return (
    <div ref={el} className="rc-text" contentEditable suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={label} lang={lang}
      data-placeholder={placeholder} spellCheck
      onInput={emit} onBlur={() => { save(); onCommit?.(); }} onKeyUp={save} onMouseUp={save}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); document.execCommand('insertLineBreak'); emit(); } }}
      onPaste={(e) => { e.preventDefault(); const t = e.clipboardData.getData('text/plain'); document.execCommand('insertText', false, t.replace(/\{\{|\}\}/g, '')); }} />
  );
});
export default Narrative;
