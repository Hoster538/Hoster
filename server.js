'use strict';
/* ─────────────────────────────────────────────────────────────────
 * THE DEV HOSTER PRO — application server
 *
 * User-facing contract: GitHub sign-in only. Users never type an API key,
 * never see the infrastructure provider's name, never leave this dashboard.
 *
 * Server-side truth: the platform owner's Render key provisions services
 * and the owner's UptimeRobot key monitors them. Those tokens live only
 * in env vars on this server.
 * ───────────────────────────────────────────────────────────────── */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

// ── tiny .env loader (so we don't need an extra dependency) ──
(function loadEnvFile() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const val = m[2].replace(/^["']|["']$/g, '');
    if (!(m[1] in process.env)) process.env[m[1]] = val;
  }
})();
// ensure data dir exists even without a .env
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });

const PORT = parseInt(process.env.PORT || '3000', 10);
const BASE_URL = (process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${PORT}`).replace(/\/+$/, '');
const DEMO_MODE = /^true$/i.test(process.env.DEMO_MODE || '');
const COOKIE_SECURE = /^true$/i.test(process.env.COOKIE_SECURE || '');
const SESSION_COOKIE = 'dhp_sid';
const SESSION_TTL_MS = 30 * 24 * 3600e3;
const MAX_DEPLOYMENTS = parseInt(process.env.MAX_DEPLOYMENTS_PER_USER || '3', 10);
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '15000', 10);

const db = require('./lib/db');
const github = require('./lib/github');
const provider = require('./lib/render');   // ← swap this one line to change provider
const uptime = require('./lib/uptime');
const detect = require('./lib/detect');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '64kb' }));
if (COOKIE_SECURE) app.set('trust proxy', 1);

// ── cookie + session plumbing ──
function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function setCookie(res, name, value, opts = {}) {
  const bits = [`${name}=${encodeURIComponent(value)}`, `Path=${opts.path || '/'}`];
  if (opts.maxAge !== undefined) bits.push(`Max-Age=${Math.floor(opts.maxAge)}`);
  if (opts.httpOnly !== false) bits.push('HttpOnly');
  bits.push(`SameSite=${opts.sameSite || 'Lax'}`);
  if (COOKIE_SECURE) bits.push('Secure');
  res.append('Set-Cookie', bits.join('; '));
}

app.use((req, res, next) => {
  req.cookies = parseCookies(req);
  req.user = null;
  const sid = req.cookies[SESSION_COOKIE];
  if (sid) {
    const sess = db.getSession(sid);
    if (sess) req.user = db.getUserById(sess.user_id) || null;
  }
  next();
});

function issueSession(res, userId) {
  const sid = crypto.randomBytes(24).toString('hex');
  db.createSession(sid, userId, Date.now() + SESSION_TTL_MS);
  setCookie(res, SESSION_COOKIE, sid, { maxAge: SESSION_TTL_MS / 1000 });
}
function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Sign in required' });
  next();
}
const uniqueName = (repo) => {
  const base = String(repo).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 38) || 'app';
  return `${base}-${crypto.randomBytes(3).toString('hex')}`;
};

/* ═════════════════════════ AUTH ═════════════════════════ */

app.get('/auth/github', (req, res) => {
  if (DEMO_MODE) return res.redirect('/auth/demo');
  if (!process.env.GITHUB_CLIENT_ID) {
    return res.status(500).send('GitHub OAuth is not configured. The site owner must set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(res, 'dhp_oauth', state, { maxAge: 600 });
  res.redirect(github.oauthAuthorizeUrl({
    clientId: process.env.GITHUB_CLIENT_ID,
    redirectUri: `${BASE_URL}/auth/github/callback`,
    state,
  }));
});

app.get('/auth/github/callback', async (req, res) => {
  const { code, state } = req.query;
  const expected = req.cookies.dhp_oauth;
  setCookie(res, 'dhp_oauth', '', { maxAge: 0 });
  if (!code || !state || !expected || state !== expected) {
    return res.status(400).send('Invalid or expired sign-in attempt. Please try again.');
  }
  try {
    const token = await github.exchangeCodeForToken(String(code));
    const ghUser = await github.getUser(token);
    const user = db.upsertGithubUser(ghUser, token);
    issueSession(res, user.id);
    res.redirect('/');
  } catch (e) {
    console.error('OAuth callback failed:', e.message);
    res.status(502).send('GitHub sign-in failed. Please try again.');
  }
});

// Demo login — only registered when DEMO_MODE=true, for UI previews.
if (DEMO_MODE) {
  app.get('/auth/demo', (req, res) => {
    const user = db.upsertGithubUser(
      { id: 1, login: 'demo-dev', name: 'Demo Developer', avatar_url: '' },
      'demo-token'
    );
    issueSession(res, user.id);
    res.redirect('/');
  });
}

app.post('/auth/logout', (req, res) => {
  if (req.cookies[SESSION_COOKIE]) db.deleteSession(req.cookies[SESSION_COOKIE]);
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
  res.json({ ok: true });
});

/* ═════════════════════════ API ═════════════════════════ */

app.get('/api/config', (req, res) => {
  res.json({ brand: 'THE DEV HOSTER PRO', demo: DEMO_MODE, maxDeployments: MAX_DEPLOYMENTS });
});

app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  const u = req.user;
  res.json({ user: { id: u.id, login: u.login, name: u.name, avatar_url: u.avatar_url } });
});

app.get('/api/repos', requireAuth, async (req, res) => {
  try {
    const repos = DEMO_MODE ? github.demoRepos() : await github.listRepos(req.user.access_token);
    res.json({ repos });
  } catch (e) {
    console.error('list repos failed:', e.message);
    res.status(502).json({ error: 'Could not load your repositories from GitHub. Try signing out and back in.' });
  }
});

/* One-click deploy */
app.post('/api/deploy', requireAuth, async (req, res) => {
  const { owner, repo } = req.body || {};
  if (typeof owner !== 'string' || typeof repo !== 'string' ||
      !/^[\w.-]{1,100}$/.test(owner) || !/^[\w.-]{1,100}$/.test(repo)) {
    return res.status(400).json({ error: 'A valid repository (owner + name) is required.' });
  }

  if (db.countDeployments(req.user.id) >= MAX_DEPLOYMENTS) {
    return res.status(429).json({ error: `You've reached the plan limit of ${MAX_DEPLOYMENTS} live apps. Delete one to free a slot.` });
  }

  try {
    // 1. Resolve the repo and prove the user owns/collaborates on it.
    let meta;
    if (DEMO_MODE) {
      meta = { full_name: `${owner}/${repo}`, html_url: `https://github.com/${owner}/${repo}`, default_branch: 'main', private: false };
    } else {
      const owned = await github.isCollaborator(req.user.access_token, owner, repo, req.user.login);
      if (!owned) return res.status(403).json({ error: 'You can only deploy repositories you own or collaborate on.' });
      meta = await github.getRepo(req.user.access_token, owner, repo);
    }
    if (meta.private) {
      return res.status(422).json({ error: 'Private repositories are not supported yet. Make the repo public, deploy, and this notice disappears once private-repo support ships.' });
    }

    // 2. Zero-config runtime detection from the repo root.
    const files = DEMO_MODE ? ['package.json', 'README.md'] : await github.listRootFiles(req.user.access_token, owner, repo, meta.default_branch);
    const planInfo = detect.plan(files);

    // 3. Provision on the hidden provider under the owner's workspace.
    const name = uniqueName(repo);
    const svc = await provider.createService({
      name,
      repo: meta.html_url,
      branch: meta.default_branch || 'main',
      kind: planInfo.kind,
      env: planInfo.env,
      region: process.env.RENDER_REGION || 'oregon',
      plan: process.env.RENDER_PLAN || 'free',
      buildCommand: planInfo.buildCommand,
      startCommand: planInfo.startCommand,
      publishPath: planInfo.publishPath,
      envVars: [{ key: 'NODE_ENV', value: 'production' }],
    });

    const row = db.createDeployment({
      user_id: req.user.id,
      repo_full_name: meta.full_name,
      repo_url: meta.html_url,
      branch: meta.default_branch || 'main',
      name,
      provider_service_id: svc.id,
      service_url: (svc.serviceDetails && svc.serviceDetails.url) || null,
      status: 'building',
      kind: planInfo.kind,
      runtime: planInfo.env || planInfo.kind,
    });

    res.status(201).json({ deployment: row });
  } catch (e) {
    console.error('deploy failed:', e.message);
    res.status(502).json({ error: 'Deployment could not be started right now. Please try again in a moment.' });
  }
});

