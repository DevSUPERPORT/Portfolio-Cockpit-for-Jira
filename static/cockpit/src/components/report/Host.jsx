// Mounts the report composer on request: listens for 'pc-open-report-composer' (openReportComposer) and picks up a
// request made before the host was mounted. The composer itself loads lazily – the Report view stays light.
import { Suspense, useEffect, useState } from 'react';
import { lazyView } from '../../lib/chunkReload.js';
import { createPortal } from 'react-dom';
import { REPORT_COMPOSER_EVENT, takeComposerRequest } from './open.js';
import { tr } from '../../lib/i18n.js';
import './composer.css';

const ReportComposer = lazyView(() => import('./ReportComposer.jsx'));

function Loading() {
  return (
    <div className="rc-root rc-loading" role="dialog" aria-modal="true" aria-label={tr('Report-Composer lädt', 'Report composer is loading')}>
      <div className="rc-skel-page" aria-hidden="true"><i /><i /><i /><i /></div>
    </div>
  );
}

export default function ReportComposerHost({ report, planActual }) {
  const [req, setReq] = useState(null);
  useEffect(() => {
    const first = takeComposerRequest();
    if (first) setReq(first);
    // openReportComposer() leaves its request here; a bare CustomEvent brings it in detail
    const on = (e) => { const r = takeComposerRequest() || (e?.detail && typeof e.detail === 'object' ? { ...e.detail, at: Date.now() } : null); if (r) setReq(r); };
    window.addEventListener(REPORT_COMPOSER_EVENT, on);
    return () => window.removeEventListener(REPORT_COMPOSER_EVENT, on);
  }, []);
  if (!req) return null;
  // a portal: the views animate with transforms, which would pin a fixed overlay to the view instead of the window
  return createPortal(
    <Suspense fallback={<Loading />}>
      <ReportComposer key={req.at} params={req} report={report} planActual={planActual} onClose={() => setReq(null)} />
    </Suspense>, document.body);
}
