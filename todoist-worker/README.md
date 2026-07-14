# Todoist proxy (Cloudflare Worker)

Lets the Daily Plan tab talk to Todoist. Browsers can't call Todoist's API
directly (no CORS), so this Worker relays requests and adds the CORS
header. It's stateless — no secrets stored, no billing required.

## Setup (~5 minutes)

1. Sign up / log in at https://dash.cloudflare.com (free plan, no card needed).
2. Go to **Workers & Pages** → **Create** → **Create Worker**. Give it any
   name, e.g. `todoist-proxy`.
3. Click **Edit code** (Quick Edit) and replace the default contents with
   [`worker.js`](./worker.js) from this folder.
4. If the app is hosted somewhere other than
   `https://godwin-euphoric.github.io`, update the `ALLOWED_ORIGIN`
   constant at the top of the file first.
5. Click **Deploy**. You'll get a URL like
   `https://todoist-proxy.<your-subdomain>.workers.dev`.
6. In the app: **Settings → Todoist Sync**, paste that URL into
   **Worker Proxy URL**.

## Getting a Todoist API token

Todoist web/app → **Settings → Integrations → Developer** → copy the
**API token** shown there. Paste it into the app's **Settings → Todoist
Sync → Todoist API Token** field. This is your personal token — each
person using the app needs their own, since it's stored in their own
account, never in the Worker.

## Todoist Project Name

The app auto-creates a Todoist project (default name **Daily Plan**) the
first time it syncs, plus one section per Daily Plan column
(Meditation, Morn MMA, GYM, Morning Place, Morning Work, Evening Place —
or whatever you've renamed the columns to). If a project with that name
already exists, it's reused instead of duplicated.
