#!/usr/bin/env node
// One-off helper: give the (non-admin) dashboard system user Insights access to every Page the
// business owns, without clicking through Business Settings. Also reports exactly which Pages
// can't be assigned and why.
//
// Usage (run on your own computer, Node 18+):
//   ADMIN_USER_TOKEN=...  BUSINESS_ID=...  SYSTEM_USER_ID=...  node scripts/assign-pages.mjs
//   add DRY_RUN=1 to only list what would happen.
//
// ADMIN_USER_TOKEN: a short-lived token for YOUR personal login (Graph API Explorer, with
//   business_management + pages_show_list). It's only used for this run and never saved.
// SYSTEM_USER_ID: Business Settings > System users > dashboard > the ID under its name.
// TASKS: optional, default ANALYZE (= Insights).

const { ADMIN_USER_TOKEN: token, BUSINESS_ID: biz, SYSTEM_USER_ID: sysUser } = process.env;
const TASKS = (process.env.TASKS || 'ANALYZE').split(',').map((t) => t.trim().toUpperCase());
const DRY = !!process.env.DRY_RUN;
const V = process.env.META_API_VERSION || 'v26.0';

if (!token || !biz || !sysUser) {
  console.error('Set ADMIN_USER_TOKEN, BUSINESS_ID and SYSTEM_USER_ID. See the comment at the top of this file.');
  process.exit(1);
}

async function graph(path, { method = 'GET', params = {} } = {}) {
  const url = path.startsWith('http') ? new URL(path) : new URL(`https://graph.facebook.com/${V}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(path.startsWith('http') ? url : `${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (json.error) throw Object.assign(new Error(json.error.message), { code: json.error.code });
  return json;
}

async function allPages() {
  const out = [];
  let r = await graph(`${biz}/owned_pages`, { params: { fields: 'id,name', limit: '100' } });
  out.push(...r.data);
  while (r.paging?.next) { r = await graph(r.paging.next); out.push(...r.data); }
  return out;
}

const pages = await allPages();
console.log(`${pages.length} Pages owned by business ${biz}. Assigning tasks ${TASKS.join(', ')} to system user ${sysUser}${DRY ? ' (dry run)' : ''}…\n`);

const failed = [];
let ok = 0;
for (const [i, p] of pages.entries()) {
  if (DRY) { console.log(`  would assign: ${p.name} (${p.id})`); continue; }
  try {
    await graph(`${p.id}/assigned_users`, { method: 'POST', params: { user: sysUser, tasks: JSON.stringify(TASKS), business: biz } });
    ok++;
  } catch (e) {
    failed.push({ ...p, error: e.message });
  }
  if ((i + 1) % 25 === 0) console.log(`  ${i + 1}/${pages.length}…`);
  await new Promise((r) => setTimeout(r, 150)); // stay well under rate limits
}

if (!DRY) {
  console.log(`\nAssigned: ${ok}   Failed: ${failed.length}`);
  if (failed.length) {
    console.log('\nPages that could not be assigned (usually: your login lacks full control of that Page):');
    for (const f of failed) console.log(`  - ${f.name} (${f.id}): ${f.error}`);
  }
}
