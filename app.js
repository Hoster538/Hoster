'use strict';
/* THE DEV HOSTER PRO — dashboard client.
 * Talks only to this app's own API. No third-party (provider) calls, keys,
 * names, or scripts ever reach the browser. */

const state = {
  user: null,
  config: { brand: 'THE DEV HOSTER PRO', demo: false, maxDeployments: 3 },
  repos: null,          // null = not loaded yet
  deployments: [],
  limit: 3,
  deployingNow: new Set(),
  pollTimer: null,
};

// ── inline icons (SVG, no network) ──
const ICON = {
  bolt: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M13 2 4.5 13.5h5L8 22l8.5-11.5h-5L13 2Z" fill="currentColor"/></svg>',
  github: '<svg width="19" height="19" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.65.5.5 5.65.5 12c0 5.08 3.29 9.39 7.86 10.91.58.11.79-.25.79-.56 0-.27-.01-1.17-.02-2.12-3.2.7-3.87-1.36-3.87-1.36-.52-1.33-1.28-1.68-1.28-1.68-1.04-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.75 2.69 1.25 3.34.95.1-.74.4-1.25.72-1.54-2.55-.29-5.23-1.28-5.23-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.8 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.12 3.05.74.81 1.18 1.83 1.18 3.09 0 4.41-2.69 5.38-5.25 5.67.41.36.78 1.05.78 2.13 0 1.54-.01 2.77-.01 3.15 0 .31.2.68.8.56A10.02 10.02 0 0 0 23.5 12C23.5 5.65 18.35.5 12 .5Z"/></svg>',
  rocket: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09Z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2Z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/></svg>',
  pulse: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>',
  wand: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2 18l-2 4 4-2 15.64-15.64a1.21 1.21 0 0 0 0-1.72Z"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M3 8h4"/><path d="M17 18h4"/></svg>',
  globe: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10Z"/></svg>',
  refresh: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/></svg>',
  trash: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  box: '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>',
  lock: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  ext: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const app = document.getElementById('app');

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* non-JSON */ }
  if (res.status === 401) { state.user = null; render(); throw new Error('Signed out'); }
  if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
  return data;
}

function toast(msg, kind = 'ok', ms = 5200) {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), ms);
}

/* ─────────────────────────── landing ─────────────────────────── */
function landingView() {
  return `
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge" style="color:var(--accent)">${ICON.bolt}</span>
      <div>THE DEV HOSTER&nbsp;<span class="grad" style="background:var(--accent-grad);-webkit-background-clip:text;background-clip:text;color:transparent">PRO</span><small>WHITE-LABEL HOSTING</small></div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-eyebrow">${ICON.rocket} Deploy without DevOps</div>
    <h1>Your code goes live.<br><span class="grad">One click. Zero keys.</span></h1>
    <p>Sign in with GitHub and every repository becomes deployable instantly — live URL, automatic health monitoring, and zero configuration. No API keys, no YAML, no dashboards-of-dashboards.</p>
    <div class="hero-cta">
      <a class="btn btn-github btn-lg" href="/auth/github">${ICON.github} Continue with GitHub</a>
      ${state.config.demo ? `<a class="btn btn-lg" href="/auth/demo">Explore the live demo</a>` : ''}
    </div>
  </section>

  <section class="features">
    <div class="feature-card">
      <div class="feature-icon">${ICON.rocket}</div>
      <h3>One-click deploys</h3>
      <p>Pick any repo and it ships — the platform detects your runtime and build commands automatically. Node, Python, Go, Ruby, Docker, or plain static sites.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">${ICON.pulse}</div>
      <h3>Monitoring on autopilot</h3>
      <p>The moment your app is live, uptime checks are registered for you automatically. See Up / Down status right next to each project.</p>
    </div>
    <div class="feature-card">
      <div class="feature-icon">${ICON.wand}</div>
      <h3>Nothing to configure</h3>
      <p>No YAML pipelines, no API keys, no third-party accounts. Your GitHub sign-in is the entire onboarding process.</p>
    </div>
  </section>`;
}

/* ─────────────────────────── dashboard ─────────────────────────── */
const STATUS_PILL = {
  live: ['pill-live', 'Live'],
  building: ['pill-building', 'Building'],
  queued: ['pill-building', 'Queued'],
  failed: ['pill-failed', 'Failed'],
};

