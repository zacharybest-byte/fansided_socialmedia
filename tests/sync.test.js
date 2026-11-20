import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createClient, endTimeToDate, toNumber } from '../lib/meta.js';
import { runSync } from '../lib/sync.js';

// Fake Graph API: 250 pages (forces pagination), one deprecated metric, one page that errors.
function fakeGraph({ badMetric = 'page_video_view_time', failingPage = 'p7', throttleOnce = true } = {}) {
  const pages = Array.from({ length: 250 }, (_, i) => ({
    id: `p${i}`, name: `Page ${i}`, category: i % 2 ? 'Sports Team' : 'Media/News Company',
    fan_count: 1000 + i, followers_count: 2000 + i, access_token: `tok${i}`,
    picture: { data: { url: `https://img/${i}.jpg` } },
  }));
  let throttled = false;
  const calls = [];
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

  const fetchImpl = async (raw) => {
    const url = new URL(raw);
    calls.push(url.pathname);
    if (url.pathname.endsWith('/me/accounts')) {
      const after = Number(url.searchParams.get('after') || 0);
      const slice = pages.slice(after, after + 100);
      const next = after + 100 < pages.length
        ? `https://graph.test/v26.0/me/accounts?after=${after + 100}&access_token=x` : undefined;
      return json({ data: slice, paging: next ? { next } : {} });
    }
    const m = url.pathname.match(/\/v26\.0\/(p\d+)\/insights$/);
    if (m) {
      const pageId = m[1];
      if (throttleOnce && !throttled) { throttled = true; return json({ error: { code: 4, message: 'rate limit' } }, 400); }
      if (pageId === failingPage) return json({ error: { code: 190, message: 'token expired' } }, 400);
      const metrics = url.searchParams.get('metric').split(',');
      if (metrics.includes(badMetric)) return json({ error: { code: 100, message: 'invalid metric' } }, 400);
      assert.equal(url.searchParams.get('access_token'), `tok${pageId.slice(1)}`);
      return json({
        data: metrics.map((name) => ({
          name, period: 'day',
          values: [
            { end_time: '2026-11-18T08:00:00+0000', value: name === 'page_actions_post_reactions_total' ? { like: 3, love: 2 } : 10 },
            { end_time: '2026-11-19T08:00:00+0000', value: 12 },
            { end_time: '2026-11-20T08:00:00+0000', value: 15 },
            { end_time: '2026-11-21T08:00:00+0000', value: 1 }, // partial "today"
          ],
        })),
      });
    }
    return json({ error: { code: 803, message: 'unknown path ' + url.pathname } }, 404);
  };
  return { fetchImpl, calls };
}

function fakeStore() {
  const s = { pages: new Map(), snapshots: new Map(), metrics: new Map(), errors: new Map(), runs: [], deactivated: null };
  return {
    s,
    ensureSchema: async () => {},
    startRun: async () => s.runs.push({}) ,
    finishRun: async (id, r) => Object.assign(s.runs[id - 1], r),
    upsertPage: async (p) => s.pages.set(p.id, p),
    markPageError: async (id, msg) => s.errors.set(id, msg),
    deactivateMissing: async (ids) => { s.deactivated = ids; },
    upsertSnapshot: async (id, date, followers, fans) => s.snapshots.set(`${id}|${date}`, { followers, fans }),
    backfillSnapshots: async (id, pts) => pts.forEach((p) => {
      const k = `${id}|${p.date}`;
      if (!s.snapshots.has(k)) s.snapshots.set(k, { followers: p.value });
    }),
    upsertMetrics: async (id, rows) => rows.forEach((r) => s.metrics.set(`${id}|${r.date}|${r.metric}`, r.value)),
  };
}

test('date + value helpers', () => {
  assert.equal(endTimeToDate('2026-11-20T08:00:00+0000'), '2026-11-19');
  assert.equal(endTimeToDate('2026-03-01T08:00:00+0000'), '2026-02-28');
  assert.equal(toNumber(5), 5);
  assert.equal(toNumber({ like: 3, love: 2 }), 5);
  assert.equal(toNumber('x'), null);
});

test('full sync over 250 pages', async () => {
  const { fetchImpl } = fakeGraph();
  const client = createClient({ token: 'sys', fetchImpl, base: 'https://graph.test', version: 'v26.0', retryDelayMs: 1 });
  const store = fakeStore();
  const result = await runSync({ client, store, days: 3, now: new Date('2026-11-20T11:17:00Z') });

  assert.equal(result.total, 250);
  assert.equal(result.ok, 249);
  assert.equal(result.failed, 1);
  assert.match(result.failures[0], /p7.*token expired/);
  assert.deepEqual(result.rejectedMetrics, ['page_video_view_time']);
  assert.equal(store.s.pages.size, 250);
  assert.equal(store.s.deactivated.length, 250);

  // today's snapshot from followers_count
  assert.deepEqual(store.s.snapshots.get('p3|2026-11-20'), { followers: 2003, fans: 1003 });
  // historical follower counts backfilled from page_follows
  assert.deepEqual(store.s.snapshots.get('p3|2026-11-18'), { followers: 12 });
  // metrics: dates shifted, today's partial value dropped, breakdown summed
  assert.equal(store.s.metrics.get('p3|2026-11-17|page_actions_post_reactions_total'), 5);
  assert.equal(store.s.metrics.get('p3|2026-11-19|page_media_view'), 15);
  assert.equal(store.s.metrics.has('p3|2026-11-20|page_media_view'), false);
  assert.equal(store.s.metrics.has('p3|2026-11-19|page_video_view_time'), false);
  assert.equal(store.s.errors.get('p7'), 'token expired');
  assert.match(store.s.runs[0].notes, /page_video_view_time/);
});

test('missing token fails fast', () => {
  assert.throws(() => createClient({ token: '' }), /META_SYSTEM_USER_TOKEN/);
});
