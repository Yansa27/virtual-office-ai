/**
 * audio.js — Web Audio API synthesizer: BGM lofi 8-bit & SFX retro.
 * Zero dependensi; state tombol On/Off dibaca dari core.state.
 */
import { $, state } from './core.js';

let audioCtx = null;
export function getAudioCtx() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

export const SFX = {
  click() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.06);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.06);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.07);
    } catch {}
  },
  sip() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      // Bubble / sip chirp
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(780, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + 0.15);
    } catch {}
  },
  ping() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const now = ctx.currentTime;
      [587.33, 880].forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, now + idx * 0.08);
        gain.gain.setValueAtTime(0.1, now + idx * 0.08);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.18);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + idx * 0.08); osc.stop(now + idx * 0.08 + 0.2);
      });
    } catch {}
  },
  fanfare() {
    if (!state.sfxActive) return;
    try {
      const ctx = getAudioCtx(); if (!ctx) return;
      const notes = [523.25, 659.25, 783.99, 1046.50];
      const now = ctx.currentTime;
      notes.forEach((n, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(n, now + i * 0.09);
        gain.gain.setValueAtTime(0.15, now + i * 0.09);
        gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.09 + 0.22);
        osc.connect(gain); gain.connect(ctx.destination);
        osc.start(now + i * 0.09); osc.stop(now + i * 0.09 + 0.25);
      });
    } catch {}
  },
};

/* Cozy 8-Bit Lo-fi BGM Loop (Stardew-inspired acoustic pentatonic synth) */
let bgmTimer = null;
let bgmStep = 0;
const BGM_NOTES = [
  // C major / A minor cozy pentatonic melody
  261.63, 329.63, 392.00, 523.25,
  293.66, 349.23, 440.00, 587.33,
  329.63, 392.00, 493.88, 659.25,
  261.63, 392.00, 523.25, 659.25,
];

export function toggleBGM() {
  const ctx = getAudioCtx();
  if (!ctx) return;
  state.bgmActive = !state.bgmActive;
  $('#bgmState').textContent = state.bgmActive ? 'On' : 'Off';
  $('#bgmBtn').classList.toggle('active', state.bgmActive);

  if (!state.bgmActive) {
    if (bgmTimer) { clearInterval(bgmTimer); bgmTimer = null; }
    return;
  }

  bgmStep = 0;
  bgmTimer = setInterval(() => {
    if (!state.bgmActive) return;
    try {
      const freq = BGM_NOTES[bgmStep % BGM_NOTES.length];
      bgmStep++;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      gain.gain.setValueAtTime(0.035, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.38);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.4);
    } catch {}
  }, 420);
}

export function toggleSFX() {
  state.sfxActive = !state.sfxActive;
  $('#sfxState').textContent = state.sfxActive ? 'On' : 'Off';
  $('#sfxBtn').classList.toggle('active', state.sfxActive);
  SFX.click();
}
