import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { enter, sp, useReducedMotion } from '../lib/motion.js';
import { tr } from '../lib/i18n.js';
import { Icon, Logo } from '../lib/icons.jsx';

// First-run guided tour: at most 10 calm steps through the app as it is today – the portfolio, planning, Lotse (ask,
// act, whole workflows), the command bar and the report composer. Each step spotlights a real control (found via
// data-tour="…", or the selector in TARGETS); steps whose control is not on screen are skipped, so the tour fits every
// role (the role matrix decides which tabs exist) and every portfolio. It runs on the Portfolio view.
// Motion: transform / opacity only, enter animations only (no AnimatePresence exits – they stall in the Jira frame).
export function tourSteps({ roles, firstName, aiDraft = false, tabs = [] }) {
  return [
    { id: 'welcome', icon: 'sparkle', title: tr(`Willkommen${firstName ? `, ${firstName}` : ''}!`, `Welcome${firstName ? `, ${firstName}` : ''}!`),
      body: tr('Das Portfolio Cockpit zeigt alle Projekte in Rangfolge, wer wann woran arbeitet und ob eure Kapazität reicht – direkt aus Jira. Dazu Lotse, euer eingebauter Lotse: fragt, erledigt, schreibt Reports. In einer Minute zeigen wir dir das Wichtigste.',
        'Portfolio Cockpit shows every project in rank order, who works on what and when, and whether your capacity covers it – straight from Jira. Plus Lotse, your built-in navigator: it answers, gets things done and writes reports. Here is the essential in one minute.') },
    { id: 'tabs', icon: 'grid', target: ['tabs'], title: tr('Was kannst du hier tun?', 'What can you do here?'),
      body: tabs.length ? <span className="tour-tabs"><span>{tr('Jeder Reiter in einem Satz – welche du siehst, entscheidet deine Rolle. Fahr später mit der Maus über einen Reiter, dann steht es wieder da. Eine Zahl am Reiter heißt: dort wartet etwas auf dich.', 'Every tab in one sentence – your role decides which ones you see. Hover a tab later and it shows again. A number on a tab means something there needs you.')}</span><ul tabIndex={0} aria-label={tr('Alle Reiter mit Erklärung (scrollbar)', 'All tabs with an explanation (scrollable)')}>{tabs.filter((t) => t.desc).map((t) => <li key={t.id}><b>{t.label}</b> – {t.desc}</li>)}</ul></span>
        : tr('Meine Arbeit, Portfolio, Projekte, Teams, Wochenplanung, Plan vs. Ist, Support und der C-Level-Report – welche Reiter du siehst, entscheidet deine Rolle. Eine Zahl am Reiter heißt: dort wartet etwas auf dich.', 'My work, Portfolio, Projects, Teams, Weekly planning, Plan vs. actual, Support and the C-level report – your role decides which tabs you see. A number on a tab means something there needs you.') },
    { id: 'ranking', icon: 'ranking', target: ['ranking'], title: tr('Rangfolge, Wasserlinie, Health', 'Ranking, waterline, health'),
      body: tr(`${roles?.manageRanking ? 'Projekte per Drag & Drop (oder Alt + ↑/↓) sortieren. ' : ''}Die orange Wasserlinie zeigt, bis zu welchem Rang eure Kapazität im Quartal reicht – Support geht vor; „wartet auf …“ zeigt, wer auf wen wartet. Health: Status wählen, einen Satz schreiben${aiDraft ? ' – oder „Mit KI formulieren“ lassen' : ''}. Es gibt keinen Pflicht-Rhythmus; erinnert wird nur, wenn ein Jira-Admin Erinnerungen einschaltet.`,
        `${roles?.manageRanking ? 'Drag projects (or Alt + ↑/↓) to re-rank them. ' : ''}The orange waterline shows how far down your capacity reaches this quarter – support comes first; "waits for …" shows who waits for whom. Health: pick a status, write one sentence${aiDraft ? ' – or let "Draft with AI" write it' : ''}. There is no required rhythm; reminders only come when a Jira admin switches them on.`) },
    { id: 'plan', icon: 'calendar', target: ['tab-plan'], title: tr('Wochenplanung und Optimieren', 'Weekly planning and Optimize'),
      body: tr('Zieh eine Aufgabe in eine andere Woche oder zu einer anderen Person – „Person ändern“ zeigt, wer Luft hat. Rote Wochen bekommen einen Vorschlag mit Vorschau. „Optimieren“ schlägt vor: schneller fertig, Überlast glätten oder umverteilen – bis 85 % oder 100 % Auslastung; 8, 12 oder 26 Wochen umschaltbar. In Jira landet erst, was du mit „In Jira übernehmen“ bestätigst; jede Zeile ist einzeln rückgängig.',
        'Drag a task to another week or person – "Change person" shows who has room. Red weeks get a suggestion with a preview. "Optimize" suggests: finish sooner, smooth overload or rebalance – up to 85 % or 100 % utilization; switch between 8, 12 or 26 weeks. Only what you confirm with "Apply in Jira" lands in Jira; each line can be undone on its own.') },
    { id: 'time', icon: 'clock', target: ['tab-time'], title: tr('Plan vs. Ist', 'Plan vs. actual'),
      body: tr('Jeden Montag um 06:00 wird der Wochenplan festgehalten. Danach siehst du, wohin die Stunden wirklich geflossen sind und warum sich etwas verschoben hat. Darunter: ob alle genug gebucht haben – wen du nicht einzeln sehen darfst, zeigt eine „nur Summe“-Zeile.',
        'Every Monday at 06:00 the weekly plan is recorded. Then you see where the hours really went and why something shifted. Below: whether everyone booked enough – people you may not see individually appear as a "sum only" row.') },
    { id: 'lotse', icon: 'target', target: ['lotse'], title: tr('Lotse fragen', 'Ask Lotse'),
      body: tr('Frag in deinen Worten – „Wie steht Glasfaser?“, „Reicht Team Web im Q1?“, „Wer ist doppelt verplant?“ oder einfach ein Jira-Key, dann sagt Lotse, wann er eingeplant ist. Jede Antwort ist ein Bild mit den echten Zahlen, den Belegen und dem nächsten Schritt – sofort und ohne KI. Ist die KI eingeschaltet, steht ihre Lesart daneben; die App prüft jede Zahl darin gegen Lotse.',
        'Ask in your own words – "How is the fibre project?", "Does team Web cover Q1?", "Who is double booked?" or just a Jira key, and Lotse says when it is planned. Every answer is a picture with the real numbers, the evidence and the next step – instant and without AI. With AI on, its reading stands next to it; the app checks every number in it against Lotse.') },
    { id: 'act', icon: 'zap', target: ['lotse'], title: tr('Lotse erledigt es – mit Vorschau', 'Lotse gets it done – with a preview'),
      body: tr('Sag, was passieren soll: „Setze die Schätzung von ABC-118 auf 16 h“, „Erinnere Team Web an die Buchungen“. Ganze Abläufe führt Lotse Schritt für Schritt: Weekly vorbereiten, Lücken füllen, Überlast auflösen, Buchungen prüfen, Mehrteam-Konflikte lösen – und „Heute fällt die Arbeit aus“ plant alles neu. Du siehst vorher jede Änderung, geschrieben wird erst nach deinem OK – nur was deine Rolle darf, und alles ist rückgängig.',
        'Say what should happen: "Set the estimate of ABC-118 to 16 h", "Remind team Web about bookings". Whole jobs Lotse walks through step by step: prepare the weekly, fill the gaps, resolve overload, check bookings, resolve multi-team conflicts – and "work is cancelled today" re-plans everything. You see every change first, nothing is written before your OK – only what your role allows, and everything can be undone.') },
    { id: 'bar', icon: 'search', target: ['search'], title: tr('Die Befehlsleiste: Strg K', 'The command bar: Ctrl K'),
      body: tr('Strg K sucht Projekte, Bereiche und Aktionen (auch den Nachweis zu jeder Zahl) – und gibt Lotse eine Frage oder einen Auftrag, von überall aus. Rückgängig, Sprache und Konfiguration findest du hier ebenfalls.',
        'Ctrl K finds projects, areas and actions (including the proof behind every number) – and hands Lotse a question or a job, from anywhere. Undo, language and the configuration are here too.') },
    { id: 'report', icon: 'report', target: ['tab-report'], title: tr('Report mit Lotse', 'Report with Lotse'),
      body: tr('„Mit Lotse zusammenstellen“ entwirft den Report in einer Sekunde aus euren Daten: Abschnitte ziehen, Text ändern, Zahlen bleiben geschützte Chips. Als PDF teilen – vor dem Export prüft der Server jede Zahl gegen frische Daten. Dein Entwurf wird gespeichert und folgt dir auf andere Geräte.',
        '"Compose with Lotse" drafts the report from your data in a second: drag sections, edit the text, numbers stay protected chips. Share it as a PDF – before the export the server checks every number against fresh data. Your draft is saved and follows you to other devices.') },
    { id: 'done', icon: 'check', target: ['help', 'lang'], title: tr('Fertig – leg los!', 'Done – off you go!'),
      body: tr('Ganz rechts zählt ↶, was du zurücknehmen kannst – oder Strg/⌘ + Z. Hier wechselst du auch DE | EN, und „?“ startet die Tour wieder.',
        'At the far right, ↶ counts what you can undo – or press Ctrl/⌘ + Z. Switch DE | EN here, and "?" restarts the tour.') },
  ];
}

