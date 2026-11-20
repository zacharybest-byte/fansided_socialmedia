import { getPageRows, getNetworkSeries, getLastRun } from '@/lib/queries';
import { fmt, compact, signed, pct, trendClass } from '@/lib/format';
import LineChart from './components/LineChart';
import PageTable from './components/PageTable';

export const dynamic = 'force-dynamic';

function Tile({ label, value, delta, deltaValue }) {
  return (
    <div className="tile">
      <div className="label">{label}</div>
      <div className="value">{value}</div>
      {delta && <div className={`delta ${trendClass(deltaValue)}`}>{delta}</div>}
    </div>
  );
}

const sum = (rows, key) => {
  let total = 0, any = false;
  for (const r of rows) if (r[key] !== null && r[key] !== undefined) { total += r[key]; any = true; }
  return any ? total : null;
};

export default async function Home() {
  let rows, series, run;
  try {
    [rows, series, run] = await Promise.all([getPageRows(), getNetworkSeries(90), getLastRun()]);
  } catch (e) {
    return (
      <div className="notice">
        <h1>Setup needed</h1>
        <p>{e.message}</p>
        <p>See the README in the GitHub repo for the setup steps.</p>
      </div>
    );
  }

  if (!rows.length) {
    return (
      <div className="notice">
        <h1>No pages yet</h1>
        <p>Run the first sync (this also pulls up to 90 days of history):</p>
        <p><code>/api/sync?key=YOUR_CRON_SECRET&amp;days=90</code></p>
        {run?.notes && <pre className="warn">{run.notes}</pre>}
      </div>
    );
  }

  const followers = sum(rows, 'followers');
  const change7 = sum(rows, 'change7');
  const change30 = sum(rows, 'change30');
  const views = sum(rows, 'views');
  const engagements = sum(rows, 'engagements');
  const follows = sum(rows, 'follows');
  const unfollows = sum(rows, 'unfollows');
  const net = () => {
    const f = series.metrics.page_daily_follows_unique || [];
    const u = new Map((series.metrics.page_daily_unfollows_unique || []).map((d) => [d.date, d.value]));
    return f.map((d) => ({ date: d.date, value: d.value - (u.get(d.date) || 0) }));
  };

  return (
    <>
      <h1>All Facebook Pages</h1>
      <p className="sub">
        {rows.length} pages · last sync {run?.finished_at ? new Date(run.finished_at).toLocaleString('en-US', { timeZone: 'America/Chicago' }) + ' CT' : 'in progress'}
        {run?.pages_failed ? <span className="warn"> · {run.pages_failed} pages failed</span> : null}
      </p>

      <div className="tiles">
        <Tile label="Total followers" value={compact(followers)} />
        <Tile label="Followers, last 7 days" value={signed(change7)} deltaValue={change7}
          delta={followers && change7 !== null ? `${pct(change7 / (followers - change7), 2)} growth` : null} />
        <Tile label="Followers, last 30 days" value={signed(change30)} deltaValue={change30}
          delta={followers && change30 !== null ? `${pct(change30 / (followers - change30), 2)} growth` : null} />
        <Tile label="Views (28 days)" value={compact(views)} />
        <Tile label="Engagements (28 days)" value={compact(engagements)}
          delta={views ? `${pct(engagements / views, 2)} of views` : null} />
        <Tile label="New follows / unfollows (28d)" value={`${compact(follows)} / ${compact(unfollows)}`} />
      </div>

      <div className="charts">
        <div className="card"><h2>Total followers</h2><LineChart data={series.followers} label="Total followers over time" /></div>
        <div className="card"><h2>Net new followers per day</h2><LineChart data={net()} label="Net new followers per day" zeroBased /></div>
        <div className="card"><h2>Daily views</h2><LineChart data={series.metrics.page_media_view} label="Daily views" zeroBased /></div>
        <div className="card"><h2>Daily engagements</h2><LineChart data={series.metrics.page_post_engagements} label="Daily engagements" zeroBased /></div>
      </div>

      <PageTable rows={rows} />
      {run?.notes && (
        <details className="card" style={{ marginTop: 16 }}>
          <summary>Last sync notes</summary>
          <pre style={{ whiteSpace: 'pre-wrap' }}>{run.notes}</pre>
        </details>
      )}
    </>
  );
}
