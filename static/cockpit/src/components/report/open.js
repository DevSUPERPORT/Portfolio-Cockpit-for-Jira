// Opening the report composer from anywhere (the Report view's button, the Lotse command 'report.compose') without
// pulling the composer's code into the caller. A request waits here until a host (ReportComposerHost in the Report
// view) picks it up – so a command can call openReportComposer() first and switch to the Report view afterwards.
//
//   openReportComposer({ audience?: 'c-level'|'steering'|'team'|'project', period?: 'current'|'next'|'YYYY-Qn',
//                        sections?: string[], projectRef?, teamId?, lang?: 'de'|'en' })
// Also: window.dispatchEvent(new CustomEvent('pc-open-report-composer', { detail: params })) does the same.
export const REPORT_COMPOSER_EVENT = 'pc-open-report-composer';

let pending = null;
export function openReportComposer(params = {}) {
  pending = { ...(params && typeof params === 'object' ? params : {}), at: Date.now() };
  try { window.dispatchEvent(new CustomEvent(REPORT_COMPOSER_EVENT, { detail: pending })); } catch { /* no window (tests) */ }
  return true;
}
// The host takes the waiting request once (a request older than a minute is stale – a view switch that never came).
export function takeComposerRequest() {
  const p = pending;
  pending = null;
  return p && Date.now() - (p.at || 0) < 60e3 ? p : null;
}
