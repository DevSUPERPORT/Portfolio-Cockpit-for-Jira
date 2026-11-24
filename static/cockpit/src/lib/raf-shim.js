// Test builds only (VITE_SELFTEST=1): browsers pause requestAnimationFrame for background tabs and
// off-screen frames, which freezes every animated transition, so the self-test could not click through
// views while the window is behind another one. Here each frame runs on the real frame or a 50 ms timer,
// whichever comes first. Production builds compile this block away.
if (import.meta.env.VITE_SELFTEST === '1' && typeof window !== 'undefined') {
  const native = window.requestAnimationFrame.bind(window);
  const cancelNative = window.cancelAnimationFrame.bind(window);
  const pending = new Map();
  let seq = 0;
  window.requestAnimationFrame = (cb) => {
    const id = ++seq;
    const run = (ts) => {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      cancelNative(p.raf);
      clearTimeout(p.timer);
      cb(ts ?? performance.now());
    };
    pending.set(id, { raf: native(run), timer: setTimeout(() => run(performance.now()), 50) });
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    cancelNative(p.raf);
    clearTimeout(p.timer);
  };
}
