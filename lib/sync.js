import { DAILY_METRICS, isoDate } from './meta.js';

// Run `fn` over `items` with at most `limit` in flight.
export async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

function dedupe(rows) {
  const map = new Map();
  for (const r of rows) map.set(`${r.date}|${r.metric}`, r);
  return [...map.values()];
}

/**
 * Pull every Page the system user can see and store today's numbers.
 * @param {object} opts
 * @param {object} opts.client   from createClient()
 * @param {object} opts.store    from postgresStore()
 * @param {number} opts.days     how many days of daily insights to (re)fetch, 1–90. Default 3 to fill gaps.
 * @param {number} opts.concurrency
 * @param {Date}   opts.now
 */
export async function runSync({ client, store, days = 3, concurrency = 12, now = new Date(), revenue = true }) {
  days = Math.max(1, Math.min(90, Math.floor(days) || 3));
  await store.ensureSchema();
  const runId = await store.startRun();

  const today = isoDate(now);
  const until = new Date(now); until.setUTCDate(until.getUTCDate() + 1);
  const since = new Date(now); since.setUTCDate(since.getUTCDate() - days);

  let pages;
  try {
    pages = await client.listPages();
  } catch (e) {
    await store.finishRun(runId, { total: 0, ok: 0, failed: 0, notes: `Could not list pages: ${e.message}` });
    throw e;
  }

  // Metrics Meta has rejected this run are dropped for the remaining pages.
  let metrics = [...DAILY_METRICS];
  const rejected = new Set();
  const failures = [];
  const revenueInvalid = new Set();
  const revenueNoAccess = new Map();
  const revenueReasons = new Map();
  const revenueSamples = {};
  let pagesWithRevenue = 0;

  const results = await pool(pages, concurrency, async (p) => {
    try {
      await store.upsertPage({
        id: p.id,
        name: p.name,
        username: p.username || null,
        link: p.link || null,
        category: p.category || null,
        picture: p.picture?.data?.url || null,
        fans: p.fan_count ?? null,
        followers: p.followers_count ?? null,
      });
      await store.upsertSnapshot(p.id, today, p.followers_count ?? null, p.fan_count ?? null);

      const active = metrics.filter((m) => !rejected.has(m));
      if (active.length) {
        const { rows, rejected: bad } = await client.pageInsights(p.id, p.access_token, active, isoDate(since), isoDate(until));
        bad.forEach((m) => rejected.add(m));
        const clean = dedupe(rows.filter((r) => r.date < today)); // today is partial
        await store.upsertMetrics(p.id, clean);
        await store.backfillSnapshots(p.id, clean.filter((r) => r.metric === 'page_follows'));
      }

      if (revenue) {
        const rev = await client.pageRevenue(p.id, p.access_token, isoDate(since), isoDate(until), revenueInvalid);
        for (const u of rev.unavailable) {
          if (u.code === 100) revenueInvalid.add(u.metric);
          else revenueNoAccess.set(u.metric, (revenueNoAccess.get(u.metric) || 0) + 1);
          revenueReasons.set(u.metric, u.reason);
        }
        for (const [m, raw] of Object.entries(rev.samples)) if (!revenueSamples[m]) revenueSamples[m] = raw;
        const revRows = dedupe(rev.rows.filter((r) => r.date < today));
        if (revRows.some((r) => r.value)) pagesWithRevenue++;
        await store.upsertMetrics(p.id, revRows);
      }
      return true;
    } catch (e) {
      failures.push(`${p.name} (${p.id}): ${e.message}`);
      try { await store.markPageError(p.id, e.message); } catch {}
      return false;
    }
  });

  await store.deactivateMissing(pages.map((p) => p.id));

  const ok = results.filter(Boolean).length;
  const revenueSummary = revenue ? {
    pagesWithRevenue,
    invalidMetrics: [...revenueInvalid],
    noAccess: Object.fromEntries(revenueNoAccess),
    reasons: Object.fromEntries(revenueReasons),
    samples: revenueSamples,
  } : null;

  const notes = [
    rejected.size ? `Metrics rejected by Meta: ${[...rejected].join(', ')}` : '',
    revenue ? `Revenue: ${pagesWithRevenue} pages reported earnings.` : '',
    revenueNoAccess.size
      ? `Revenue not available (pages): ${[...revenueNoAccess].map(([m, n]) => `${m} ×${n} — ${revenueReasons.get(m)}`).join('; ')}` : '',
    revenueInvalid.size ? `Revenue metrics rejected by Meta: ${[...revenueInvalid].join(', ')}` : '',
    Object.keys(revenueSamples).length ? `Revenue raw value samples: ${JSON.stringify(revenueSamples).slice(0, 600)}` : '',
    failures.length ? `Failures:\n${failures.slice(0, 50).join('\n')}` : '',
  ].filter(Boolean).join('\n') || null;

  await store.finishRun(runId, { total: pages.length, ok, failed: pages.length - ok, notes });
  return { runId, total: pages.length, ok, failed: pages.length - ok, rejectedMetrics: [...rejected], revenue: revenueSummary, failures };
}
