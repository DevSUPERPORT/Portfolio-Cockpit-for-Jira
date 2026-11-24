// The only door to Atlassian's browser bridge. Company policy: the app never calls or opens the AI assistant.
// Only the four bridge modules the cockpit needs are loaded, each by file (alias '@bridge-part/*' in
// vite.config.js) – the bridge's assistant opener is not part of the shipped code at all
// (tests/norovo.test.js checks dist/ for it).
export { invoke } from '@bridge-part/invoke';
export { requestJira } from '@bridge-part/fetch';
export { router } from '@bridge-part/router';
export { view } from '@bridge-part/view';
