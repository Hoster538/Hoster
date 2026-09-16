'use strict';
/* Monitoring adapter — UptimeRobot API v2.
 *
 * White-label contract: uses the PLATFORM OWNER'S UptimeRobot API key
 * (UPTIMEROBOT_API_KEY env var) server-side only. Users simply see
 * "Monitoring: Enabled / Up / Down" in their dashboard.
 */

const BASE = 'https://api.uptimerobot.com/v2';
const DEMO = /^true$/i.test(process.env.DEMO_MODE || '');

const STATUS = { 0: 'paused', 1: 'pending', 2: 'up', 8: 'seems_down', 9: 'down' };

function apiKey() {
  const k = process.env.UPTIMEROBOT_API_KEY;
  if (!k) throw new Error('Monitoring backend is not configured on the server (owner API key missing)');
  return k;
}

async function call(endpoint, params) {
  const body = new URLSearchParams({ api_key: apiKey(), format: 'json', ...params });
  const res = await fetch(`${BASE}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json().catch(() => null);
  if (!data || data.stat !== 'ok') {
    throw new Error((data && data.error && data.error.message) || `Monitoring provider error ${res.status}`);
  }
  return data;
}

/* type=1 → HTTP(s) check, every 5 minutes. Returns monitor id (string). */
async function createMonitor(url, friendlyName) {
  if (DEMO) return 'mon-demo-' + Math.random().toString(36).slice(2, 10);
  const d = await call('newMonitor', {
    friendly_name: friendlyName.slice(0, 60),
    url,
    type: '1',
    interval: '300',
    http_method: '2', // HEAD — cheaper than GET
  });
  return String(d.monitor.id);
}

async function deleteMonitor(id) {
  if (DEMO) return true;
  await call('deleteMonitor', { id: String(id) });
  return true;
}

/* Map { monitorId: 'up' | 'down' | 'pending' | 'paused' | 'seems_down' } */
async function getStatuses(ids) {
  const clean = [...new Set((ids || []).filter(Boolean).map(String))];
  if (!clean.length) return {};
  if (DEMO) return Object.fromEntries(clean.map((i) => [i, 'up']));
  const d = await call('getMonitors', { monitors: clean.join('-') });
  const map = {};
  for (const m of d.monitors || []) map[String(m.id)] = STATUS[m.status] || 'unknown';
  return map;
}

/* 60s in-memory cache so a busy dashboard doesn't hammer the provider. */
let cache = { at: 0, map: {} };
async function getStatusesCached(ids) {
  const missing = (ids || []).filter((i) => !(String(i) in cache.map));
  if (Date.now() - cache.at > 60_000 || missing.length) {
    try {
      const fresh = await getStatuses(ids);
      cache = { at: Date.now(), map: { ...cache.map, ...fresh } };
    } catch (e) {
      if (!Object.keys(cache.map).length) throw e; // no stale data to fall back to
    }
  }
  return cache.map;
}

module.exports = { createMonitor, deleteMonitor, getStatuses, getStatusesCached };
