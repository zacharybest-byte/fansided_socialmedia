// Shows what the Meta token can see, without revealing any token.
//   https://<your-app>.vercel.app/api/debug?key=<CRON_SECRET>
export const dynamic = 'force-dynamic';

const V = process.env.META_API_VERSION || 'v26.0';

async function graph(path, token) {
  const url = new URL(`https://graph.facebook.com/${V}/${path}`);
  url.searchParams.set('access_token', token);
  try {
    const res = await fetch(url);
    const body = await res.json();
    return body.error ? { error: `${body.error.message} (code ${body.error.code})` } : body;
  } catch (e) {
    return { error: e.message };
  }
}

export async function GET(request) {
  const secret = (process.env.CRON_SECRET || '').trim();
  const key = (new URL(request.url).searchParams.get('key') || '').trim();
  if (!secret || key !== secret) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const token = (process.env.META_SYSTEM_USER_TOKEN || '')
    .replace(/\s+/g, '').replace(/^["']|["']$/g, '').replace(/^Bearer/i, '');

  const [me, perms, accounts, assigned] = await Promise.all([
    graph('me?fields=id,name', token),
    graph('me/permissions', token),
    graph('me/accounts?fields=id,name,tasks&limit=100', token),
    graph('me/assigned_pages?fields=id,name&limit=100', token),
  ]);

  const summarize = (r) => (r.error ? { error: r.error } : {
    countOnFirstPage: r.data?.length ?? 0,
    morePages: !!r.paging?.next,
    examples: (r.data || []).slice(0, 5).map((p) => ({ id: p.id, name: p.name, tasks: p.tasks })),
  });

  return Response.json({
    apiVersion: V,
    tokenLooksValid: token.startsWith('EAA'),
    tokenLength: token.length,
    whoAmI: me,
    permissions: perms.error ? perms : (perms.data || []).map((p) => `${p.permission}: ${p.status}`),
    meAccounts: summarize(accounts),
    meAssignedPages: summarize(assigned),
  });
}
