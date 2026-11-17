/**
 * waypoint.js — mesin waypoint & simulasi otonom agen di kantor 2D.
 * Pathfinding koridor, gerakan per-frame, dan idle loop yang mengisi
 * aktivitas agen saat sedang menganggur.
 */
import { $, state, DESK_SPOTS, MEETING_SPOTS, PANTRY_SPOTS } from './core.js';
import { SFX } from './audio.js';
import { presenceFor } from './api.js';
import { syncOfficeAgent } from './engine.js';

/* ============================================================
   2D OFFICE AUTONOMOUS AGENT SIMULATION & WAYPOINT ENGINE
   ============================================================ */
export function initAgentSimulations() {
  state.profiles.forEach((p) => {
    if (!state.agentsSim[p.name]) {
      const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
      state.agentsSim[p.name] = {
        name: p.name,
        x: desk.x,
        y: desk.y,
        targetX: desk.x,
        targetY: desk.y,
        state: 'desk', // 'desk' | 'pantry' | 'meeting' | 'walking'
        room: desk.room,
        facing: 1, // 1: right, -1: left
        bubble: '⚡ Siap bekerja',
        bubbleTimer: 0,
        walking: false,
        path: [],
      };
    }
  });
}

/**
 * Pathfinding waypoint koridor kantor virtual:
 * Membantu karakter jalan lewat pintu dan koridor tanpa tembus dinding sembarangan
 */
export function buildPath(startX, startY, targetX, targetY) {
  // Door centers and approach lanes match the generated floor map.
  const roomRoute = (x, y) => {
    if (y < 320) return [{ x, y: 292 }, { x: x < 385 ? 235 : 855, y: 292 }, { x: x < 385 ? 235 : 855, y: 370 }];
    if (y > 420 && x >= 780) {
      const lane = x > 950 ? 1035 : 860;
      return [{ x: lane, y }, { x: lane, y: 475 }, { x: 870, y: 475 }, { x: 870, y: 370 }];
    }
    if (y > 420) return [{ x, y: 475 }, { x: x < 780 ? 240 : 870, y: 475 }, { x: x < 780 ? 240 : 870, y: 370 }];
    return [{ x, y: 370 }];
  };
  const exit = roomRoute(startX, startY);
  const entry = roomRoute(targetX, targetY).reverse();
  return [...exit, ...entry, { x: targetX, y: targetY }];
}

export function commandAgentTo(name, target, targetState, bubbleText) {
  const sim = state.agentsSim[name];
  if (!sim) return;
  if (!sim.walking && sim.state === targetState && Math.hypot(sim.x - target.x, sim.y - target.y) < 1) return;
  sim.targetX = target.x;
  sim.targetY = target.y;
  sim.state = 'walking';
  sim.targetRoom = target.room || 'Kantor';
  sim.finalState = targetState;
  sim.bubble = bubbleText || 'Otw jalan...';
  sim.path = buildPath(sim.x, sim.y, target.x, target.y);
  sim.walking = true;
  sim.facing = target.x >= sim.x ? 1 : -1;
  syncOfficeAgent(name);
  SFX.click();
}

/* Jalankan loop animasi gerakan karakter */
let simRafId = null;
export function runSimLoop() {
  if (simRafId) cancelAnimationFrame(simRafId);

  let previousTime;
  function step(now) {
    const speed = Math.min((now - (previousTime ?? now)) / 1000, 0.05) * 144;
    previousTime = now;

    Object.values(state.agentsSim).forEach((ag) => {
      if (ag.path && ag.path.length > 0) {
        const currentTarget = ag.path[0];
        const dx = currentTarget.x - ag.x;
        const dy = currentTarget.y - ag.y;
        const dist = Math.hypot(dx, dy);

        if (dist <= speed) {
          ag.x = currentTarget.x;
          ag.y = currentTarget.y;
          ag.path.shift();
          if (ag.path.length === 0) {
            // Tiba di tujuan akhir!
            ag.walking = false;
            ag.state = ag.finalState || 'desk';
            ag.room = ag.targetRoom || ag.room;
            syncOfficeAgent(ag.name);

            if (ag.state === 'pantry') {
              ag.bubble = '☕ Mmm kopi latte nikmat!';
              SFX.sip();
            } else if (ag.state === 'meeting') {
              ag.bubble = '📊 Diskusi sprint Q4';
            } else {
              ag.bubble = '💻 Fokus bekerja di meja';
            }
          }
        } else {
          ag.x += (dx / dist) * speed;
          ag.y += (dy / dist) * speed;
          ag.facing = dx >= 0 ? 1 : -1;
        }

        // Update DOM SVG elemen karakter secara langsung agar super-smooth
        const el = $(`#agent-${ag.name}`);
        if (el) {
          el.setAttribute('transform', `translate(${ag.x.toFixed(1)}, ${ag.y.toFixed(1)})`);
          const bodyEl = el.querySelector('.cbody');
          if (bodyEl) {
            bodyEl.setAttribute('transform', `scale(${ag.walking ? ag.facing : 1}, 1)`);
          }
          const bubTxt = el.querySelector('.bub-txt');
          if (bubTxt) bubTxt.textContent = ag.bubble;
        }
      }
    });

    simRafId = requestAnimationFrame(step);
  }

  simRafId = requestAnimationFrame(step);
}

/* Autonomous Idle AI Loop:
   Jika agen lagi nganggur (tidak sibuk task running),
   mereka akan jalan-jalan, ke ruang rapat, atau ngopi di pantry! */
setInterval(() => {
  if (state.partyMode || state.meetingMode) return;

  state.profiles.forEach((p) => {
    const pres = presenceFor(p.name);
    const sim = state.agentsSim[p.name];
    if (!sim || sim.walking) return;
    if (sim.holdUntil && Date.now() < sim.holdUntil) return;

    // Sedang menjawab chat: agen harus di meja, bukan ngopi/jalan-jalan
    if (state.chatBusy && state.chatBusy[p.name]) {
      if (sim.state !== 'desk') {
        const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
        commandAgentTo(p.name, desk, 'desk', '⚡ Sedang mengerjakan pesananmu');
      }
      return;
    }

    if (pres === 'off') {
      // Agen lagi nganggur! Berikan perilaku acak yang hidup
      const rand = Math.random();

      if (sim.state === 'desk' && rand < 0.45) {
        // Jalan ke Pantry ngopi!
        const spot = PANTRY_SPOTS[p.name] || PANTRY_SPOTS.default;
        commandAgentTo(p.name, spot, 'pantry', '☕ Lagi santai, mau ngopi di pantry!');
      } else if (sim.state === 'desk' && rand < 0.75) {
        // Jalan ke Ruang Rapat
        const spot = MEETING_SPOTS[p.name] || MEETING_SPOTS.default;
        commandAgentTo(p.name, spot, 'meeting', '🏃 Ikut nimbrung di ruang rapat');
      } else if (sim.state !== 'desk' && rand < 0.35) {
        // Balik ke meja kerja
        const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
        commandAgentTo(p.name, desk, 'desk', '💻 Balik ke meja dulu');
      }
    } else if (pres === 'busy' && sim.state !== 'desk') {
      // Ada task running! Otomatis jalan balik ke meja untuk kerja
      const desk = DESK_SPOTS[p.name] || DESK_SPOTS.default;
      commandAgentTo(p.name, desk, 'desk', '⚡ Ada task! Otw meja');
    }
  });
}, 8000);