app.get('/api/deployments', requireAuth, async (req, res) => {
  const rows = db.listDeployments(req.user.id);
  let monitorMap = {};
  try {
    monitorMap = await uptime.getStatusesCached(rows.map((r) => r.uptime_monitor_id));
  } catch (e) {
    console.error('monitor status fetch failed:', e.message);
  }
  res.json({
    deployments: rows.map((r) => ({
      id: r.id,
      repo_full_name: r.repo_full_name,
      repo_url: r.repo_url,
      branch: r.branch,
      name: r.name,
      service_url: r.service_url,
      status: r.status,
      runtime: r.runtime,
      kind: r.kind,
      error: r.error,
      created_at: r.created_at,
      monitor: r.uptime_monitor_id ? (monitorMap[String(r.uptime_monitor_id)] || 'pending') : null,
    })),
    limit: MAX_DEPLOYMENTS,
  });
});

app.post('/api/deployments/:id/redeploy', requireAuth, async (req, res) => {
  const dep = db.getDeployment(req.params.id);
  if (!dep || dep.user_id !== req.user.id) return res.status(404).json({ error: 'Deployment not found' });
  try {
    await provider.triggerDeploy(dep.provider_service_id);
    db.updateDeployment(dep.id, { status: 'building', error: null });
    res.json({ ok: true });
  } catch (e) {
    console.error('redeploy failed:', e.message);
    res.status(502).json({ error: 'Redeploy could not be started.' });
  }
});

