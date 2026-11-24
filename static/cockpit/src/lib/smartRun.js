// Runs a confirmed smart action through the app's normal writes – the same permission checks, the same undo.
import { useCallback } from 'react';
import { useApp, errText } from '../state.jsx';
import { tr } from './i18n.js';
import { call } from './api.js';

async function inParallel(items, fn, width = 4) {
  let next = 0;
  const worker = async () => { while (next < items.length) { const it = items[next++]; await fn(it); } };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
}

export function useSmartRun() {
  const { setHealth, reorder, fill, pushUndo, runUndo, toast, ds, setView, setDs } = useApp();
  return useCallback(async (a) => {
    try {
      if (a.kind === 'health') { await setHealth(a.ref, a.status, a.comment); return; } // toast + undo inside
      if (a.kind === 'rank') {
        const order = [...ds.portfolio].sort((x, y) => x.rank - y.rank).map((p) => p.ref).filter((r) => r !== a.ref);
        order.splice(a.to - 1, 0, a.ref);
        await reorder(order); // toast + undo inside
        return;
      }
      if (a.kind === 'tshirt') {
        const item = ds.portfolio.find((p) => p.ref === a.ref);
        const target = item?.kind === 'space' ? { ref: item.ref } : { issueId: item?.id };
        const entry = await fill({ ...target, usage: 'tshirt', value: a.size, label: tr(`T-Shirt Size ${a.size} · ${item?.name}`, `T-shirt size ${a.size} · ${item?.name}`) });
        toast({ text: tr(`T-Shirt Size ${a.size} für ${item?.name} gesetzt`, `T-shirt size ${a.size} set for ${item?.name}`), icon: 'check', undo: () => runUndo(entry) });
        return;
      }
      if (a.kind === 'due') {
        const target = a.ref ? { ref: a.ref } : { issueId: a.issueId };
        const entry = await fill({ ...target, usage: 'dueDate', value: a.value, label: tr(`Fälligkeit ${a.name}`, `due date ${a.name}`) });
        toast({ text: tr(`Fälligkeit von ${a.name}: ${a.when} – in Jira gespeichert`, `Due date of ${a.name}: ${a.when} – saved in Jira`), icon: 'calendar', undo: () => runUndo(entry) });
        return;
      }
      if (a.kind === 'link') {
        const r = await call('deps.link', { preId: a.preId, depId: a.depId, typeId: a.typeId });
        if (r.existed) { toast({ text: tr('Diese Abhängigkeit besteht schon.', 'This dependency already exists.'), icon: 'info' }); return; }
        const l = r.link;
        const mirror = { ...l, outward: !l.outward, otherId: a.preId };
        const withLink = (d) => ({ ...d, issues: d.issues.map((i) => (i.id === a.preId ? { ...i, links: [...(i.links || []), l] } : i.id === a.depId ? { ...i, links: [...(i.links || []), mirror] } : i)) });
        setDs(withLink);
        const key = `link:${a.preId}:${a.depId}`;
        const entry = pushUndo(tr(`Abhängigkeit ${a.preKey} → ${a.depKey}`, `dependency ${a.preKey} → ${a.depKey}`), async () => {
          await call('deps.unlink', { linkId: l.id, preId: a.preId, depId: a.depId });
          setDs((d) => ({ ...d, issues: d.issues.map((i) => ((i.links || []).some((x) => x.id === l.id) ? { ...i, links: i.links.filter((x) => x.id !== l.id) } : i)) }));
        }, [key]);
        toast({ text: tr(`${a.preKey} blockiert jetzt ${a.depKey} – in Jira verknüpft`, `${a.preKey} now blocks ${a.depKey} – linked in Jira`), icon: 'link', undo: () => runUndo(entry) });
        return;
      }
      if (a.kind === 'teamFill') {
        const ok = [], failed = [];
        await inParallel(a.issueIds, async (id) => {
          try { ok.push(await fill({ issueId: id, usage: 'team', value: a.teamId, collectUndo: true })); } catch (e) { failed.push(e); }
        });
        if (!ok.length) { toast({ text: failed[0] ? errText(failed[0]) : tr('Nichts geändert', 'Nothing changed'), error: true }); return; }
        const entry = pushUndo(tr(`Team für ${ok.length} Stories gesetzt`, `team set on ${ok.length} stories`), async () => { await inParallel(ok, (u) => u()); }, ok.map((u) => u.key));
        toast({ text: failed.length ? tr(`${ok.length} Stories gesetzt, ${failed.length} nicht möglich: ${errText(failed[0])}`, `${ok.length} stories set, ${failed.length} not possible: ${errText(failed[0])}`) : tr(`Team für ${ok.length} Stories gesetzt`, `Team set on ${ok.length} stories`), icon: 'check', undo: () => runUndo(entry) });
        if (a.ref) setView('project', { ref: a.ref });
      }
    } catch (e) { toast({ text: errText(e), error: true }); }
  }, [setHealth, reorder, fill, pushUndo, runUndo, toast, ds, setView, setDs]);
}

// Apply many smart suggestions at once (inbox, data quality): each saved and permission-checked on its own,
// failures reported with their reason, ONE undo reverts every saved value.
export function useApplySuggestions() {
  const { fill, pushUndo, runUndo, toast, computed } = useApp();
  return useCallback(async (list) => {
    const model = computed.model;
    const target = (g) => {
      const ref = g.isItem ? g.rootRef : null;
      const space = !!ref && ref.startsWith('space:');
      const itemId = g.isItem && !space ? model.itemByRef.get(g.rootRef)?.id : null;
      return { issueId: space ? undefined : itemId || g.issueId, ref: space ? ref : undefined };
    };
    const width = list.some((s) => target(s.gap).ref) ? 1 : 4; // space items share one storage record
    const ok = [], failed = [];
    await inParallel(list, async (s) => {
      try { ok.push(await fill({ ...target(s.gap), usage: s.usage, value: s.value, collectUndo: true })); } catch (e) { failed.push(e); }
    }, width);
    if (!ok.length) { toast({ text: failed[0] ? errText(failed[0]) : tr('Nichts geändert', 'Nothing changed'), error: true }); return { ok: 0, failed: failed.length }; }
    const label = tr(`${ok.length} Vorschläge übernommen`, `${ok.length} suggestions applied`);
    const entry = pushUndo(label, async () => { await inParallel(ok, (u) => u(), width); }, ok.map((u) => u.key));
    toast({ text: failed.length ? tr(`${label} – ${failed.length} nicht möglich: ${errText(failed[0])}`, `${label} – ${failed.length} not possible: ${errText(failed[0])}`) : `${label} · ${tr('in Jira gespeichert', 'saved in Jira')}`, icon: 'sparkle', undo: () => runUndo(entry) });
    return { ok: ok.length, failed: failed.length };
  }, [fill, pushUndo, runUndo, toast, computed]);
}
