'use client';

// Bulk-assign Insights (ANALYZE) on every business-owned Page to the dashboard system user.
// Runs entirely in the browser: the pasted token is sent only to graph.facebook.com, never to our server.

import { useState } from 'react';

const V = 'v26.0';

async function graph(path, token, { method = 'GET', params = {} } = {}) {
  const isUrl = path.startsWith('http');
  const url = new URL(isUrl ? path : `https://graph.facebook.com/${V}/${path}`);
  const body = new URLSearchParams({ ...params, access_token: token });
  const res = method === 'GET'
    ? await fetch(isUrl ? url : `${url}?${body}`)
    : await fetch(url, { method, body });
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.message} (code ${json.error.code}${json.error.error_subcode ? `/${json.error.error_subcode}` : ''})`);
  return json;
}

export default function AssignTool() {
  const [token, setToken] = useState('');
  const [biz, setBiz] = useState('');
  const [sysUser, setSysUser] = useState('fssocial_dashbzbnew');
  const [limit, setLimit] = useState('1');
  const [log, setLog] = useState([]);
  const [busy, setBusy] = useState(false);
  const [stats, setStats] = useState(null);

  const add = (line) => setLog((l) => [...l, line]);

  async function run() {
    setBusy(true); setLog([]); setStats(null);
    const t = token.trim(), b = biz.replace(/\D/g, ''), wanted = sysUser.trim();
    if (!/^\d{6,}$/.test(b)) {
      add('Business ID must be the long number (digits only).');
      setBusy(false);
      return;
    }
    let u;
    try {
      // Meta needs the system user's app-scoped ID, which differs from the ID shown in Business Settings.
      // Look it up from the business's system user list (IDs there are scoped to the token's app).
      add('Looking up the system user…');
      const list = [];
      let sr = await graph(`${b}/system_users`, t, { params: { fields: 'id,name', limit: '100' } });
      list.push(...sr.data);
      while (sr.paging?.next) { sr = await graph(sr.paging.next, t); list.push(...sr.data); }
      const match = list.find((x) => x.name.toLowerCase() === wanted.toLowerCase() || x.id === wanted.replace(/\D/g, ''));
      if (!match) {
        add(`No system user named "${wanted}". System users in this business: ${list.map((x) => x.name).join(', ') || '(none visible)'}`);
        setBusy(false);
        return;
      }
      u = match.id;
      add(`Found ${match.name} (app-scoped ID ${u}).`);
    } catch (e) {
      add(`Couldn't list system users: ${e.message}`);
      setBusy(false);
      return;
    }
    try {
      add('Loading Pages owned by the business…');
      const pages = [];
      let r = await graph(`${b}/owned_pages`, t, { params: { fields: 'id,name', limit: '100' } });
      pages.push(...r.data);
      while (r.paging?.next) { r = await graph(r.paging.next, t); pages.push(...r.data); }

      let already = new Set();
      try {
        const a = [];
        let ar = await graph(`${u}/assigned_pages`, t, { params: { fields: 'id', limit: '100' } });
        a.push(...ar.data);
        while (ar.paging?.next) { ar = await graph(ar.paging.next, t); a.push(...ar.data); }
        already = new Set(a.map((p) => p.id));
      } catch { /* can't read existing assignments; assign everything */ }

      const todo = pages.filter((p) => !already.has(p.id));
      const n = limit === 'all' ? todo.length : Math.min(Number(limit), todo.length);
      add(`${pages.length} Pages found · ${already.size} already assigned · assigning ${n} now.`);

      let ok = 0; const failed = [];
      for (const p of todo.slice(0, n)) {
        try {
          await graph(`${p.id}/assigned_users`, t, { method: 'POST', params: { user: u, tasks: '["ANALYZE"]', business: b } });
          ok++;
          add(`✓ ${p.name}`);
        } catch (e) {
          failed.push(p);
          add(`✗ ${p.name}: ${e.message}`);
        }
        await new Promise((res) => setTimeout(res, 150));
      }
      setStats({ ok, failed: failed.length, remaining: todo.length - n });
    } catch (e) {
      add(`Stopped: ${e.message}`);
    }
    setBusy(false);
  }

  const field = { display: 'block', width: '100%', marginTop: 4, marginBottom: 12, padding: 8, border: '1px solid var(--border)', borderRadius: 8, background: 'var(--surface-1)', color: 'var(--text-primary)', font: 'inherit' };

  return (
    <>
      <h1>Bulk-assign Pages to the dashboard</h1>
      <p className="sub">
        Gives the system user Insights access to every Page your business owns. Your token goes straight from this
        browser to Meta and is never saved. Revenue access can&apos;t be set through Meta&apos;s API, so turn that on in
        Business Settings for the monetized Pages.
      </p>
      <div className="card" style={{ maxWidth: 720 }}>
        <label>Your access token (Graph API Explorer, FanSided Social app, with business_management + pages_show_list)
          <input type="password" style={field} value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" />
        </label>
        <label>Business ID (Business Settings → Business info)
          <input style={field} value={biz} onChange={(e) => setBiz(e.target.value)} />
        </label>
        <label>System user name (e.g. fssocial_dashbzbnew)
          <input style={field} value={sysUser} onChange={(e) => setSysUser(e.target.value)} />
        </label>
        <label>How many to assign this run
          <select style={field} value={limit} onChange={(e) => setLimit(e.target.value)}>
            <option value="1">1 (test first)</option>
            <option value="10">10</option>
            <option value="all">All remaining</option>
          </select>
        </label>
        <button className="btn" disabled={busy || !token || !biz || !sysUser} onClick={run}>
          {busy ? 'Working…' : 'Assign Pages'}
        </button>
        {stats && (
          <p><b>{stats.ok}</b> assigned · <b>{stats.failed}</b> failed · {stats.remaining} not attempted yet</p>
        )}
        {log.length > 0 && (
          <pre style={{ whiteSpace: 'pre-wrap', maxHeight: 400, overflow: 'auto', fontSize: 12 }}>{log.join('\n')}</pre>
        )}
      </div>
    </>
  );
}
