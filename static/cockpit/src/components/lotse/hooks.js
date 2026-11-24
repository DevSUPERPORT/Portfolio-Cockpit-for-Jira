// The app side of Lotse's acts: the io built from the app state (io.js), and what happens after a command ran –
// one undo entry in the global history (toast, Ctrl/⌘ + Z, the header ↶), the report composer, a view switch.
import { useCallback, useMemo } from 'react';
import { useApp } from '../../state.jsx';
import { call as invoke } from '../../lib/api.js';
import { tr } from '../../lib/i18n.js';
import { track } from '../../lib/usage.js';
import { openReportComposer } from '../report/open.js';
import { createIo } from './io.js';
import { closeLotse } from './open.js';
import { actionKind, composerParams } from './acts.js';

// doc.pdf: the job's document painted and downloaded in the browser (jsPDF is loaded only now)
const downloadJob = (doc, opts) => import('../../lib/jobPdf.js').then((m) => m.downloadJobPdf(doc, opts));
const withPdf = (io) => { io.pdf = (doc, opts = {}) => { io.calls.push(['pdf', doc?.sections?.length || 0]); return downloadJob(doc, opts); }; return io; };

// One io per app session: fill / reorder from state.jsx (optimistic patch + exact undo), every other write through the
// app's resolver call, patched into the dataset (setDs) or reloaded quietly – the screen updates right away.
export function useLotseIo() {
  const { fill, reorder, setDs, reload } = useApp();
  return useMemo(() => withPdf(createIo({ call: invoke, fill, reorder, setDs, reload })), [fill, reorder, setDs, reload]);
}

export function useActs() {
  const { pushUndo, runUndo, toast, setView } = useApp();
  const io = useLotseIo();
  // what a no-write command asks for: the report composer (switch to the Report view first – its host listens only
  // while that view is mounted – then hand over the params) or another view
  const follow = useCallback((done) => {
    if (done?.open === 'reportComposer') { closeLotse(); setView('report'); setTimeout(() => openReportComposer(composerParams(done.params || {})), 30); return true; }
    if (done?.navigate?.view) {
      const { view, opts = {} } = done.navigate;
      closeLotse();
      if (view === 'support' && opts.tab) { import('../../views/Support.jsx').then(({ requestSupportTab }) => { requestSupportTab(opts.tab); setView(view, opts); }, () => setView(view, opts)); return true; }
      setView(view, opts); return true;
    }
    return false;
  }, [setView]);
  // the global undo entry of an applied command; onUndone runs after the undo (the card / run marks itself)
  const record = useCallback((label, run, keys, onUndone) => {
    if (typeof run !== 'function') return null;
    return pushUndo(label, async () => { await run(io); onUndone?.(); }, (keys || []).map(String));
  }, [pushUndo, io]);
  const counted = useCallback((command) => track(`lotse:action:${actionKind(command)}`), []);
  const undo = useCallback((entry) => (entry ? runUndo(entry) : Promise.resolve(false)), [runUndo]);
  const say = useCallback((text, icon = 'check', entry = null) => toast({ text, icon, ...(entry ? { undo: () => runUndo(entry) } : {}) }), [toast, runUndo]);
  return { io, follow, record, counted, undo, runUndo, say, tr };
}
