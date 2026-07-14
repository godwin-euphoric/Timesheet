// Cloudflare Worker: thin CORS-enabling proxy in front of Todoist's REST API.
//
// It holds no secrets and stores nothing — it just forwards whatever
// Authorization header the app sends straight through to api.todoist.com,
// and adds the CORS headers browsers require. Each request carries the
// caller's own Todoist API token, so the same Worker can serve every user
// of the app; the Worker itself never sees a token it needs to remember.
//
// Deploy: dash.cloudflare.com → Workers & Pages → Create → paste this file
// in the Quick Edit editor → Deploy. Update ALLOWED_ORIGIN below to match
// where the app is hosted.

const TODOIST_BASE = 'https://api.todoist.com/rest/v2';
const ALLOWED_ORIGIN = 'https://godwin-euphoric.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    const url = new URL(request.url);
    const targetUrl = TODOIST_BASE + url.pathname + url.search;

    const init = {
      method: request.method,
      headers: {
        'Authorization': request.headers.get('Authorization') || '',
        'Content-Type': 'application/json',
      },
    };
    if (!['GET', 'HEAD'].includes(request.method)) {
      init.body = await request.text();
    }

    const resp = await fetch(targetUrl, init);
    const body = await resp.text();

    return new Response(body, {
      status: resp.status,
      headers: {
        ...corsHeaders(),
        'Content-Type': resp.headers.get('Content-Type') || 'application/json',
      },
    });
  },
};
