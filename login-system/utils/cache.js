const DEFAULT_TTL_MS = 60 * 1000; // 60s

class SimpleCache {
  constructor({ ttlMs = DEFAULT_TTL_MS, maxEntries = 500 } = {}) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;
    this.store = new Map();
  }

  _now() { return Date.now(); }

  _prune() {
    if (this.store.size <= this.maxEntries) return;
    const excess = this.store.size - this.maxEntries;
    const keys = Array.from(this.store.keys());
    for (let i = 0; i < excess; i++) {
      this.store.delete(keys[i]);
    }
  }

  get(key) {
    const v = this.store.get(key);
    if (!v) return undefined;
    if (v.expiresAt < this._now()) {
      this.store.delete(key);
      return undefined;
    }
    return v.value;
  }

  set(key, value, ttlMs) {
    const expiresAt = this._now() + (typeof ttlMs === 'number' ? ttlMs : this.ttlMs);
    this.store.set(key, { value, expiresAt });
    this._prune();
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { SimpleCache };