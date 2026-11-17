/**
 * lib/config.js — Konfigurasi terpusat dari env, default aman, validasi.
 * Zero npm dep; gunakan Node builtins.
 */
const fs = require('fs');
const path = require('path');

function getEnv(key, def) {
  const v = process.env[key];
  return v !== undefined && v !== '' ? v : def;
}
function getBool(key, def) {
  const v = getEnv(key, def ? '1' : '0');
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
}
function getInt(key, def) {
  const v = getEnv(key, String(def));
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, getEnv('VO_DATA_DIR', 'data'));

// Pastikan data dir exist
try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}

const config = {
  // Server
  port: getInt('PORT', 9120),
  host: getEnv('HOST', '0.0.0.0'),

  // Hermes backend
  hermesBase: getEnv('HERMES_BASE', 'http://127.0.0.1:9119'),
  hermesBin: getEnv('HERMES_BIN', '/home/ubuntu/.local/bin/hermes'),

  // Chat / Agent
  chatAgents: ['pm', 'sales', 'dev', 'fe', 'qa', 'marketing'],
  chatTimeoutMs: getInt('VO_CHAT_TIMEOUT_MS', 900000),

  // Database
  dbPath: getEnv('VO_DB_PATH', path.join(DATA_DIR, 'vo.db')),
  migrateLegacy: getBool('VO_MIGRATE_LEGACY', true), // chat-state.json -> SQLite

  // Security
  rateLimitEnabled: getBool('VO_RATELIMIT', true),
  rateLimitLogin: { max: getInt('VO_RL_LOGIN_MAX', 5), windowMs: getInt('VO_RL_LOGIN_WINDOW_MS', 60000) },
  rateLimitChat: { max: getInt('VO_RL_CHAT_MAX', 20), windowMs: getInt('VO_RL_CHAT_WINDOW_MS', 60000) },
  rateLimitApi: { max: getInt('VO_RL_API_MAX', 200), windowMs: getInt('VO_RL_API_WINDOW_MS', 60000) },

  // Cookie
  cookieSecure: (() => {
    const v = getEnv('VO_COOKIE_SECURE', 'auto');
    if (v === 'auto') return null; // deteksi runtime via x-forwarded-proto
    return getBool('VO_COOKIE_SECURE', false);
  })(),
  cookieSameSite: getEnv('VO_COOKIE_SAMESITE', 'Lax'),
  sessionTtlMs: getInt('VO_SESSION_TTL_MS', 12 * 60 * 60 * 1000),

  // Offline login bypass
  allowOfflineLogin: getBool('VO_ALLOW_OFFLINE_LOGIN', false),

  // Proxy timeout
  hermesProxyTimeoutMs: getInt('VO_HERMES_PROXY_TIMEOUT_MS', 5000),

  // Proxy
  trustProxy: getBool('VO_TRUST_PROXY', false),

  // Chat workspaces
  chatWorkspaces: getEnv('VO_CHAT_WORKSPACES', path.join(ROOT, 'chat-workspaces')),

  // Logging
  logLevel: getEnv('VO_LOG_LEVEL', 'info'),

  // Derived
  _dataDir: DATA_DIR,
  _root: ROOT,
};

module.exports = config;