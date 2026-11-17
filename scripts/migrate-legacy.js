#!/usr/bin/env node
/**
 * scripts/migrate-legacy.js — migrasi chat-state.json → SQLite (idempotent).
 * Dipanggil otomatis saat boot bila VO_MIGRATE_LEGACY=1 (default).
 * Jalankan manual: npm run migrate
 */
'use strict';

const path = require('path');
const config = require('../lib/config');
const { Store, migrateLegacy } = require('../lib/store');

const store = new Store(config.dbPath).open();
try {
  const result = migrateLegacy(store, path.join(__dirname, '..', 'chat-state.json'));
  if (result.migrated) {
     
    console.log(`Migrasi OK: ${result.messages} pesan, ${result.sessions} sesi → ${config.dbPath}`);
  } else {
     
    console.log(`Migrasi dilewati: ${result.reason}`);
  }
} finally {
  store.close();
}
