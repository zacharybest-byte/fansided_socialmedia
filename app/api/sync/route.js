import { createClient } from '@/lib/meta';
import { postgresStore } from '@/lib/db';
import { runSync } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization');
  const key = new URL(request.url).searchParams.get('key');
  return header === `Bearer ${secret}` || key === secret;
}

// Vercel Cron calls this daily. Run it by hand (e.g. the first time, to pull 90 days of history):
//   https://<your-app>.vercel.app/api/sync?key=<CRON_SECRET>&days=90
export async function GET(request) {
  if (!authorized(request)) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const days = Number(new URL(request.url).searchParams.get('days') || 3);
  try {
    const client = createClient({ token: process.env.META_SYSTEM_USER_TOKEN });
    const result = await runSync({ client, store: postgresStore(), days, businessId: process.env.META_BUSINESS_ID || null });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
