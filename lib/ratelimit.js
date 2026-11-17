/**
 * lib/ratelimit.js — Token bucket sederhana berbasis Map (in-memory).
 * Cocok untuk single-instance VPS. Tidak persisten — reset saat restart (OK untuk rate limit).
 */
class TokenBucket {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.buckets = new Map(); // key -> { tokens, resetAt }
  }

  _getBucket(key) {
    const now = Date.now();
    let b = this.buckets.get(key);
    if (!b || now >= b.resetAt) {
      b = { tokens: this.max, resetAt: now + this.windowMs };
      this.buckets.set(key, b);
    }
    return b;
  }

  /**
   * Coba konsumsi 1 token.
   * @returns { {allowed: boolean, remaining: number, resetAt: number} }
   */
  consume(key) {
    const b = this._getBucket(key);
    if (b.tokens > 0) {
      b.tokens -= 1;
      return { allowed: true, remaining: b.tokens, resetAt: b.resetAt };
    }
    return { allowed: false, remaining: 0, resetAt: b.resetAt };
  }

  /** Reset bucket untuk key (mis. logout). */
  reset(key) {
    this.buckets.delete(key);
  }

  /** Bersihkan bucket expired (opsional, dipanggil berkala). */
  cleanup() {
    const now = Date.now();
    for (const [k, b] of this.buckets) {
      if (now >= b.resetAt) this.buckets.delete(k);
    }
  }
}

/** Factory rate limiter per kategori. */
function createRateLimiter(config) {
  return {
    login: new TokenBucket(config.rateLimitLogin.max, config.rateLimitLogin.windowMs),
    chat: new TokenBucket(config.rateLimitChat.max, config.rateLimitChat.windowMs),
    api: new TokenBucket(config.rateLimitApi.max, config.rateLimitApi.windowMs),
  };
}

module.exports = { TokenBucket, createRateLimiter };