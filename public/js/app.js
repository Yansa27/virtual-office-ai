/**
 * app.js — entry point frontend (ES module).
 *
 * Semua concern sudah dipindah per modul di public/js:
 *   core.js     state global, helper DOM, konstanta tampilan
 *   api.js      lapisan fetch /api/*
 *   audio.js    Web Audio synth untuk BGM & SFX
 *   waypoint.js pathfinding + simulasi agen otonom
 *   engine.js   render & interaksi kantor 2D
 *   chat.js     view Chat AI
 *   board.js    view Kanban (drag & drop)
 *   modal.js    modal task baru
 *   views.js    registry view + router
 *   ui.js       shell: navigasi, login, audio, halaman hasil
 *
 * File ini sengaja tipis: urutan import menentukan grafik dependensi,
 * dan boot() dipanggil sekali setelah DOM siap (script module deferred).
 */
import { boot } from './ui.js';

boot();
