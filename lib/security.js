/**
 * lib/security.js — Header keamanan, cookie options, CSP longgar (compatible dengan inline styles/scripts app.js).
 * Zero npm dep.
 */

/**
 * Header keamanan standar.
 * CSP diset longgar karena app.js menggunakan inline styles (element.style) dan inline event handlers.
 * Jika nanti app.js dipindah ke file terpisah + CSP strict, bisa diperketat.
 */
function securityHeaders(req, res, isHttps) {
  // Mencegah MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  // Mencegah clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  // Referrer policy ketat
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // HSTS hanya jika HTTPS (di-set oleh Nginx proxy biasanya, tapi fallback di sini)
  if (isHttps) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  // CSP: allow inline styles/scripts (app.js butuh unsafe-inline), fonts Google, images data:
  // Catatan: 'unsafe-inline' untuk script/style diperlukan karena app.js masih 1 file besar.
  // 'unsafe-eval' TIDAK diperlukan (tidak ada eval/Function constructor).
  const csp = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com data:",
    "img-src 'self' data: https:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');
  res.setHeader('Content-Security-Policy', csp);
  // Permissions policy minimal
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
}

/**
 * Generate cookie options untuk session cookie.
 * @param {Object} config
 * @param {boolean} isHttps - request via HTTPS (detected via x-forwarded-proto)
 */
function sessionCookieOptions(config, isHttps) {
  const secure = config.cookieSecure === null ? isHttps : config.cookieSecure;
  return {
    httpOnly: true,
    secure,
    sameSite: config.cookieSameSite,
    path: '/',
    maxAge: Math.floor(config.sessionTtlMs / 1000),
  };
}

/**
 * Parse x-forwarded-proto untuk deteksi HTTPS di balik proxy.
 */
function isHttpsRequest(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto.split(',')[0].trim() === 'https';
  // Fallback: cek port standar? tidak reliable. Default false.
  return false;
}

/**
 * Sanitasi input sederhana (untuk logging, bukan validasi bisnis).
 */
function sanitizeForLog(str, maxLen = 200) {
  if (typeof str !== 'string') return String(str);
  return str.slice(0, maxLen).replace(/[\r\n\t]/g, ' ');
}

module.exports = {
  securityHeaders,
  sessionCookieOptions,
  isHttpsRequest,
  sanitizeForLog,
};