app.delete('/api/deployments/:id', requireAuth, async (req, res) => {
  const dep = db.getDeployment(req.params.id);
  if (!dep || dep.user_id !== req.user.id) return res.status(404).json({ error: 'Deployment not found' });

  // Clean up monitoring + hosting, but always free the slot.
  if (dep.uptime_monitor_id) {
    try { await uptime.deleteMonitor(dep.uptime_monitor_id); }
    catch (e) { console.error('monitor delete failed:', e.message); }
  }
  try { await provider.deleteService(dep.provider_service_id); }
  catch (e) { console.error('service delete failed:', e.message); }

  db.deleteDeployment(dep.id);
  res.json({ ok: true });
});

/* ══════════════════ DEPLOY → MONITOR PIPELINE ══════════════════
 * Polls the provider for build progress. When a service flips live,
 * registers its URL with the (hidden) monitoring provider exactly once. */
const FAILED_STATES = new Set(['build_failed', 'update_failed', 'canceled', 'pre_deploy_failed', 'deactivated']);

async function pollPipeline() {
  for (const dep of db.pendingDeployments()) {
    try {
      const latest = await provider.getLatestDeploy(dep.provider_service_id);
      if (!latest) continue;

      if (latest.status === 'live') {
        let serviceUrl = dep.service_url;
        let monitorId = dep.uptime_monitor_id;
        if (!serviceUrl) {
          const svc = await provider.getService(dep.provider_service_id);
          serviceUrl = (svc && svc.serviceDetails && svc.serviceDetails.url) || null;
        }
        if (serviceUrl && !monitorId) {
          try {
            monitorId = await uptime.createMonitor(serviceUrl, `${dep.name} — Dev Hoster Pro`);
          } catch (e) {
            console.error(`monitor registration failed for ${dep.id}:`, e.message);
          }
        }
        console.log(`[pipeline] #${dep.id} ${dep.repo_full_name} is LIVE ${serviceUrl || ''} ${monitorId ? `(monitor ${monitorId})` : ''}`);
        db.updateDeployment(dep.id, { status: 'live', service_url: serviceUrl, uptime_monitor_id: monitorId || null, error: null });
      } else if (FAILED_STATES.has(latest.status)) {
        db.updateDeployment(dep.id, { status: 'failed', error: 'The build did not complete. Check the repo configuration and try again.' });
      } else {
        db.updateDeployment(dep.id, { status: 'building' });
      }
    } catch (e) {
      console.error(`[pipeline] poll failed for #${dep.id}:`, e.message);
    }
  }
}

/* ═════════════════════════ STATIC + FALLBACK ═════════════════════════ */

app.get('/api/healthz', (req, res) => res.json({ ok: true, demo: DEMO_MODE }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/')) {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.status(404).json({ error: 'Not found' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('──────────────────────────────────────────────');
  console.log('  THE DEV HOSTER PRO');
  console.log(`  Listening on ${BASE_URL} (port ${PORT})`);
  if (DEMO_MODE) console.log('  MODE: demo — mocked repos/deploys, no keys needed');
  const missing = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'RENDER_API_KEY', 'UPTIMEROBOT_API_KEY']
    .filter((k) => !process.env[k]);
  if (!DEMO_MODE && missing.length) console.log(`  WARNING: not configured: ${missing.join(', ')}`);
  console.log('──────────────────────────────────────────────');
});

db.cleanupSessions();
setInterval(pollPipeline, POLL_INTERVAL_MS).unref();
setInterval(() => db.cleanupSessions(), 3600e3).unref();
setTimeout(pollPipeline, 1500);
