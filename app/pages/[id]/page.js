import { notFound } from 'next/navigation';
import { getPage, earningsCents } from '@/lib/queries';
import { fmt, compact, signed, pct, trendClass } from '@/lib/format';
import LineChart from '../../components/LineChart';

export const dynamic = 'force-dynamic';

const total = (s) => (s?.length ? s.slice(-28).reduce((a, d) => a + d.value, 0) : null);

function changeOver(series, days) {
  if (!series.length) return null;
  const last = series[series.length - 1];
  const cutoff = new Date(`${last.date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - days);
  const iso = cutoff.toISOString().slice(0, 10);
  const prior = [...series].reverse().find((d) => d.date <= iso);
  return prior ? last.value - prior.value : null;
}

export default async function PageDetail({ params }) {
  const { id } = await params;
  const data = await getPage(id);
  if (!data) notFound();
  const { page, followers, metrics: m } = data;

  const views = total(m.page_media_view);
  const engagements = total(m.page_post_engagements);
  const c7 = changeOver(followers, 7);
  const c30 = changeOver(followers, 30);

  const unf = new Map((m.page_daily_unfollows_unique || []).map((d) => [d.date, d.value]));
  const net = (m.page_daily_follows_unique || []).map((d) => ({ date: d.date, value: d.value - (unf.get(d.date) || 0) }));

  // Daily earnings in dollars (approximate all-tools figure, else program metrics).
  const byDate = new Map();
  for (const [key, field] of [['rev_approximate_cents', 'a'], ['rev_content_monetization_cents', 'c'], ['rev_video_ad_break_cents', 'b']]) {
    for (const d of m[key] || []) {
      const row = byDate.get(d.date) || { a: null, c: null, b: null };
      row[field] = d.value;
      byDate.set(d.date, row);
    }
  }
  const earnings = [...byDate].sort(([x], [y]) => x.localeCompare(y))
    .map(([date, r]) => ({ date, value: (earningsCents(r.a, r.c, r.b) || 0) / 100 }));
  const earnings28 = earnings.length ? earnings.slice(-28).reduce((a, d) => a + d.value, 0) : null;
  const money = (n) => (n === null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
  const cm28 = total(m.rev_content_monetization_cents);
  const qv28 = total(m.creator_monetization_qualified_views);

  const charts = [
    ['Followers', followers, false],
    ['Net new followers per day', net, true],
    ['Daily views', m.page_media_view, true],
    ['Daily unique viewers', m.page_total_media_view_unique, true],
    ['Daily engagements', m.page_post_engagements, true],
    ['Daily post reactions', m.page_actions_post_reactions_total, true],
    ['Daily video views (3s+)', m.page_video_views, true],
    ['Daily profile visits', m.page_views_total, true],
    ['Daily estimated earnings (USD)', earnings, true],
    ['Daily monetization-qualified views', m.creator_monetization_qualified_views, true],
  ];

  return (
    <>
      <p><a href="/" className="muted">← All pages</a></p>
      <div className="page-cell" style={{ marginBottom: 4 }}>
        {page.picture && <img src={page.picture} alt="" style={{ width: 40, height: 40 }} />}
        <h1>{page.name}</h1>
      </div>
      <p className="sub">
        {page.category || 'Facebook Page'}
        {page.link && <> · <a href={page.link} target="_blank" rel="noreferrer">Open on Facebook</a></>}
        {page.last_error && <span className="warn"> · Last sync error: {page.last_error}</span>}
      </p>

      <div className="tiles">
        <div className="tile"><div className="label">Followers</div><div className="value">{fmt(Number(page.followers))}</div></div>
        <div className="tile"><div className="label">Page likes</div><div className="value">{fmt(Number(page.fans))}</div></div>
        <div className="tile"><div className="label">7-day change</div><div className={`value ${trendClass(c7)}`}>{signed(c7)}</div></div>
        <div className="tile"><div className="label">30-day change</div><div className={`value ${trendClass(c30)}`}>{signed(c30)}</div></div>
        <div className="tile"><div className="label">Views (28d)</div><div className="value">{compact(views)}</div></div>
        <div className="tile">
          <div className="label">Engagements (28d)</div><div className="value">{compact(engagements)}</div>
          {views ? <div className="delta">{pct(engagements / views, 2)} of views</div> : null}
        </div>
        <div className="tile">
          <div className="label">Est. earnings (28d)</div><div className="value">{money(earnings28)}</div>
          {earnings28 !== null && views ? <div className="delta">{money(earnings28 / views * 1000)} per 1K views</div> : null}
        </div>
        <div className="tile">
          <div className="label">Content Monetization (28d)</div><div className="value">{money(cm28 === null ? null : cm28 / 100)}</div>
          {qv28 !== null ? <div className="delta">{compact(qv28)} qualified views</div> : null}
        </div>
      </div>

      <div className="charts">
        {charts.map(([title, series, zero]) => (
          <div className="card" key={title}>
            <h2>{title}</h2>
            <LineChart data={series} label={title} zeroBased={zero} />
          </div>
        ))}
      </div>
    </>
  );
}
