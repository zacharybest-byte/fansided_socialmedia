import { createClient } from '@/lib/meta';
import { postgresStore } from '@/lib/db';
import { runSync } from '@/lib/sync';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Returns null if authorized, otherwise a reason (never reveals the secret).
function authError(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  if (!secret) return 'CRON_SECRET is not set in this deployment. Add it in Vercel > Settings > Environment Variables (Production), then redeploy.';
  const header = request.headers.get('authorization');
  const key = (new URL(request.url).searchParams.get('key') || '').trim();
  if (header === `Bearer ${secret}` || key === secret) return null;
  if (!key) return 'No ?key= in the URL.';
  return `The key in the URL doesn't match CRON_SECRET (URL key is ${key.length} characters, CRON_SECRET is ${secret.length}). Check for typos, extra spaces, or symbols like & # + ? in the secret.`;
}

// Vercel Cron calls this daily. Run it by hand (e.g. the first time, to pull 90 days of history):
//   https://<your-app>.vercel.app/api/sync?key=<CRON_SECRET>&days=90
export async function GET(request) {
  const reason = authError(request);
  if (reason) return Response.json({ error: 'Unauthorized', reason }, { status: 401 });

  const days = Number(new URL(request.url).searchParams.get('days') || 3);
  try {
    // Tolerate copy/paste noise: whitespace, line breaks, wrapping quotes, a "Bearer " prefix.
    const token = (process.env.META_SYSTEM_USER_TOKEN || '')
      .replace(/\s+/g, '').replace(/^["']|["']$/g, '').replace(/^Bearer/i, '');
    const client = createClient({ token });
    const result = await runSync({ client, store: postgresStore(), days, businessId: process.env.META_BUSINESS_ID || null });
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
