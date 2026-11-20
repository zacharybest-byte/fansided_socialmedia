'use client';

import { useMemo, useState } from 'react';
import { fmt, signed, pct, trendClass } from '@/lib/format';

const COLUMNS = [
  { key: 'name', label: 'Page', type: 'text' },
  { key: 'followers', label: 'Followers' },
  { key: 'change7', label: '7-day Δ', signed: true },
  { key: 'change30', label: '30-day Δ', signed: true },
  { key: 'pct30', label: '30-day %', pct: true },
  { key: 'views', label: 'Views (28d)' },
  { key: 'engagements', label: 'Engagements (28d)' },
  { key: 'engagementRate', label: 'Eng. rate', pct: true, digits: 2 },
  { key: 'videoViews', label: 'Video views (28d)' },
  { key: 'profileVisits', label: 'Profile visits (28d)' },
];

export default function PageTable({ rows }) {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState({ key: 'followers', dir: -1 });

  const categories = useMemo(
    () => [...new Set(rows.map((r) => r.category).filter(Boolean))].sort(),
    [rows],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const filtered = rows.filter((r) =>
      (!needle || r.name.toLowerCase().includes(needle) || (r.username || '').toLowerCase().includes(needle)) &&
      (!category || r.category === category));
    const { key, dir } = sort;
    return filtered.sort((a, b) => {
      const av = a[key], bv = b[key];
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return typeof av === 'string' ? av.localeCompare(bv) * dir : (av - bv) * dir;
    });
  }, [rows, q, category, sort]);

  const toggle = (key) =>
    setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: key === 'name' ? 1 : -1 }));

  return (
    <div className="card">
      <div className="controls">
        <input placeholder="Search pages…" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={category} onChange={(e) => setCategory(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <span className="muted">{shown.length} of {rows.length} pages</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((c) => (
                <th key={c.key} onClick={() => toggle(c.key)} className={sort.key === c.key ? 'sorted' : ''}>
                  {c.label}{sort.key === c.key ? (sort.dir > 0 ? ' ▲' : ' ▼') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id}>
                <td>
                  <div className="page-cell">
                    {r.picture && <img src={r.picture} alt="" />}
                    <div>
                      <a href={`/pages/${r.id}`}>{r.name}</a>
                      {r.lastError && <div className="warn" title={r.lastError}>Last sync failed</div>}
                    </div>
                  </div>
                </td>
                {COLUMNS.slice(1).map((c) => {
                  const v = r[c.key];
                  const text = c.signed ? signed(v) : c.pct ? pct(v, c.digits) : fmt(v);
                  return <td key={c.key} className={c.signed || c.key === 'pct30' ? trendClass(v) : ''}>{text}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
