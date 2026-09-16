'use strict';
/* Deployment provider adapter — Render API v1.
 *
 * White-label contract: every function here is called server-side with the
 * PLATFORM OWNER'S Render API key (RENDER_API_KEY env var). End users never
 * see, supply, or learn about this provider. Do not leak error strings
 * containing provider details to the client without normalizing them.
 *
 * To swap providers later (Railway, Fly.io, a Kubernetes cluster), implement
 * the same 5 functions and change one require() line in server.js.
 */

const API = 'https://api.render.com/v1';
const DEMO = /^true$/i.test(process.env.DEMO_MODE || '');

// ── Demo provider state (DEMO_MODE only) ──
const demoState = new Map(); // serviceId -> { createdAt, url, name }

function apiKey() {
  const k = process.env.RENDER_API_KEY;
  if (!k) throw new Error('Deployment backend is not configured on the server (owner API key missing)');
  return k;
}

async function r(pathname, opts = {}) {
  const res = await fetch(API + pathname, {
    ...opts,
    headers: {
      Authorization: `Bearer ${apiKey()}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && data.message) || `Upstream provider error ${res.status}`);
  return data;
}

let ownerIdCache = null;
async function getOwnerId() {
  if (ownerIdCache) return ownerIdCache;
  const owners = await r('/owners?limit=1');
  const id = owners && owners[0] && owners[0].owner && owners[0].owner.id;
  if (!id) throw new Error('Could not resolve provider workspace (owner id)');
  ownerIdCache = id;
  return id;
}

/**
 * cfg: { name, repo, branch, kind: 'web'|'static', env, region, plan,
 *        buildCommand, startCommand, publishPath, envVars }
 * returns provider service object: { id, serviceDetails: { url } }
 */
async function createService(cfg) {
  if (DEMO) {
    const id = 'srv-demo-' + Math.random().toString(36).slice(2, 10);
    const url = `https://${cfg.name}.dhp-demo.site`;
    demoState.set(id, { createdAt: Date.now(), url, name: cfg.name });
    return { id, name: cfg.name, serviceDetails: { url } };
  }

  const ownerId = await getOwnerId();
  const common = {
    name: cfg.name,
    ownerId,
    repo: cfg.repo,
    branch: cfg.branch,
    autoDeploy: 'yes',
  };

  const body = cfg.kind === 'static'
    ? {
        ...common,
        type: 'static_site',
        serviceDetails: {
          buildCommand: cfg.buildCommand || '',
          publishPath: cfg.publishPath || '.',
          pullRequestPreviewsEnabled: false,
        },
      }
    : {
        ...common,
        type: 'web_service',
        serviceDetails: {
          env: cfg.env || 'node',
          region: cfg.region || 'oregon',
          plan: cfg.plan || 'free',
          buildCommand: cfg.buildCommand || '',
          startCommand: cfg.startCommand || '',
          envVars: cfg.envVars || [],
          pullRequestPreviewsEnabled: false,
        },
      };

  const data = await r('/services', { method: 'POST', body: JSON.stringify(body) });
  return data.service || data;
}

async function getService(id) {
  if (DEMO) {
    const s = demoState.get(id);
    return { id, serviceDetails: { url: s ? s.url : null } };
  }
  return r(`/services/${encodeURIComponent(id)}`);
}

/* Latest deploy status: created | build_in_progress | update_in_progress |
 * live | build_failed | update_failed | canceled | deactivated | ... */
async function getLatestDeploy(id) {
  if (DEMO) {
    const s = demoState.get(id);
    if (!s) return null;
    const elapsed = Date.now() - s.createdAt;
    if (elapsed < 8000) return { status: 'created' };
    if (elapsed < 25000) return { status: 'build_in_progress' };
    return { status: 'live' };
  }
  const data = await r(`/services/${encodeURIComponent(id)}/deploys?limit=1`);
  return (Array.isArray(data) && data[0] && data[0].deploy) || null;
}

async function triggerDeploy(id) {
  if (DEMO) {
    const s = demoState.get(id) || { url: null, name: id };
    demoState.set(id, { ...s, createdAt: Date.now() });
    return { id: 'dep-demo', status: 'created' };
  }
  return r(`/services/${encodeURIComponent(id)}/deploys`, {
    method: 'POST',
    body: JSON.stringify({ clearCache: 'do_not_clear' }),
  });
}

async function deleteService(id) {
  if (DEMO) { demoState.delete(id); return true; }
  await r(`/services/${encodeURIComponent(id)}`, { method: 'DELETE' });
  return true;
}

module.exports = { createService, getService, getLatestDeploy, triggerDeploy, deleteService };
