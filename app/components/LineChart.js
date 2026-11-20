'use client';

import { useEffect, useRef, useState } from 'react';

const H = 200;
const M = { top: 12, right: 12, bottom: 24, left: 52 };

function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const step0 = (max - min) / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * mag).find((s) => s >= step0);
  const start = Math.floor(min / step) * step;
  const ticks = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(v);
  return ticks;
}

const compact = (n) => new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

/** Single-series line chart with crosshair + tooltip. data: [{date:'YYYY-MM-DD', value:number}] */
export default function LineChart({ data, label, color = 'var(--series-1)', zeroBased = false }) {
  const ref = useRef(null);
  const [width, setWidth] = useState(600);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  if (!data || data.length < 2) {
    return <div className="chart-empty">Not enough history yet — check back after a few daily syncs.</div>;
  }

  const values = data.map((d) => d.value);
  const ticks = niceTicks(zeroBased ? Math.min(0, ...values) : Math.min(...values), Math.max(...values));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const iw = width - M.left - M.right, ih = H - M.top - M.bottom;
  const x = (i) => M.left + (i / (data.length - 1)) * iw;
  const y = (v) => M.top + ih - ((v - yMin) / (yMax - yMin || 1)) * ih;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join('');

  const xLabelIdx = [0, Math.floor((data.length - 1) / 2), data.length - 1];

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const i = Math.round(((px - M.left) / iw) * (data.length - 1));
    setHover(Math.max(0, Math.min(data.length - 1, i)));
  }

  const h = hover !== null ? data[hover] : null;

  return (
    <div className="chart-wrap" ref={ref}>
      <svg height={H} role="img" aria-label={label} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={M.left} x2={width - M.right} y1={y(t)} y2={y(t)} stroke="var(--grid)" />
            <text x={M.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize="11" fill="var(--text-muted)">{compact(t)}</text>
          </g>
        ))}
        {xLabelIdx.map((i, k) => (
          <text key={k} x={x(i)} y={H - 6} fontSize="11" fill="var(--text-muted)"
            textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'}>{fmtDate(data[i].date)}</text>
        ))}
        <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {h && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} stroke="var(--text-muted)" strokeDasharray="3 3" />
            <circle cx={x(hover)} cy={y(h.value)} r="4.5" fill={color} stroke="var(--surface-1)" strokeWidth="2" />
          </g>
        )}
        <rect x={M.left} y={M.top} width={iw} height={ih} fill="transparent" />
      </svg>
      {h && (
        <div className="tooltip" style={{ left: x(hover), top: y(h.value) - 10 }}>
          <span className="muted">{fmtDate(h.date)}</span> · <b>{h.value.toLocaleString('en-US')}</b>
        </div>
      )}
    </div>
  );
}
