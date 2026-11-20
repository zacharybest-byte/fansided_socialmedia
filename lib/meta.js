// Minimal Meta Graph API client for Facebook Page data.

export const API_VERSION = process.env.META_API_VERSION || 'v26.0';
const BASE = 'https://graph.facebook.com';

// Page-level daily metrics we try to collect (current names, v26).
// Any metric Meta rejects is skipped automatically and reported in the sync log.
export const DAILY_METRICS = [
  'page_follows',                   // lifetime follower count, by day
  'page_daily_follows_unique',      // new follows
  'page_daily_unfollows_unique',    // unfollows
  'page_media_view',                // views (replaces impressions)
  'page_total_media_view_unique',   // unique viewers
  'page_post_engagements',          // reactions, comments, shares, clicks
  'page_actions_post_reactions_total',
  'page_views_total',               // profile visits
  'page_total_actions',             // CTA / contact clicks
  'page_video_views',               // 3s+ video plays
  'page_video_complete_views_30s',  // 30s+ video plays
  'page_video_view_time',           // ms watched
];

// Monetization metrics. Fetched one per call so a Page that isn't monetized (or a metric the
// token can't see) never blocks the rest. Stored in cents under the names below.
export const REVENUE_METRICS = {
  monetization_approximate_earnings: 'rev_approximate_cents',      // all monetization tools
  content_monetization_earnings: 'rev_content_monetization_cents', // Content Monetization program
  page_daily_video_ad_break_earnings_by_crosspost_status: 'rev_video_ad_break_cents', // legacy in-stream ads
};
export const REVENUE_COUNT_METRICS = ['creator_monetization_qualified_views'];

// Meta error codes worth retrying (throttling / transient).
const RETRY_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80001]);

