# FanSided · Facebook Pages Dashboard

One dashboard for every FanSided Facebook Page. A daily job pulls follower counts and Page Insights for all Pages in the Business Manager, saves them to Postgres, and the dashboard shows network totals, trends, a sortable table of every Page, and a detail view per Page.

**What it tracks (per Page, per day):** followers, page likes, new follows, unfollows, views, unique viewers, post engagements, post reactions, profile visits, CTA clicks, 3-second video views, 30-second video views, and video watch time.

**Stack:** Next.js on Vercel · Vercel Cron (daily) · Neon Postgres · Meta Graph API v26.0

---

## Setup (about 15 minutes)

### 1. Create a Meta app and a system user token

1. Go to **developers.facebook.com → My Apps → Create App**. Choose the **Business** type and connect it to the FanSided business portfolio. Name it something like *FanSided Dashboard*.
2. Go to **business.facebook.com → Settings → Users → System users → Add**. Name it `dashboard` and give it the **Employee** role.
3. With that system user selected, click **Assign assets**:
   - **Pages** → select all Pages → turn on **Insights** (view performance) access. No other permissions are needed.
   - **Apps** → select the app from step 1 → **Develop app** access.
4. Click **Generate new token**:
   - Pick the app from step 1.
   - Set **Token expiration** to **Never**.
   - Check these permissions: `pages_show_list`, `pages_read_engagement`, `read_insights`, `business_management`.
   - Copy the token. You'll paste it into Vercel in step 2. Don't commit it to GitHub.

> **New Pages later?** Assign them to the `dashboard` system user (step 3). The next daily sync will pick them up. You don't need a new token.

### 2. Deploy on Vercel

1. **Vercel → Add New → Project →** import `zacharybest-byte/fansided_socialmedia` → **Deploy**. Leave all settings at their defaults.
2. Open the project → **Storage → Create Database → Neon (Postgres)** → connect it to this project. This adds `DATABASE_URL` automatically.
3. **Settings → Environment Variables.** Add these, then go to **Deployments** and **Redeploy**:

| Name | Value |
|---|---|
| `META_SYSTEM_USER_TOKEN` | the token from step 1 |
| `CRON_SECRET` | any long random string, e.g. from `openssl rand -hex 32` |
| `DASHBOARD_USER` | login username for the dashboard |
| `DASHBOARD_PASSWORD` | login password for the dashboard |

The database tables are created automatically on the first run.

### 3. Run the first sync (pulls 90 days of history)

Open this URL in your browser once:

```
https://<your-app>.vercel.app/api/sync?key=<CRON_SECRET>&days=90
```

It returns JSON: how many Pages synced, any failures, and any metrics Meta rejected. After that, Vercel Cron runs it automatically every day at 11:17 UTC (5:17 AM Central). Each daily run re-pulls the last 3 days to fill any gaps.

---

## Security

- **Dashboard:** every page and the CSV export ask for `DASHBOARD_USER` / `DASHBOARD_PASSWORD`. If you use Vercel Deployment Protection or SSO instead, leave those two variables empty.
- **`/api/sync`:** requires `CRON_SECRET`. Vercel Cron sends it automatically.
- **Tokens:** the Meta token lives only in Vercel environment variables. Page tokens are used during each sync and never stored.

## Using the dashboard

- **Home:** network totals and 7- and 30-day follower growth, plus charts for total followers, net new followers per day, daily views and daily engagements. Below those is a table of every Page. You can search it, filter by category and sort by any column.
- **Page detail** (click a Page name): up to 12 months of follower history, plus 90 days of daily views, unique viewers, engagements, reactions, video views and profile visits.
- **Export CSV** (top right): every Page with its current numbers, ready for Excel or Sheets.

## Notes on the data

- Meta reports Page Insights only for Pages with 100+ likes. Smaller Pages still show follower counts.
- Insights update about once every 24 hours. The current day is skipped because its numbers are still partial.
- If Meta deprecates a metric, the sync skips it and lists it under **Last sync notes** on the dashboard. The rest of the data keeps flowing.
- On the first run, follower history is backfilled from Meta's daily `page_follows` metric. After that, a real snapshot is saved every day.

## Local development

```bash
npm install
cp .env.example .env.local   # fill in values
npm run dev
npm test                     # sync logic tests (no network needed)
```

## Files

| Path | What it does |
|---|---|
| `lib/meta.js` | Graph API client: lists Pages, fetches insights, handles retries and deprecated metrics |
| `lib/sync.js` | Daily sync job, runs up to 8 Pages at a time |
| `lib/db.js` | Postgres schema and writes |
| `lib/queries.js` | Dashboard queries |
| `app/api/sync` | Cron endpoint |
| `app/api/export` | CSV export |
| `app/page.js` | Overview dashboard |
| `app/pages/[id]` | Per-Page detail |
| `proxy.js` | Dashboard login |
