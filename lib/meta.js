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

  // All Pages the system user has been assigned, with a Page token for each.
  async function listPages() {
    return paginate('me/accounts', {
      fields: 'id,name,username,link,category,fan_count,followers_count,picture{url},access_token',
      limit: 100,
    });
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

  return { request, paginate, listPages, pageInsights };
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
