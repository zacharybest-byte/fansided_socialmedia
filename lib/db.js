import { neon } from '@neondatabase/serverless';

let _sql;
export function sql() {
  if (!_sql) {
    const url = process.env.DATABASE_URL || process.env.POSTGRES_URL;
    if (!url) throw new Error('DATABASE_URL is not set — connect a Neon Postgres database in Vercel > Storage.');
    _sql = neon(url);
  }
  return _sql;
}

let schemaReady = false;
export async function ensureSchema() {
  if (schemaReady) return;
  const q = sql();
  await q`CREATE TABLE IF NOT EXISTS pages (
    id           text PRIMARY KEY,
    name         text NOT NULL,
    username     text,
    link         text,
    category     text,
    picture      text,
    fans         bigint,
    followers    bigint,
    active       boolean NOT NULL DEFAULT true,
    last_synced  timestamptz,
    last_error   text
  )`;
  await q`CREATE TABLE IF NOT EXISTS snapshots (
    page_id    text NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    snap_date  date NOT NULL,
    followers  bigint,
    fans       bigint,
    PRIMARY KEY (page_id, snap_date)
  )`;
  await q`CREATE TABLE IF NOT EXISTS daily_metrics (
    page_id      text NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
    metric_date  date NOT NULL,
    metric       text NOT NULL,
    value        bigint NOT NULL,
    PRIMARY KEY (page_id, metric_date, metric)
  )`;
  await q`CREATE INDEX IF NOT EXISTS daily_metrics_date_idx ON daily_metrics (metric_date, metric)`;
  await q`CREATE TABLE IF NOT EXISTS sync_runs (
    id            serial PRIMARY KEY,
    started_at    timestamptz NOT NULL DEFAULT now(),
    finished_at   timestamptz,
    pages_total   int,
    pages_ok      int,
    pages_failed  int,
    notes         text
  )`;
  schemaReady = true;
}

// Storage adapter used by the sync job (swapped for an in-memory fake in tests).
export function postgresStore() {
  const q = sql();
  return {
    ensureSchema,

    async startRun() {
      const [row] = await q`INSERT INTO sync_runs DEFAULT VALUES RETURNING id`;
      return row.id;
    },

    async finishRun(id, { total, ok, failed, notes }) {
      await q`UPDATE sync_runs SET finished_at = now(), pages_total = ${total},
              pages_ok = ${ok}, pages_failed = ${failed}, notes = ${notes} WHERE id = ${id}`;
    },

    async upsertPage(p) {
      await q`INSERT INTO pages (id, name, username, link, category, picture, fans, followers, active, last_synced, last_error)
              VALUES (${p.id}, ${p.name}, ${p.username}, ${p.link}, ${p.category}, ${p.picture},
                      ${p.fans}, ${p.followers}, true, now(), null)
              ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, username = EXCLUDED.username,
                link = EXCLUDED.link, category = EXCLUDED.category, picture = EXCLUDED.picture,
                fans = EXCLUDED.fans, followers = EXCLUDED.followers, active = true,
                last_synced = now(), last_error = null`;
    },

    async markPageError(id, message) {
      await q`UPDATE pages SET last_error = ${message.slice(0, 500)} WHERE id = ${id}`;
    },

    async deactivateMissing(activeIds) {
      await q`UPDATE pages SET active = false WHERE NOT (id = ANY(${activeIds}::text[]))`;
    },

    async upsertSnapshot(pageId, date, followers, fans) {
      await q`INSERT INTO snapshots (page_id, snap_date, followers, fans)
              VALUES (${pageId}, ${date}, ${followers}, ${fans})
              ON CONFLICT (page_id, snap_date) DO UPDATE SET followers = EXCLUDED.followers, fans = EXCLUDED.fans`;
    },

    // Historical follower counts from the page_follows metric; never overwrites a real snapshot.
    async backfillSnapshots(pageId, points) {
      if (!points.length) return;
      await q`INSERT INTO snapshots (page_id, snap_date, followers)
              SELECT ${pageId}, d, f FROM unnest(${points.map((p) => p.date)}::date[], ${points.map((p) => p.value)}::bigint[]) AS t(d, f)
              ON CONFLICT (page_id, snap_date) DO NOTHING`;
    },

    async upsertMetrics(pageId, rows) {
      if (!rows.length) return;
      await q`INSERT INTO daily_metrics (page_id, metric_date, metric, value)
              SELECT ${pageId}, d, m, v FROM unnest(
                ${rows.map((r) => r.date)}::date[],
                ${rows.map((r) => r.metric)}::text[],
                ${rows.map((r) => r.value)}::bigint[]) AS t(d, m, v)
              ON CONFLICT (page_id, metric_date, metric) DO UPDATE SET value = EXCLUDED.value`;
    },
  };
}
