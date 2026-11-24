// Logs SUPERPORT can read (Developer Console › Logs) must never carry customer content or personal data
// (App EULA 8.2, App privacy: "do not transfer any content or personal data to SUPERPORT").
//
// Jira's own error texts can echo customer values (a project or field value in a JQL error, an account id, a summary),
// so they are NEVER logged. A log line keeps only what helps us fix the app: where it happened, the error class,
// the HTTP status and – for errors raised by our own code – the message after scrubbing.
//
//   logError('[report:extras]', e)        → console.error('[report:extras] HttpError 400')
//   logWarn('[teams:atlassian]', e)       → console.warn(...)
//   safeError(e)                           → the same text, e.g. to rethrow from a job without its original message
const QUOTED = /(["'„“”‚‘’«»`])(?:(?!\1).){0,400}\1/g; // anything in quotes – Jira and JS put values there
const EMAIL = /[^\s@]{1,64}@[^\s@]{1,255}/g;
const ACCOUNT = /\b(?:\d{6}:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b|\b[0-9a-f]{24}\b/gi; // account / team ids
const KEY = /\b[A-Z][A-Z0-9_]{1,9}-\d{1,9}\b/g; // work item keys
const NUM = /\b\d{4,}\b/g; // ids, amounts

export function scrub(text) {
  return String(text ?? '').replace(QUOTED, '‹…›').replace(EMAIL, '‹email›').replace(ACCOUNT, '‹id›').replace(KEY, '‹key›').replace(NUM, '‹n›').slice(0, 160);
}

export function safeError(e) {
  if (!e) return 'unknown error';
  const name = e.name && e.name !== 'Error' ? e.name : e.constructor?.name || 'Error';
  // Jira / Confluence / platform answers: status only, the text is theirs (and may hold customer data)
  if (e.status != null || name === 'HttpError') return `${name}${e.status != null ? ` ${e.status}` : ''}`;
  // errors of our own code (TypeError, RangeError, our classes): the message names code, not data – scrubbed anyway
  return `${name}${e.code ? ` ${String(e.code).slice(0, 40)}` : ''}: ${scrub(e.message)}`;
}

export const logError = (where, e) => console.error(`${where} ${safeError(e)}`);
export const logWarn = (where, e) => console.warn(`${where} ${safeError(e)}`);
