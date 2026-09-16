'use strict';
/* GitHub OAuth + REST API. The user's token is used ONLY to read their
 * identity and repository list — never to modify their account, and it
 * is never sent to the browser. */

const GH_API = 'https://api.github.com';
const GH_WEB = 'https://github.com';

function oauthAuthorizeUrl({ clientId, redirectUri, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: 'repo', // needed to render the repo list incl. private repos UI-side
    state,
    allow_signup: 'true',
  });
  return `${GH_WEB}/login/oauth/authorize?${params}`;
}

async function exchangeCodeForToken(code) {
  const res = await fetch(`${GH_WEB}/login/oauth/access_token`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  });
  const data = await res.json().catch(() => null);
  if (!data || !data.access_token) {
    throw new Error((data && (data.error_description || data.error)) || 'GitHub token exchange failed');
  }
  return data.access_token;
}

async function gh(pathname, token, opts = {}) {
  const res = await fetch(GH_API + pathname, {
    ...opts,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error((data && data.message) || `GitHub API error ${res.status}`);
  return data;
}

const getUser = (token) => gh('/user', token);

/* Up to 300 repos the user owns / collaborates on / has org access to. */
async function listRepos(token) {
  const out = [];
  for (let page = 1; page <= 3; page++) {
    const batch = await gh(
      `/user/repos?per_page=100&page=${page}&sort=updated&affiliation=owner,collaborator,organization_member`,
      token
    );
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out.map((r) => ({
    id: r.id,
    name: r.name,
    full_name: r.full_name,
    html_url: r.html_url,
    private: r.private,
    description: r.description,
    language: r.language,
    default_branch: r.default_branch,
    stargazers_count: r.stargazers_count,
    updated_at: r.updated_at,
  }));
}

/* Verifies the signed-in user actually owns/collaborates on the repo —
 * stops people deploying arbitrary public repos onto the platform owner's bill. */
async function isCollaborator(token, owner, repo, username) {
  const res = await fetch(
    `${GH_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/collaborators/${encodeURIComponent(username)}`,
    { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}` } }
  );
  if (res.status === 204) return true;
  if (res.status === 404) return false;
  const data = await res.json().catch(() => null);
  throw new Error((data && data.message) || `GitHub API error ${res.status}`);
}

const getRepo = (token, owner, repo) =>
  gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`, token);

async function listRootFiles(token, owner, repo, ref) {
  try {
    const q = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    const items = await gh(`/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${q}`, token);
    if (Array.isArray(items)) return items.map((i) => i.name);
  } catch (_) { /* empty repo or API hiccup → fall through to defaults */ }
  return [];
}

/* ── Demo fixtures (DEMO_MODE only) ── */
function demoRepos() {
  const now = Date.now();
  const mk = (n, lang, priv, desc, hours) => ({
    id: Math.abs(n.split('').reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)),
    name: n,
    full_name: `demo-dev/${n}`,
    html_url: `https://github.com/demo-dev/${n}`,
    private: priv,
    description: desc,
    language: lang,
    default_branch: 'main',
    stargazers_count: (n.length * 7) % 42,
    updated_at: new Date(now - hours * 3600e3).toISOString(),
  });
  return [
    mk('api-gateway', 'JavaScript', false, 'Express API gateway with JWT auth and rate limiting', 3),
    mk('portfolio-2026', 'HTML', false, 'Personal portfolio site', 9),
    mk('flask-ml-starter', 'Python', false, 'Scikit-learn model serving scaffold', 26),
    mk('go-url-shortener', 'Go', false, 'Tiny URL shortener with Redis cache', 50),
    mk('client-billing-app', 'TypeScript', true, 'Invoicing dashboard (private)', 74),
    mk('docs-site', 'CSS', false, 'Static documentation site', 120),
  ];
}

module.exports = {
  oauthAuthorizeUrl,
  exchangeCodeForToken,
  getUser,
  listRepos,
  isCollaborator,
  getRepo,
  listRootFiles,
  demoRepos,
};
