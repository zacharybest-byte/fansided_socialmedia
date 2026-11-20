import { sql, ensureSchema } from './db.js';

const num = (v) => (v === null || v === undefined ? null : Number(v));

// One row per active Page with current followers, growth, and 28-day totals.
export async function getPageRows() {
  await ensureSchema();
  const rows = await sql()`
    WITH latest AS (
      SELECT DISTINCT ON (page_id) page_id, followers FROM snapshots
      WHERE followers IS NOT NULL ORDER BY page_id, snap_date DESC
    ), d7 AS (
      SELECT DISTINCT ON (page_id) page_id, followers FROM snapshots
      WHERE followers IS NOT NULL AND snap_date <= current_date - 7 ORDER BY page_id, snap_date DESC
    ), d30 AS (
      SELECT DISTINCT ON (page_id) page_id, followers FROM snapshots
      WHERE followers IS NOT NULL AND snap_date <= current_date - 30 ORDER BY page_id, snap_date DESC
    ), m28 AS (
      SELECT page_id,
        SUM(value) FILTER (WHERE metric = 'page_media_view')             AS views,
        SUM(value) FILTER (WHERE metric = 'page_total_media_view_unique') AS viewers,
        SUM(value) FILTER (WHERE metric = 'page_post_engagements')       AS engagements,
        SUM(value) FILTER (WHERE metric = 'page_video_views')            AS video_views,
        SUM(value) FILTER (WHERE metric = 'page_daily_follows_unique')   AS follows,
        SUM(value) FILTER (WHERE metric = 'page_daily_unfollows_unique') AS unfollows,
        SUM(value) FILTER (WHERE metric = 'page_views_total')            AS profile_visits
      FROM daily_metrics WHERE metric_date > current_date - 29
      GROUP BY page_id
    )
    SELECT p.id, p.name, p.username, p.link, p.category, p.picture, p.fans, p.last_synced, p.last_error,
      COALESCE(latest.followers, p.followers) AS followers,
      d7.followers AS followers_7d_ago, d30.followers AS followers_30d_ago,
      m28.views, m28.viewers, m28.engagements, m28.video_views, m28.follows, m28.unfollows, m28.profile_visits
    FROM pages p
    LEFT JOIN latest ON latest.page_id = p.id
    LEFT JOIN d7 ON d7.page_id = p.id
    LEFT JOIN d30 ON d30.page_id = p.id
    LEFT JOIN m28 ON m28.page_id = p.id
    WHERE p.active
    ORDER BY followers DESC NULLS LAST`;

  return rows.map((r) => {
    const followers = num(r.followers);
    const f7 = num(r.followers_7d_ago);
    const f30 = num(r.followers_30d_ago);
    const engagements = num(r.engagements);
    const views = num(r.views);
    return {
      id: r.id, name: r.name, username: r.username, link: r.link, category: r.category,
      picture: r.picture, lastSynced: r.last_synced, lastError: r.last_error,
      followers, fans: num(r.fans),
      change7: followers !== null && f7 !== null ? followers - f7 : null,
      change30: followers !== null && f30 !== null ? followers - f30 : null,
      pct30: followers !== null && f30 ? (followers - f30) / f30 : null,
      views, viewers: num(r.viewers), engagements, videoViews: num(r.video_views),
      follows: num(r.follows), unfollows: num(r.unfollows), profileVisits: num(r.profile_visits),
      engagementRate: views ? engagements / views : null,
    };
  });
}

// Network-wide daily totals. Follower totals only count days where nearly every Page reported,
// so a missed sync doesn't show up as a fake drop.
export async function getNetworkSeries(days = 90) {
  await ensureSchema();
  const followers = await sql()`
    WITH per_day AS (
      SELECT snap_date, SUM(followers) AS total, COUNT(*) AS n FROM snapshots s
      JOIN pages p ON p.id = s.page_id AND p.active
      WHERE followers IS NOT NULL AND snap_date > current_date - ${days}::int
      GROUP BY snap_date
    )
    SELECT snap_date AS date, total FROM per_day
    WHERE n >= 0.95 * (SELECT MAX(n) FROM per_day)
    ORDER BY snap_date`;
  const metrics = await sql()`
    SELECT metric_date AS date, metric, SUM(value) AS total FROM daily_metrics d
    JOIN pages p ON p.id = d.page_id AND p.active
    WHERE metric_date > current_date - ${days}::int
      AND metric IN ('page_media_view', 'page_post_engagements', 'page_daily_follows_unique', 'page_daily_unfollows_unique')
    GROUP BY metric_date, metric ORDER BY metric_date`;
  return { followers: toSeries(followers), metrics: groupMetrics(metrics) };
}

export async function getPage(id) {
  await ensureSchema();
  const [page] = await sql()`SELECT * FROM pages WHERE id = ${id}`;
  if (!page) return null;
  const followers = await sql()`
    SELECT snap_date AS date, followers AS total FROM snapshots
    WHERE page_id = ${id} AND followers IS NOT NULL AND snap_date > current_date - 365
    ORDER BY snap_date`;
  const metrics = await sql()`
    SELECT metric_date AS date, metric, value AS total FROM daily_metrics
    WHERE page_id = ${id} AND metric_date > current_date - 90 ORDER BY metric_date`;
  return { page, followers: toSeries(followers), metrics: groupMetrics(metrics) };
}

export async function getLastRun() {
  await ensureSchema();
  const [run] = await sql()`SELECT * FROM sync_runs ORDER BY id DESC LIMIT 1`;
  return run || null;
}

const dateStr = (d) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10));

function toSeries(rows) {
  return rows.map((r) => ({ date: dateStr(r.date), value: Number(r.total) }));
}

function groupMetrics(rows) {
  const out = {};
  for (const r of rows) (out[r.metric] ||= []).push({ date: dateStr(r.date), value: Number(r.total) });
  return out;
}