function monitorChip(m, deployStatus) {
  if (!m) {
    return deployStatus === 'live'
      ? `<span class="monitor-chip monitor-pending"><span class="dot"></span>Monitor starting</span>`
      : '';
  }
  if (m === 'up') return `<span class="monitor-chip monitor-up"><span class="dot"></span>Monitored · Up</span>`;
  if (m === 'down' || m === 'seems_down') return `<span class="monitor-chip monitor-down"><span class="dot"></span>Monitored · Down</span>`;
  return `<span class="monitor-chip monitor-pending"><span class="dot"></span>Monitor ${esc(m)}</span>`;
}

function depCard(d) {
  const [cls, label] = STATUS_PILL[d.status] || ['pill-muted', d.status];
  const created = d.created_at ? d.created_at.replace('T', ' ').slice(0, 16) : '';
  return `
  <article class="dep-card" data-id="${d.id}">
    <div class="dep-main">
      <div class="dep-title">
        <span class="dep-name">${esc(d.name)}</span>
        <a class="dep-repo" href="${esc(d.repo_url)}" target="_blank" rel="noopener">${esc(d.repo_full_name)}${ICON.ext}</a>
        <span class="pill ${cls}"><span class="dot"></span>${label}</span>
        ${monitorChip(d.monitor, d.status)}
      </div>
      ${d.service_url ? `<a class="dep-url" href="${esc(d.service_url)}" target="_blank" rel="noopener">${ICON.globe} ${esc(d.service_url)}</a>` : ''}
      <div class="dep-sub">
        <span>branch: ${esc(d.branch)}</span>
        <span>runtime: ${esc(d.runtime || 'auto')}</span>
        <span>created ${esc(created)} UTC</span>
      </div>
      ${d.error ? `<div class="dep-error">${esc(d.error)}</div>` : ''}
    </div>
    <div class="dep-actions">
      <button class="btn btn-sm" data-action="redeploy" data-id="${d.id}" title="Trigger a fresh deploy">${ICON.refresh} Redeploy</button>
      <button class="btn btn-sm btn-danger btn-ghost" data-action="delete" data-id="${d.id}" title="Delete app, its URL and its monitor">${ICON.trash} Delete</button>
    </div>
  </article>`;
}