export class GraphError extends Error {
  constructor(message, { code, subcode, status } = {}) {
    super(message);
    this.code = code;
    this.subcode = subcode;
    this.status = status;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ token, fetchImpl = fetch, version = API_VERSION, base = BASE, retryDelayMs = 2000 } = {}) {
  if (!token) throw new Error('META_SYSTEM_USER_TOKEN is not set');

  async function request(pathOrUrl, params = {}, accessToken = token) {
    let url;
    if (pathOrUrl.startsWith('http')) {
      url = new URL(pathOrUrl); // paging "next" URLs already carry params + token
    } else {
      url = new URL(`${base}/${version}/${pathOrUrl.replace(/^\//, '')}`);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
      url.searchParams.set('access_token', accessToken);
    }

    for (let attempt = 0; ; attempt++) {
      let res, body;
      try {
        res = await fetchImpl(url.toString());
        body = await res.json();
      } catch (e) {
        if (attempt < 3) { await sleep(retryDelayMs * 2 ** attempt); continue; }
        throw new GraphError(`Network error: ${e.message}`);
      }
      if (res.ok && !body.error) return body;

      const err = body?.error || {};
      const retryable = RETRY_CODES.has(err.code) || res.status >= 500;
      if (retryable && attempt < 3) { await sleep(retryDelayMs * 2 ** attempt); continue; }
      throw new GraphError(err.message || `HTTP ${res.status}`, {
        code: err.code, subcode: err.error_subcode, status: res.status,
      });
    }
  }

  async function paginate(path, params) {
    const out = [];
    let body = await request(path, params);
    out.push(...(body.data || []));
    while (body.paging?.next) {
      body = await request(body.paging.next);
      out.push(...(body.data || []));
    }
    return out;
  }

  const PAGE_FIELDS = 'id,name,username,link,category,fan_count,followers_count,picture{url}';

  // All Pages the token can reach, each with a Page token.
  // - Pages assigned to the system user come from /me/accounts.
  // - If businessId is set (admin system user), every Page the business owns is added too,
  //   so nothing has to be assigned one by one in Business Settings.
  async function listPages(businessId) {
    const byId = new Map();
    for (const p of await paginate('me/accounts', { fields: `${PAGE_FIELDS},access_token`, limit: 100 })) byId.set(p.id, p);

    // Some system-user setups return nothing from /me/accounts; their Pages are under /me/assigned_pages.
    try {
      for (const p of await paginate('me/assigned_pages', { fields: PAGE_FIELDS, limit: 100 })) {
        if (!byId.has(p.id)) byId.set(p.id, p);
      }
    } catch { /* edge not available for this token; ignore */ }

    if (businessId) {
      for (const edge of ['owned_pages', 'client_pages']) {
        let list = [];
        try {
          list = await paginate(`${businessId}/${edge}`, { fields: PAGE_FIELDS, limit: 100 });
        } catch (e) {
          if (edge === 'owned_pages') throw e; // client_pages is optional
        }
        for (const p of list) if (!byId.has(p.id)) byId.set(p.id, p);
      }
    }
    // Fetch a Page token for Pages that /me/accounts didn't return.
    const missing = [...byId.values()].filter((p) => !p.access_token);
    await Promise.all(missing.map(async (p) => {
      try {
        const r = await request(p.id, { fields: 'access_token' });
        if (r.access_token) p.access_token = r.access_token;
      } catch { /* fall back to the system-user token for this Page */ }
    }));
    return [...byId.values()];
  }

  // Daily insights for one Page between since/until (YYYY-MM-DD, max 90 days apart).
  // Returns { rows: [{metric, date, value}], rejected: [metric] }.
  async function pageInsights(pageId, pageToken, metrics, since, until) {
    const fetchMetrics = (list) =>
      request(`${pageId}/insights`, { metric: list.join(','), period: 'day', since, until }, pageToken || token);

    const rejected = [];
    let data = [];
    try {
      data = (await fetchMetrics(metrics)).data || [];
    } catch (e) {
      // Code 100 = one of the metrics is invalid/deprecated. Retry one at a time to find it.
      if (e.code !== 100 || metrics.length === 1) throw e;
      for (const m of metrics) {
        try {
          data.push(...((await fetchMetrics([m])).data || []));
        } catch (inner) {
          if (inner.code === 100) rejected.push(m);
          else throw inner;
        }
      }
    }

    const rows = [];
    for (const series of data) {
      for (const point of series.values || []) {
        const value = toNumber(point.value);
        if (value === null || !point.end_time) continue;
        rows.push({ metric: series.name, date: endTimeToDate(point.end_time), value });
      }
    }
    return { rows, rejected };
  }

  // Daily earnings for one Page. Returns { rows, unavailable: [{metric, reason}], samples: {metric: rawValue} }.
  // Earnings rows are stored in cents; qualified views as counts.
  async function pageRevenue(pageId, pageToken, since, until, skip = new Set()) {
    const rows = [], unavailable = [], samples = {};
    const metrics = [...Object.keys(REVENUE_METRICS), ...REVENUE_COUNT_METRICS].filter((m) => !skip.has(m));
    const responses = await Promise.all(metrics.map(async (metric) => {
      try {
        return { metric, data: (await request(`${pageId}/insights`, { metric, period: 'day', since, until }, pageToken || token)).data || [] };
      } catch (e) {
        // 100 = invalid metric, 10/200 = no monetization access, 3001 = not eligible. Skip, don't fail the Page.
        if ([100, 10, 200, 3001].includes(e.code) || e.status === 400) return { metric, error: e };
        throw e;
      }
    }));
    for (const { metric, data, error } of responses) {
      if (error) {
        unavailable.push({ metric, code: error.code, reason: error.message });
        continue;
      }
      const stored = REVENUE_METRICS[metric] || metric;
      for (const series of data) {
        for (const point of series.values || []) {
          if (!point.end_time) continue;
          if (point.value && samples[metric] === undefined) samples[metric] = point.value;
          const value = REVENUE_METRICS[metric] ? moneyToCents(point.value) : toNumber(point.value);
          if (value === null) continue;
          rows.push({ metric: stored, date: endTimeToDate(point.end_time), value });
        }
      }
    }
    return { rows, unavailable, samples };
  }

  return { request, paginate, listPages, pageInsights, pageRevenue };
}

// Earnings come back as a plain number (dollars), a money object, or a breakdown object.
// Returns integer cents, or null if the shape isn't recognised.
export function moneyToCents(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Math.round(v * 100);
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Math.round(Number(v) * 100);
  if (typeof v === 'object') {
    for (const k of ['micro_amount', 'microAmount']) if (k in v) return Math.round(Number(v[k]) / 10000);
    for (const k of ['amount', 'value', 'total']) if (k in v) return moneyToCents(v[k]);
    // breakdown, e.g. { crossposted: 1.2, original: 3.4 } or { reels: {...}, videos: {...} }
    let sum = 0, any = false;
    for (const x of Object.values(v)) {
      const c = moneyToCents(x);
      if (c !== null) { sum += c; any = true; }
    }
    return any ? sum : null;
  }
  return null;
}

// Breakdown metrics return an object ({like: 10, love: 2}); store their total.
export function toNumber(v) {
  if (typeof v === 'number') return Math.round(v);
  if (v && typeof v === 'object') {
    let sum = 0;
    for (const x of Object.values(v)) if (typeof x === 'number') sum += x;
    return Math.round(sum);
  }
  return null;
}

// Meta stamps a day's value with the *end* of that day (e.g. "2026-11-20T08:00:00+0000"
// is the value for Nov 19 in Pacific time). Shift back one day to get the day it describes.
export function endTimeToDate(endTime) {
  const d = new Date(endTime);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function isoDate(d) {
  return d.toISOString().slice(0, 10);
}
