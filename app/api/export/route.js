import { getPageRows } from '@/lib/queries';

export const dynamic = 'force-dynamic';

const COLS = [
  ['Page ID', 'id'], ['Page', 'name'], ['Username', 'username'], ['Category', 'category'], ['Link', 'link'],
  ['Followers', 'followers'], ['Page likes', 'fans'], ['7-day change', 'change7'], ['30-day change', 'change30'],
  ['30-day % change', 'pct30'], ['Views (28d)', 'views'], ['Unique viewers (28d, summed daily)', 'viewers'],
  ['Engagements (28d)', 'engagements'], ['Engagement rate', 'engagementRate'], ['Video views (28d)', 'videoViews'],
  ['New follows (28d)', 'follows'], ['Unfollows (28d)', 'unfollows'], ['Profile visits (28d)', 'profileVisits'],
  ['Est. earnings USD (28d)', 'earnings'], ['Content Monetization USD (28d)', 'contentMonetization'],
  ['Earnings per 1K views', 'rpm'], ['Monetization-qualified views (28d)', 'qualifiedViews'],
];

const cell = (v) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export async function GET() {
  const rows = await getPageRows();
  const csv = [COLS.map(([h]) => h).join(','), ...rows.map((r) => COLS.map(([, k]) => cell(r[k])).join(','))].join('\n');
  const date = new Date().toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="facebook-pages-${date}.csv"`,
    },
  });
}