const PAD = 8;
// controls without their own data-tour attribute (owned by other parts of the app)
const TARGETS = { lotse: '[data-tour="lotse"], [data-lotse-open]' };
const find = (key) => document.querySelector(TARGETS[key] || `[data-tour="${key}"]`);
const present = (s) => !s.target || s.target.some((k) => find(k));
function rectOf(step) {
  if (!step?.target) return null;
  const rs = step.target.map(find).filter(Boolean).map((el) => el.getBoundingClientRect()).filter((r) => r.width || r.height);
  if (!rs.length) return null;
  const top = Math.min(...rs.map((r) => r.top)), left = Math.min(...rs.map((r) => r.left));
  const bottom = Math.max(...rs.map((r) => r.bottom)), right = Math.max(...rs.map((r) => r.right));
  // Very tall targets (the ranking) are clipped to the viewport so the card still fits.
  return { top: Math.max(top, 8), left, width: right - left, height: Math.min(bottom, window.innerHeight - 8) - Math.max(top, 8) };
}

export default function Tour({ open, steps: all, onClose }) {
  const reduce = useReducedMotion();
  const steps = useMemo(() => (open ? all.filter(present) : []), [open, all]);
  const [i, setI] = useState(0);
  const [rect, setRect] = useState(null);
  const [vp, setVp] = useState({ w: window.innerWidth, h: window.innerHeight });
  const cardRef = useRef(null);
  const [cardH, setCardH] = useState(200);
  useLayoutEffect(() => { const h = cardRef.current?.offsetHeight; if (h && Math.abs(h - cardH) > 2) setCardH(h); });
  const step = steps[i];
  useEffect(() => { if (open) setI(0); }, [open]);

  // Bring the target into view, then measure; follow scrolling and resizing.
  useLayoutEffect(() => {
    if (!open || !step) return undefined;
    const el = step.target && find(step.target[0]);
    // Tall targets (the ranking) scroll to the top so their content is visible; small ones just into view.
    if (el) el.scrollIntoView({ block: el.getBoundingClientRect().height > window.innerHeight * 0.45 ? 'start' : 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    let raf = 0;
    const measure = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { setRect(rectOf(step)); setVp({ w: window.innerWidth, h: window.innerHeight }); }); };
    measure();
    const t = setTimeout(measure, reduce ? 0 : 380);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); window.removeEventListener('resize', measure); window.removeEventListener('scroll', measure, true); };
  }, [open, step, reduce]);

  const finish = useCallback((completed) => onClose?.(completed), [onClose]);
  const next = useCallback(() => (i < steps.length - 1 ? setI(i + 1) : finish(true)), [i, steps.length, finish]);
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), []);

  // Keyboard: arrows move, Esc closes; focus stays inside the card.
  useEffect(() => {
    if (!open) return undefined;
    const h = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); next(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); back(); }
      else if (e.key === 'Tab' && cardRef.current) {
        const f = [...cardRef.current.querySelectorAll('button')];
        if (!f.length) return;
        const first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!cardRef.current.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, next, back, finish]);
  useEffect(() => { if (open && step) setTimeout(() => cardRef.current?.querySelector('[data-primary]')?.focus({ preventScroll: true }), 60); }, [open, step]);

  if (!open || !step) return null;
  const W = Math.min(380, vp.w - 32);
  const H = cardH;
  // Very tall targets (digest, ranking): spotlight their top part so the card fits underneath.
  const r = rect && rect.top + rect.height + PAD + 14 + H > vp.h - 8 && rect.top - PAD - 14 - H < 8
    ? { ...rect, height: Math.max(90, vp.h - 8 - H - 14 - PAD - rect.top) } : rect;
  const centered = !r;
  let cardTop, cardLeft;
  if (centered) { cardTop = Math.max(16, vp.h / 2 - H / 2); cardLeft = vp.w / 2 - W / 2; }
  else {
    const below = r.top + r.height + PAD + 14, above = r.top - PAD - 14 - H;
    cardLeft = Math.min(Math.max(16, r.left + r.width / 2 - W / 2), vp.w - W - 16);
    if (below + H <= vp.h - 8) cardTop = below;
    else if (above >= 8) cardTop = above;
    else { cardTop = vp.h - H - 20; cardLeft = vp.w - W - 24; } // target fills the screen: dock bottom-right over it
  }
  const spot = centered
    ? { top: vp.h / 2, left: vp.w / 2, width: 0, height: 0, borderRadius: 999 }
    : { top: r.top - PAD, left: r.left - PAD, width: r.width + PAD * 2, height: r.height + PAD * 2, borderRadius: 14 };
  const last = i === steps.length - 1;
  const move = reduce ? { duration: 0 } : sp('panel');

  return createPortal(
    <motion.div key="tour" className="tour" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
        <div className="tour-block" onClick={(e) => e.stopPropagation()} />
        {/* Dimmed screen with a cut-out (SVG mask paints reliably at any size, unlike a huge box-shadow). */}
        <svg className="tour-dim" width={vp.w} height={vp.h} aria-hidden="true">
          <defs>
            <mask id="tour-mask">
              <rect width={vp.w} height={vp.h} fill="white" />
              <motion.rect fill="black" initial={false} animate={{ x: spot.left, y: spot.top, width: spot.width, height: spot.height, rx: centered ? 0 : 14 }} transition={move} />
            </mask>
          </defs>
          <rect width={vp.w} height={vp.h} className="tour-dim-fill" mask="url(#tour-mask)" />
        </svg>
        {/* the ring moves by transform; its size is set directly (no layout animation) */}
        {!centered && <motion.div className="tour-spot" aria-hidden="true" style={{ top: 0, left: 0, width: spot.width, height: spot.height, borderRadius: spot.borderRadius }} initial={false} animate={{ x: spot.left, y: spot.top }} transition={move} />}
        <motion.div ref={cardRef} className="tour-card" data-step={step.id} role="dialog" aria-modal="true" aria-labelledby="tour-title" aria-describedby="tour-body"
          style={{ width: W, top: 0, left: 0 }} initial={false} animate={{ x: cardLeft, y: cardTop }} transition={reduce ? { duration: 0 } : sp('card')}>
          {/* a new step fades in (keyed: enter only, no exit animation) */}
            <motion.div key={step.id} {...enter(0, { y: 6 })}>
              <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                <div className={`tour-badge${step.id === "welcome" ? " brand" : ""}`}>{step.id === "welcome" ? <Logo size={36} /> : <Icon name={step.icon || "info"} size={17} />}</div>
                <div className="grow" style={{ minWidth: 0 }}>
                  <div className="eyebrow" aria-live="polite">{tr(`Schritt ${i + 1} von ${steps.length}`, `Step ${i + 1} of ${steps.length}`)}</div>
                  <h2 id="tour-title" className="tour-title">{step.title}</h2>
                </div>
              </div>
              <div id="tour-body" className="tour-body">{step.body}</div>
            </motion.div>
          <div className="tour-foot">
            <div className="tour-dots" aria-hidden="true">{steps.map((s, k) => <span key={s.id} className={k === i ? 'on' : k < i ? 'past' : ''} />)}</div>
            <div className="row" style={{ gap: 6 }}>
              {i === 0
                ? <button className="btn btn-ghost btn-sm" onClick={() => finish(false)} title={tr('Die Tour kommt nicht wieder von selbst – jederzeit über „?“ oben rechts starten.', 'The tour will not come back by itself – start it any time with "?" at the top right.')}>{tr('Überspringen', 'Skip')}</button>
                : <button className="btn btn-ghost btn-sm" onClick={back}><Icon name="chevron" size={13} style={{ transform: 'rotate(180deg)' }} />{tr('Zurück', 'Back')}</button>}
              <button className="btn btn-primary btn-sm" data-primary onClick={next}>
                {i === 0 ? tr('Tour starten', 'Start the tour') : last ? tr("Los geht's", "Let's go") : tr('Weiter', 'Next')}{!last && <Icon name="arrowRight" size={13} />}
              </button>
            </div>
          </div>
          {i > 0 && !last && <button className="tour-skip" onClick={() => finish(false)} aria-label={tr('Tour beenden', 'End the tour')}><Icon name="x" size={14} /></button>}
        </motion.div>
    </motion.div>, document.body);
}
