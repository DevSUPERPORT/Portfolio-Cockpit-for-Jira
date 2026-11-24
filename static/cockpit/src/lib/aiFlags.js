// Is an AI feature switched on? Mirrors the server gate (src/lib/config.js aiAllowed). The UI only uses it to hide
// entry points – the server refuses every AI call on its own while the switch is off.
export const AI_FEATURES = ['ask', 'healthDraft', 'reportSummary', 'planning', 'gaps', 'dispatch', 'planActual', 'teamBrief', 'projectBrief', 'myWeek', 'intent', 'similarSummary', 'playbookDraft', 'lotse'];
// Requests per person and day – the default of SUPERPORT's AI budget (shared/aiBudget.js; the server's fallback
// DAILY_LIMIT in src/lib/ai.js; tests/dataTrust.test.js keeps them equal). The live value is config.ai.budget.dailyPerPerson.
export const AI_DAILY_LIMIT = 60;
// A used-up monthly budget (config.ai.budget, computed by the server) hides every AI entry point until the 1st.
export const aiOn = (config, feature) => config?.ai?.enabled === true && AI_FEATURES.includes(feature) && config.ai.features?.[feature] !== false && config.ai.budget?.stopped !== true && (config.ai.access === 'all' || config.ai.user === true);
// SUPERPORT (the app vendor) switched AI off: for every site (superportStop) or a monthly cap of 0 for this one (capZero).
// Not a used-up budget – nothing to wait for until the 1st, so the UI says so in VENDOR_OFF's words ([de, en]).
export const vendorOff = (budget) => budget?.stopped === true && (budget.reason === 'superportStop' || budget.reason === 'capZero');
export const VENDOR_OFF = Object.freeze(['Die KI-Funktionen sind vorübergehend vom App-Anbieter ausgeschaltet. Bitte versuchen Sie es später erneut.', 'AI features are temporarily turned off by the app vendor. Please try again later.']);
// 'self': each person decides in the header; 'all': the admin switched AI on for everyone (no personal switch).
export const aiPerPerson = (config) => config?.ai?.enabled === true && config.ai.access !== 'all';
// The site allows AI (admin switch) – the person may then switch it on for themselves (header "KI" switch).
export const aiSiteOn = (config) => config?.ai?.enabled === true;