function repoCard(r) {
  const [owner, name] = r.full_name.split('/');
  const busy = state.deployingNow.has(r.full_name);
  const updated = r.updated_at ? new Date(r.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  return `
  <article class="card">
    <div class="card-top">
      <a class="repo-name" href="${esc(r.html_url)}" target="_blank" rel="noopener">${ICON.github} ${esc(r.name)}</a>
      ${r.private ? `<span class="tag-private">${ICON.lock} Private</span>` : ''}
    </div>
    <p class="repo-desc">${esc(r.description || 'No description')}</p>
    <div class="repo-meta">
      ${r.language ? `<span><span class="lang-dot"></span>${esc(r.language)}</span>` : ''}
      <span>★ ${r.stargazers_count}</span>
      <span>updated ${esc(updated)}</span>
    </div>
    <div class="card-actions">
      <span class="hint" style="font-size:12px;color:var(--text-dim)">branch: ${esc(r.default_branch)}</span>
      <button class="btn btn-primary btn-sm" data-action="deploy" data-owner="${esc(owner)}" data-repo="${esc(name)}" data-full="${esc(r.full_name)}"
        ${r.private || busy ? 'disabled' : ''}>
        ${busy ? '<span class="spinner"></span> Deploying…' : `${ICON.rocket} Deploy`}
      </button>
    </div>
    ${r.private ? `<div style="font-size:11.5px;color:var(--text-dim)">Private repos are not supported yet.</div>` : ''}
  </article>`;
}

function dashboardView() {
  const u = state.user;
  const live = state.deployments.filter((d) => d.status === 'live').length;
  const monitored = state.deployments.filter((d) => !!d.monitor).length;
  const slotsUsed = `${state.deployments.length}/${state.limit}`;

  return `
  <header class="topbar">
    <div class="brand">
      <span class="brand-badge" style="color:var(--accent)">${ICON.bolt}</span>
      <div>THE DEV HOSTER&nbsp;<span style="background:var(--accent-grad);-webkit-background-clip:text;background-clip:text;color:transparent">PRO</span><small>WHITE-LABEL HOSTING</small></div>
    </div>
    <div class="topbar-right">
      <div class="user-chip">
        <span>${esc(u.name || u.login)}</span>
        ${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="" />` : `<span class="avatar-fallback">${esc((u.login || 'U')[0].toUpperCase())}</span>`}
      </div>
      <button class="btn btn-ghost btn-sm" data-action="logout">Sign out</button>
    </div>
  </header>

  ${state.config.demo ? `<div class="demo-banner">Demo mode — repositories and deployments below are mock data. Configure real keys to go live.</div>` : ''}

  <div class="stats">
    <div class="stat"><b>${state.deployments.length}</b><span>Your apps</span></div>
    <div class="stat stat-hot"><b>${live}</b><span>Live now</span></div>
    <div class="stat"><b>${monitored}</b><span>Monitored</span></div>
    <div class="stat"><b>${slotsUsed}</b><span>Plan slots used</span></div>
  </div>

  <div class="section-head">
    <h2>${ICON.pulse} Your deployments</h2>
    <span class="hint">Status refreshes automatically</span>
  </div>
  <div class="dep-list">
    ${state.deployments.length
      ? state.deployments.map(depCard).join('')
      : `<div class="empty">${ICON.box}<p>No deployments yet.</p><p class="sub">Pick a repository below and hit Deploy — that's the whole workflow.</p></div>`}
  </div>

  <div class="section-head">
    <h2>${ICON.github} Your GitHub repositories</h2>
    <span class="hint">One click per repo · up to ${state.limit} apps on your plan</span>
  </div>
  <div class="grid">
    ${state.repos === null
      ? `<div class="row-loading" style="grid-column:1/-1"><div class="spinner spinner-lg"></div></div>`
      : state.repos.length ? state.repos.map(repoCard).join('')
      : `<div class="empty" style="grid-column:1/-1">${ICON.box}<p>No repositories found on this GitHub account.</p></div>`}
  </div>

  <div class="footer">THE DEV HOSTER PRO · your code, live in one click</div>`;
}

/* ─────────────────────────── render & data ─────────────────────────── */
function render() {
  app.innerHTML = state.user ? dashboardView() : landingView();
}

async function loadRepos() {
  try {
    const { repos } = await api('/api/repos');
    state.repos = repos;
  } catch (e) {
    state.repos = [];
    toast(e.message, 'error');
  }
  render();
}

async function loadDeployments() {
  if (!state.user) return;
  try {
    const { deployments, limit } = await api('/api/deployments');
    state.deployments = deployments;
    state.limit = limit;
    render();
  } catch (e) { /* signed out or transient — next poll retries */ }
}

async function onDeploy(owner, repo, full) {
  state.deployingNow.add(full);
  render();
  try {
    await api('/api/deploy', { method: 'POST', body: JSON.stringify({ owner, repo }) });
    toast(`Deployment started for ${full}. Monitoring will attach automatically once it is live.`);
    await loadDeployments();
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    state.deployingNow.delete(full);
    render();
  }
}

async function onAction(action, id) {
  if (action === 'logout') {
    await fetch('/auth/logout', { method: 'POST' });
    location.reload();
    return;
  }
  if (action === 'deploy') return; // handled separately
  if (action === 'delete') {
    if (!confirm('Delete this app? Its live URL and monitor will be removed. This cannot be undone.')) return;
    try {
      await api(`/api/deployments/${id}`, { method: 'DELETE' });
      toast('App, URL and monitor removed.');
      await loadDeployments();
    } catch (e) { toast(e.message, 'error'); }
    return;
  }
  if (action === 'redeploy') {
    try {
      await api(`/api/deployments/${id}/redeploy`, { method: 'POST', body: '{}' });
      toast('Redeploy started.');
      await loadDeployments();
    } catch (e) { toast(e.message, 'error'); }
  }
}

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id, owner, repo, full } = btn.dataset;
  if (action === 'deploy' && owner && repo) onDeploy(owner, repo, full);
  else onAction(action, id);
});

/* boot */
(async function init() {
  try {
    const cfg = await api('/api/config');
    state.config = cfg;
  } catch { /* defaults fine */ }
  try {
    const me = await api('/api/me');
    state.user = me.user;
  } catch { state.user = null; }

  render();
  if (state.user) {
    loadRepos();
    loadDeployments();
    state.pollTimer = setInterval(loadDeployments, 5000);
  }
})();
