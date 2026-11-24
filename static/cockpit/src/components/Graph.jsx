import { useId, useMemo } from 'react';
import { motion } from 'framer-motion';
import { enter, delayOf, tween } from '../lib/motion.js';
import { useTip } from './ui.jsx';
import { layoutGraph } from './graphLayout.js';

export { layoutGraph };

const TONE = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--bad)', ink: 'var(--ink)', muted: 'var(--line-strong)' };

// Projects as nodes, dependencies between them as arrows (red = schedule conflict).
export default function Graph({ graph, height = 300, onPick, label }) {
  const tip = useTip();
  const id = useId().replace(/:/g, '');
  const W = 1000, H = 640;
  const pos = useMemo(() => layoutGraph(graph.nodes, graph.edges, W, H), [graph]);
  const at = new Map(graph.nodes.map((nd, i) => [nd.id, pos[i]]));
  const short = (s) => (s.length > 26 ? `${s.slice(0, 25)}…` : s);
  const half = new Map(graph.nodes.map((nd) => [nd.id, Math.min(200, 26 + short(nd.label).length * 7.4) / 2]));
  return (
    <figure className="chart graph" aria-label={label} style={{ margin: 0, height: height === '100%' ? '100%' : undefined }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height, display: 'block' }} role="img" aria-label={label}>
        <defs>
          <marker id={`a-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--ink-3)" /></marker>
          <marker id={`b-${id}`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--bad)" /></marker>
        </defs>
        {graph.edges.map((e, i) => {
          const a = at.get(e.from), b = at.get(e.to);
          if (!a || !b) return null;
          const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.12, my = (a.y + b.y) / 2 - (b.x - a.x) * 0.12;
          // stop the arrow at the node's edge
          const dx = b.x - mx, dy = b.y - my, dl = Math.hypot(dx, dy) || 1, ux = dx / dl, uy = dy / dl;
          const cut = Math.min((half.get(e.to) + 4) / (Math.abs(ux) || 1e-6), 26 / (Math.abs(uy) || 1e-6));
          const ex = b.x - ux * cut, ey = b.y - uy * cut;
          const bad = e.tone === 'bad';
          return (
            <g key={`${e.from}-${e.to}`} {...tip(<div><b>{e.count}</b> {e.count === 1 ? 'link' : 'links'}{bad ? <> · <b style={{ color: 'var(--bad)' }}>{e.conflicts} ⚠ {e.days} d</b></> : null}</div>)}>
              <motion.path d={`M${a.x},${a.y} Q${mx},${my} ${ex},${ey}`} fill="none" stroke={bad ? 'var(--bad)' : 'var(--ink-3)'} strokeWidth={bad ? 3 : 1.6 + Math.min(3, e.count * 0.4)} markerEnd={`url(#${bad ? 'b' : 'a'}-${id})`}
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={tween('gentle', { delay: delayOf(i) + 0.2 })} />
              <circle cx={mx} cy={my} r="15" fill={bad ? 'var(--bad)' : 'var(--surface)'} stroke={bad ? 'none' : 'var(--line)'} />
              <text x={mx} y={my + 5} textAnchor="middle" fontSize="14" fontWeight="600" fill={bad ? '#fff' : 'var(--ink)'}>{e.label}</text>
            </g>
          );
        })}
        {graph.nodes.map((nd, i) => {
          const p = pos[i];
          const w = Math.min(200, 26 + short(nd.label).length * 7.4);
          return (
            <motion.g key={nd.id} {...enter(i, { y: 0, scale: 0.7, spring: 'pop' })} style={{ transformOrigin: `${p.x}px ${p.y}px`, cursor: onPick && !nd.ext ? 'pointer' : 'default' }}
              onClick={() => !nd.ext && onPick?.(nd.id)} {...tip(<div><b>{nd.label}</b>{nd.internal ? <div>{nd.internal} internal</div> : null}</div>)}>
              <rect x={p.x - w / 2} y={p.y - 22} width={w} height={44} rx={12} fill="var(--surface)" stroke={TONE[nd.tone] || 'var(--ink)'} strokeWidth={nd.ext ? 1.4 : 2.4} strokeDasharray={nd.ext ? '5 4' : undefined} />
              <circle cx={p.x - w / 2 + 15} cy={p.y} r="5" fill={TONE[nd.tone] || 'var(--ink)'} />
              <text x={p.x - w / 2 + 27} y={p.y + 5} fontSize="15" fontWeight="560" fill="var(--ink)">{short(nd.label)}</text>
            </motion.g>
          );
        })}
      </svg>
      <table className="sr"><thead><tr><th>From</th><th>To</th><th>Count</th><th>Conflicts</th></tr></thead><tbody>{graph.edges.map((e) => <tr key={`${e.from}-${e.to}`}><td>{graph.nodes.find((x) => x.id === e.from)?.label}</td><td>{graph.nodes.find((x) => x.id === e.to)?.label}</td><td>{e.count}</td><td>{e.conflicts}</td></tr>)}</tbody></table>
    </figure>
  );
}
