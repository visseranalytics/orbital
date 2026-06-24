/* ============================================================
   ORBITAL — a one-thumb arcade game
   Pure vanilla JS + Canvas. No dependencies, no build step.
   Tap to fling your orb from planet to planet. Climb forever.
   ============================================================ */
(() => {
  'use strict';

  // ---------- Canvas & sizing ----------
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let view = { w: 0, h: 0 };
  let DPR = 1;

  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    view.w = window.innerWidth;
    view.h = window.innerHeight;
    canvas.width = Math.round(view.w * DPR);
    canvas.height = Math.round(view.h * DPR);
    canvas.style.width = view.w + 'px';
    canvas.style.height = view.h + 'px';
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildVignette();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // ---------- Helpers ----------
  const TAU = Math.PI * 2;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const dist2 = (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  };
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

  // ---------- Persistent storage ----------
  const store = {
    get best() { return +(localStorage.getItem('orbital.best') || 0); },
    set best(v) { localStorage.setItem('orbital.best', String(v)); },
    get bestLevel() { return +(localStorage.getItem('orbital.bestLevel') || 1); },
    set bestLevel(v) { localStorage.setItem('orbital.bestLevel', String(v)); },
    get muted() { return localStorage.getItem('orbital.mute') === '1'; },
    set muted(v) { localStorage.setItem('orbital.mute', v ? '1' : '0'); },
  };

  // ---------- Audio (procedural, no asset files) ----------
  const Audio = (() => {
    let ac = null, master = null, noiseBuf = null;
    let muted = store.muted;

    function ensure() {
      if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ac = new AC();
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.32;
      master.connect(ac.destination);
      // one-shot noise buffer for whooshes / explosions
      const len = Math.floor(ac.sampleRate * 0.5);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }

    function setMuted(m) {
      muted = m; store.muted = m;
      if (master) master.gain.setTargetAtTime(m ? 0 : 0.32, ac.currentTime, 0.02);
    }

    function tone(f0, f1, dur, type, gain) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }

    function noise(dur, gain, lpFrom, lpTo) {
      if (!ac || muted) return;
      const t = ac.currentTime;
      const src = ac.createBufferSource();
      src.buffer = noiseBuf;
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(lpFrom, t);
      lp.frequency.exponentialRampToValueAtTime(Math.max(60, lpTo), t + dur);
      const g = ac.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp); lp.connect(g); g.connect(master);
      src.start(t); src.stop(t + dur);
    }

    return {
      ensure,
      get muted() { return muted; },
      toggle() { ensure(); setMuted(!muted); },
      launch() { tone(520, 180, 0.18, 'sawtooth', 0.18); noise(0.16, 0.10, 1800, 400); },
      capture(combo) {
        const semis = Math.min(combo, 22);
        const f = 392 * Math.pow(2, semis / 12);
        tone(f, f * 1.5, 0.13, 'triangle', 0.22);
        tone(f * 2, f * 2, 0.08, 'sine', 0.08);
      },
      perfect() { tone(1318, 1976, 0.12, 'triangle', 0.20); tone(2637, 2637, 0.06, 'sine', 0.06); },
      star() { tone(1040, 1560, 0.10, 'triangle', 0.18); },
      hyperjump() {
        // accelerating warp whoosh: pitch sweeps up, noise filter opens
        tone(140, 1500, 0.75, 'sawtooth', 0.16);
        tone(70, 760, 0.75, 'sine', 0.12);
        noise(0.75, 0.14, 240, 7000);
        tone(900, 2400, 0.5, 'triangle', 0.06);
      },
      levelup() {
        // bright rising arpeggio
        tone(523, 784, 0.16, 'triangle', 0.20);
        tone(659, 988, 0.18, 'triangle', 0.16);
        tone(784, 1568, 0.30, 'triangle', 0.18);
        noise(0.3, 0.06, 3000, 800);
      },
      death() { tone(220, 50, 0.55, 'sawtooth', 0.22); noise(0.5, 0.25, 1200, 120); },
    };
  })();

  // ---------- Game state ----------
  const ST = { MENU: 0, PLAYING: 1, DEAD: 2 };
  let state = ST.MENU;

  let planets = [];
  let stars = [];
  let particles = [];
  let trail = [];
  let bgStars = [];

  let orb = null;
  let currentIndex = 0;       // planet the orb belongs to
  let score = 0;
  let combo = 0;              // consecutive captures (drives audio pitch / burst size)
  let mult = 1;               // scoring multiplier — grows on clean shots, decays on a graze
  let level = 1;              // current level (every PLANETS_PER_LEVEL planets = +1)
  let launched = false;       // has the player taken their first launch this run?
  let hyperjumped = false;    // one-shot hidden hyperjump fired this run?
  let hyperjumpTime = -10;    // time it last fired (drives warp animation + banner)
  let warpFromX = 0, warpFromY = 0;  // camera position captured at the warp's start
  let best = store.best;
  let bestLevel = store.bestLevel;
  let popups = [];            // floating score / grade labels in world space
  let bannerTime = -10;       // time the last LEVEL banner fired
  let bannerLevel = 1;

  let cam = { x: 0, y: 0 };
  let shake = 0;
  let flash = 0, flashHue = 0;
  let flightTime = 0;
  let deathTime = -10;
  let time = 0;               // seconds since boot (drives animation)
  let globalHue = 220;

  const ORB_R = 9;

  // ---------- World generation ----------
  function planetRadius(level) { return clamp(30 - level * 0.6, 15, 30); }

  function makePlanet(level, x, y) {
    const r = planetRadius(level);
    return {
      x, y, r,
      orbitGap: r + 22,
      hue: (200 + level * 31) % 360,
      pulse: 0,
      reached: false,
      spin: rand(0, TAU),
    };
  }

  function generateNext() {
    const level = planets.length;
    const prev = planets[level - 1];
    const vGap = clamp(150 + level * 5, 150, Math.min(300, view.h * 0.40));
    const hMax = Math.min(view.w * 0.30, 200);
    const x = clamp(prev.x + rand(-hMax, hMax), -1e6, 1e6);
    const y = prev.y - vGap;
    const p = makePlanet(level, x, y);
    planets.push(p);

    // Maybe drop a collectible star on the path to this planet
    if (level > 1 && Math.random() < 0.55) {
      const mx = (prev.x + x) / 2 + rand(-30, 30);
      const my = (prev.y + y) / 2 + rand(-10, 10);
      stars.push({ x: mx, y: my, r: 9, collected: false, spin: rand(0, TAU) });
    }
    return p;
  }

  function ensureAhead() {
    while (planets.length < currentIndex + 4) generateNext();
  }

  function attachToPlanet(p, fromVel) {
    const dx = orb.x - p.x, dy = orb.y - p.y;
    let ang = Math.atan2(dy, dx);
    let dir = 1;
    if (fromVel) {
      // continue spinning in the rotational sense of the incoming arc
      const cross = dx * fromVel.y - dy * fromVel.x;
      dir = cross >= 0 ? 1 : -1;
    }
    orb.mode = 'orbit';
    orb.planet = p;
    orb.angle = ang;
    orb.dir = dir;
    orb.x = p.x + Math.cos(ang) * p.orbitGap;
    orb.y = p.y + Math.sin(ang) * p.orbitGap;
  }

  function initWorld() {
    planets = [];
    stars = [];
    trail = [];
    popups = [];
    currentIndex = 0;
    score = 0;
    combo = 0;
    mult = 1;
    level = 1;
    launched = false;
    hyperjumped = false;
    hyperjumpTime = -10;
    bannerTime = -10;
    flightTime = 0;
    globalHue = 220;

    const start = makePlanet(0, 0, 0);
    start.reached = true;
    planets.push(start);
    orb = { x: 0, y: 0, vx: 0, vy: 0, mode: 'orbit', planet: start, angle: 0, dir: 1, alive: true };
    orb.angle = -Math.PI / 2;
    attachToPlanet(start, null);
    ensureAhead();

    cam.x = start.x - view.w * 0.5;
    cam.y = start.y - view.h * 0.68;
  }

  // ---------- Difficulty curves ----------
  // All keyed off depth (lvl = currentIndex). The deeper you climb, the more
  // SENSITIVE the survival physics get: faster, smaller, farther — and crucially
  // the gravity-assist fades and the catch window tightens, so your aim has to
  // be truer to even land. (Precision GRADING stays earnable — see gradeScale.)
  const flySpeed = (lvl) => clamp(430 + lvl * 7, 430, 720);
  const angSpeed = (lvl) => clamp(2.5 + lvl * 0.04, 2.5, 3.8);
  // Gravity-assist starts forgiving and fades hard with depth. A dead-straight
  // shot lands with almost no assist, so this punishes IMPRECISION without ever
  // blocking a precise player: late-game, only a true aim reaches the planet.
  const homingTurn = (lvl) => clamp(2.8 - lvl * 0.065, 0.55, 2.8);
  // Extra catch margin beyond the planet's own radius — shrinks as you climb,
  // so the window to snap into orbit gets tighter level after level.
  const captureSlack = (lvl) => clamp(40 - lvl * 1.05, 11, 40);

  // ---------- Shot grading & multiplier ----------
  const MULT_CAP = 9;
  const PLANETS_PER_LEVEL = 8;
  const WARP_DUR = 0.9;                 // seconds the warp animation runs after a jump
  const HYPERJUMP_SKIP = 8;             // planets warped (one level)
  const HYPERJUMP_FALLBACK_LEVEL = 3;   // guaranteed warp by this level clear
  function warping() { return time - hyperjumpTime < WARP_DUR; }
  function warpT() { return clamp(1 - (time - hyperjumpTime) / WARP_DUR, 0, 1); }
  // Tiers keyed by launch deviation (radians between launch line and the
  // straight line to the next planet). Lower index = sloppier.
  //   base   — raw points before the multiplier
  //   grow   — how much the multiplier climbs on this shot
  //   decay  — true halves the multiplier (chain falters, but isn't wiped)
  const TIERS = [
    { name: 'GRAZE',   maxDev: Math.PI, base: 1, grow: 0, decay: true,  hue: 0   },
    { name: 'GOOD',    maxDev: 0.62,    base: 2, grow: 0, decay: false, hue: 205 },
    { name: 'GREAT',   maxDev: 0.30,    base: 3, grow: 1, decay: false, hue: 145 },
    { name: 'PERFECT', maxDev: 0.13,    base: 5, grow: 1, decay: false, hue: 48  },
  ];
  // Grade tolerances widen as the orbit sweeps faster, so each grade's *timing*
  // window stays roughly constant from level 1 to the speed cap (1.0 .. ~1.5x).
  function gradeScale() { return angSpeed(currentIndex) / 2.5; }
  // Return the best (highest) tier whose (scaled) threshold the deviation satisfies.
  function gradeShot(dev) {
    const s = gradeScale();
    let t = TIERS[0];
    for (let i = 1; i < TIERS.length; i++) if (dev <= TIERS[i].maxDev * s) t = TIERS[i];
    return t;
  }
  // Signed-normalized angle difference, magnitude in [0, PI].
  function angleDelta(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= TAU;
    while (d < -Math.PI) d += TAU;
    return d;
  }
  // Raw radian deviation of the current orbit launch line from a straight shot
  // at the next planet. null when there's no next planet to aim at. This is the
  // single source of truth shared by launch() (grading) and the aim-line color.
  function launchDeviation() {
    const next = planets[currentIndex + 1];
    if (!orb || !next) return null;
    const tx = -Math.sin(orb.angle) * orb.dir;
    const ty = Math.cos(orb.angle) * orb.dir;
    const launchAng = Math.atan2(ty, tx);
    const wantAng = Math.atan2(next.y - orb.y, next.x - orb.x);
    return Math.abs(angleDelta(launchAng, wantAng));
  }
  // How well the current orbit aim points at the next planet, 0 (off) .. 1 (dead-on).
  function aimAlignment() {
    if (!orb || orb.mode !== 'orbit') return 0;
    const dev = launchDeviation();
    if (dev == null) return 1;
    return clamp(1 - dev / (0.9 * gradeScale()), 0, 1);
  }

  // ---------- Actions ----------
  function launch() {
    if (!orb || orb.mode !== 'orbit') return;
    launched = true;
    const a = orb.angle;
    const tx = -Math.sin(a) * orb.dir;
    const ty = Math.cos(a) * orb.dir;
    const sp = flySpeed(currentIndex);
    orb.vx = tx * sp;
    orb.vy = ty * sp;

    // Grade the launch NOW: how far the launch line points from a straight
    // shot at the next planet. This is what the multiplier rewards.
    const dev = launchDeviation();
    orb.launchDev = dev == null ? 0 : dev;

    orb.mode = 'fly';
    orb.planet = null;
    flightTime = 0;
    Audio.launch();
    spawnBurst(orb.x, orb.y, planets[currentIndex].hue, 8, 1.4);
  }

  // Instantly move the orb to a far-ahead planet (the hyperjump). Re-anchors it
  // on the destination's orbit; the camera is NOT snapped (it sweeps in over the
  // warp, see update()), and the off-screen death check is suspended while
  // warping() so the orb can sit off-screen until the camera arrives.
  function warpTo(index) {
    while (planets.length <= index) generateNext();
    currentIndex = index;
    const p = planets[index];
    orb.mode = 'orbit';
    orb.planet = p;
    orb.angle = Math.PI / 2;            // arrive at the bottom of the orbit
    orb.x = p.x + Math.cos(orb.angle) * p.orbitGap;
    orb.y = p.y + Math.sin(orb.angle) * p.orbitGap;
    p.pulse = 1;
    trail = [];
    ensureAhead();
  }

  function capture(p, idx) {
    attachToPlanet(p, { x: orb.vx, y: orb.vy });
    currentIndex = idx;
    p.reached = true;
    p.pulse = 1;
    combo += 1;

    // Grade the shot and drive the multiplier. A graze halves it (chain
    // falters); clean shots climb it. It only fully resets to x1 on death.
    const tier = gradeShot(orb.launchDev != null ? orb.launchDev : Math.PI);
    if (tier.decay) mult = Math.max(1, Math.ceil(mult / 2));
    else mult = Math.min(mult + tier.grow, MULT_CAP);

    const gained = tier.base * mult;
    score += gained;

    // Floating grade + points popup at the capture point.
    addPopup(orb.x, orb.y - p.r - 14, `${tier.name}  +${gained}`, tier.hue,
             tier.name === 'PERFECT' ? 1.25 : 1.0);

    ensureAhead();
    shake = Math.min(shake + 5, 14);
    flash = (tier.name === 'PERFECT' ? 0.4 : 0.28); flashHue = tier.hue;
    spawnBurst(orb.x, orb.y, p.hue, 16 + Math.min(combo, 16), 2.0);
    Audio.capture(combo);
    if (tier.name === 'PERFECT') Audio.perfect();
    globalHue = 200 + currentIndex * 4;

    // Level progression — every PLANETS_PER_LEVEL captured planets.
    const newLevel = Math.floor(currentIndex / PLANETS_PER_LEVEL) + 1;
    if (newLevel > level) levelUp(newLevel);
  }

  function levelUp(newLevel) {
    level = newLevel;
    bannerLevel = newLevel;
    bannerTime = time;
    // Flat, predictable milestone reward — the triggering capture already paid
    // out x mult, so don't double-count it here.
    const bonus = newLevel * 25;
    score += bonus;
    addPopup(orb.x, orb.y - 30, `LEVEL ${newLevel}  +${bonus}`, 280, 1.5);
    flash = 0.45; flashHue = (200 + newLevel * 24) % 360;
    shake = Math.min(shake + 8, 18);
    spawnBurst(orb.x, orb.y, (200 + newLevel * 24) % 360, 30, 2.6);
    Audio.levelup();
  }

  function die() {
    if (state !== ST.PLAYING) return;
    state = ST.DEAD;
    deathTime = time;
    orb.alive = false;
    best = Math.max(best, score);
    store.best = best;
    bestLevel = Math.max(bestLevel, level);
    store.bestLevel = bestLevel;
    shake = 26;
    flash = 0.6; flashHue = 0;
    spawnBurst(orb.x, orb.y, 6, 46, 3.2);
    spawnBurst(orb.x, orb.y, 40, 22, 2.4);
    Audio.death();
  }

  // ---------- Particles ----------
  function spawnBurst(x, y, hue, count, power) {
    for (let i = 0; i < count; i++) {
      const a = rand(0, TAU);
      const sp = rand(40, 220) * power;
      particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: rand(0.4, 0.9),
        max: 0.9,
        size: rand(2, 4.5),
        hue: hue + rand(-16, 16),
      });
    }
    if (particles.length > 600) particles.splice(0, particles.length - 600);
  }

  // ---------- Floating popups (world-space score / grade labels) ----------
  function addPopup(x, y, str, hue, scale = 1) {
    popups.push({ x, y, str, hue, scale, life: 1.1, max: 1.1 });
    if (popups.length > 40) popups.shift();
  }

  // ---------- Input ----------
  function handleTap() {
    Audio.ensure();
    if (state === ST.MENU) {
      // First tap only STARTS the run — the orb keeps orbiting so you can read
      // the aim line and pick your moment. Your next tap is your first launch.
      state = ST.PLAYING;
    } else if (state === ST.PLAYING) {
      if (warping()) return;   // ignore taps mid-warp; the jump is on rails
      launch();
    } else if (state === ST.DEAD) {
      if (time - deathTime > 0.6) {
        initWorld();
        state = ST.PLAYING;   // same as the menu: start orbiting, don't auto-fire
      }
    }
  }

  function muteRect() { return { x: view.w - 50, y: 14, w: 36, h: 36 }; }
  function inRect(px, py, r) { return px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h; }

  function onPointerDown(e) {
    const x = e.clientX, y = e.clientY;
    if (inRect(x, y, muteRect())) { Audio.toggle(); return; }
    handleTap();
  }
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('touchstart', (e) => e.preventDefault(), { passive: false });
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space' || e.code === 'ArrowUp' || e.code === 'Enter') { e.preventDefault(); handleTap(); }
    else if (e.code === 'KeyM') Audio.toggle();
  });

  // ---------- Update ----------
  function update(dt) {
    time += dt;

    // camera follows the planet the orb belongs to (last captured while flying)
    const anchor = planets[currentIndex];
    const tx = anchor.x - view.w * 0.5;
    const ty = anchor.y - view.h * 0.68;
    if (warping()) {
      // hyperjump: sweep the camera forward across the skipped level, eased, so
      // the jump reads as fast forward travel
      const p = 1 - warpT();
      const e = p * p * (3 - 2 * p);    // smoothstep
      cam.x = lerp(warpFromX, tx, e);
      cam.y = lerp(warpFromY, ty, e);
    } else {
      const k = clamp(dt * 4.5, 0, 1);
      cam.x = lerp(cam.x, tx, k);
      cam.y = lerp(cam.y, ty, k);
    }

    // planet pulses & spin
    for (const p of planets) { p.pulse *= Math.pow(0.0025, dt); p.spin += dt * 0.4; }
    for (const s of stars) s.spin += dt * 2;

    if (orb && orb.alive && (state === ST.PLAYING || state === ST.MENU)) {
      if (orb.mode === 'orbit') {
        orb.angle += angSpeed(currentIndex) * orb.dir * dt;
        const p = orb.planet;
        orb.x = p.x + Math.cos(orb.angle) * p.orbitGap;
        orb.y = p.y + Math.sin(orb.angle) * p.orbitGap;
      } else if (orb.mode === 'fly') {
        flightTime += dt;
        const next = planets[currentIndex + 1];
        // gentle homing toward the next planet (forgiving, not free)
        if (next) {
          const sp = Math.hypot(orb.vx, orb.vy) || 1;
          let cur = Math.atan2(orb.vy, orb.vx);
          const want = Math.atan2(next.y - orb.y, next.x - orb.x);
          let d = want - cur;
          while (d > Math.PI) d -= TAU;
          while (d < -Math.PI) d += TAU;
          const maxTurn = homingTurn(currentIndex) * dt;
          cur += clamp(d, -maxTurn, maxTurn);
          orb.vx = Math.cos(cur) * sp;
          orb.vy = Math.sin(cur) * sp;
        }
        orb.x += orb.vx * dt;
        orb.y += orb.vy * dt;

        // trail
        trail.push({ x: orb.x, y: orb.y });
        if (trail.length > 26) trail.shift();

        // star pickups
        for (const s of stars) {
          if (s.collected) continue;
          const rr = (s.r + ORB_R + 6);
          if (dist2(orb.x, orb.y, s.x, s.y) < rr * rr) {
            s.collected = true;
            const g = 3 * mult;
            score += g;
            combo += 1;
            addPopup(s.x, s.y - 16, `+${g}`, 50, 1.0);
            flash = 0.18; flashHue = 50;
            spawnBurst(s.x, s.y, 50, 14, 1.6);
            Audio.star();
          }
        }

        // capture next planet — the catch window tightens as you climb
        if (next) {
          const capR = next.r + captureSlack(currentIndex);
          if (dist2(orb.x, orb.y, next.x, next.y) < capR * capR) {
            capture(next, currentIndex + 1);
          }
        }

        // death checks: off-screen or stuck flying too long. Suspended during a
        // warp — the orb is intentionally off-screen while the camera sweeps in.
        if (state === ST.PLAYING && !warping()) {
          const sx = orb.x - cam.x, sy = orb.y - cam.y;
          const M = 96;
          if (sx < -M || sx > view.w + M || sy < -M || sy > view.h + M || flightTime > 4) {
            die();
          }
        }
      }
    }

    // particles
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.12, dt);
      p.vy *= Math.pow(0.12, dt);
    }

    // floating popups
    for (let i = popups.length - 1; i >= 0; i--) {
      const u = popups[i];
      u.life -= dt;
      if (u.life <= 0) { popups.splice(i, 1); continue; }
      u.y -= 34 * dt;
    }

    // effects decay
    shake *= Math.pow(0.0009, dt);
    if (shake < 0.05) shake = 0;
    flash *= Math.pow(0.02, dt);
  }

  // ---------- Background starfield ----------
  function initBgStars() {
    bgStars = [];
    const n = 90;
    for (let i = 0; i < n; i++) {
      bgStars.push({
        x: Math.random(),
        y: Math.random(),
        z: rand(0.15, 0.7),      // parallax depth
        s: rand(0.6, 1.8),
        tw: rand(0, TAU),
      });
    }
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, view.h);
    g.addColorStop(0, hsl(globalHue, 45, 7));
    g.addColorStop(0.6, hsl((globalHue + 30) % 360, 50, 5));
    g.addColorStop(1, hsl((globalHue + 60) % 360, 55, 4));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, view.w, view.h);

    // parallax stars (screen space, scrolled by camera)
    for (const st of bgStars) {
      let x = (st.x * view.w - cam.x * st.z) % view.w;
      let y = (st.y * view.h - cam.y * st.z) % view.h;
      if (x < 0) x += view.w;
      if (y < 0) y += view.h;
      const tw = 0.55 + 0.45 * Math.sin(time * 2 + st.tw);
      if (warpT() > 0.02) {
        // hyperjump: stars stretch into warp-speed streaks trailing the travel
        const w = warpT();
        const len = (12 + st.z * 130) * w * w;   // closer stars streak longest
        ctx.strokeStyle = hsl(210, 80, 88, (0.35 + st.z * 0.55) * Math.min(1, tw + 0.4));
        ctx.lineWidth = st.s * (1 + 1.6 * w);
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + len);
        ctx.stroke();
      } else {
        ctx.globalAlpha = (0.25 + st.z * 0.6) * tw;
        ctx.fillStyle = '#cfe3ff';
        ctx.fillRect(x, y, st.s, st.s);
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- World rendering ----------
  function drawPlanet(p) {
    const x = p.x, y = p.y;
    const pr = p.r * (1 + p.pulse * 0.25);

    // glow
    const glow = ctx.createRadialGradient(x, y, pr * 0.4, x, y, pr * 2.6);
    glow.addColorStop(0, hsl(p.hue, 90, 60, 0.45));
    glow.addColorStop(1, hsl(p.hue, 90, 60, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, pr * 2.6, 0, TAU);
    ctx.fill();

    // body
    const body = ctx.createRadialGradient(x - pr * 0.3, y - pr * 0.3, pr * 0.2, x, y, pr);
    body.addColorStop(0, hsl(p.hue, 80, 70));
    body.addColorStop(1, hsl(p.hue, 75, 38));
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.arc(x, y, pr, 0, TAU);
    ctx.fill();

    // orbit ring (only for the current planet)
    if (p === planets[currentIndex] && orb && orb.mode === 'orbit') {
      ctx.strokeStyle = hsl(p.hue, 90, 75, 0.30);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, p.orbitGap, 0, TAU);
      ctx.stroke();
    }
  }

  function drawStar(s) {
    if (s.collected) return;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.spin);
    const r = s.r * (1 + 0.12 * Math.sin(time * 4 + s.x));
    const glow = ctx.createRadialGradient(0, 0, 1, 0, 0, r * 2.4);
    glow.addColorStop(0, 'hsla(50,100%,70%,0.6)');
    glow.addColorStop(1, 'hsla(50,100%,70%,0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(0, 0, r * 2.4, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffe66b';
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU - Math.PI / 2;
      const a2 = a + TAU / 10;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawTrail() {
    if (trail.length < 2) return;
    const hue = planets[currentIndex] ? planets[currentIndex].hue : 200;
    for (let i = 1; i < trail.length; i++) {
      const t = i / trail.length;
      ctx.strokeStyle = hsl(hue, 95, 70, t * 0.5);
      ctx.lineWidth = t * ORB_R * 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
      ctx.lineTo(trail[i].x, trail[i].y);
      ctx.stroke();
    }
  }

  function drawAimHint() {
    if (!orb || orb.mode !== 'orbit') return;
    if (state === ST.DEAD) return;
    const a = orb.angle;
    const tx = -Math.sin(a) * orb.dir;
    const ty = Math.cos(a) * orb.dir;

    // Color the aim line by how well it currently points at the next planet:
    // red (off) -> amber -> green (locked on). This teaches the straight-shot
    // multiplier — fire when it's green.
    const align = aimAlignment();                 // 0..1
    const aimHue = lerp(0, 130, align);           // 0=red, 130=green
    const len = lerp(58, 92, align);              // line grows as you line up
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = hsl(aimHue, 90, 62, 0.35 + align * 0.5);
    ctx.lineWidth = 2 + align * 1.5;
    ctx.beginPath();
    ctx.moveTo(orb.x, orb.y);
    ctx.lineTo(orb.x + tx * len, orb.y + ty * len);
    ctx.stroke();

    // A small arrowhead that brightens when locked on.
    if (align > 0.5) {
      const hx = orb.x + tx * len, hy = orb.y + ty * len;
      const perpx = -ty, perpy = tx;
      ctx.setLineDash([]);
      ctx.fillStyle = hsl(aimHue, 90, 65, (align - 0.5) * 1.8);
      ctx.beginPath();
      ctx.moveTo(hx + tx * 9, hy + ty * 9);
      ctx.lineTo(hx + perpx * 5, hy + perpy * 5);
      ctx.lineTo(hx - perpx * 5, hy - perpy * 5);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawPopups() {
    for (const u of popups) {
      const t = clamp(u.life / u.max, 0, 1);
      const size = (15 + (u.scale - 1) * 10) * (0.6 + 0.4 * Math.min(1, (u.max - u.life) * 6));
      ctx.save();
      ctx.globalAlpha = t;
      ctx.font = `800 ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      ctx.strokeText(u.str, u.x, u.y);
      ctx.fillStyle = hsl(u.hue, 95, 70);
      ctx.fillText(u.str, u.x, u.y);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawOrb() {
    if (!orb || !orb.alive) return;
    const hue = planets[currentIndex] ? planets[currentIndex].hue : 200;
    const glow = ctx.createRadialGradient(orb.x, orb.y, 1, orb.x, orb.y, ORB_R * 3);
    glow.addColorStop(0, hsl(hue, 100, 85, 0.9));
    glow.addColorStop(1, hsl(hue, 100, 70, 0));
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(orb.x, orb.y, ORB_R * 3, 0, TAU); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(orb.x, orb.y, ORB_R, 0, TAU); ctx.fill();
  }

  function drawParticles() {
    for (const p of particles) {
      const a = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = hsl(p.hue, 90, 65, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * a, 0, TAU);
      ctx.fill();
    }
  }

  function drawWorld() {
    ctx.save();
    let sx = 0, sy = 0;
    if (shake > 0) { sx = rand(-shake, shake); sy = rand(-shake, shake); }
    ctx.translate(-cam.x + sx, -cam.y + sy);

    // cull to view
    const top = cam.y - 100, bot = cam.y + view.h + 100;
    for (const p of planets) {
      if (p.y > bot + p.r * 3 || p.y < top - p.r * 3) continue;
      drawPlanet(p);
    }
    for (const s of stars) {
      if (s.y > bot || s.y < top) continue;
      drawStar(s);
    }
    drawAimHint();
    drawTrail();
    drawParticles();
    drawOrb();
    drawPopups();
    ctx.restore();
  }

  // ---------- UI ----------
  let vignette = null;
  function buildVignette() {
    vignette = ctx.createRadialGradient(
      view.w / 2, view.h / 2, Math.min(view.w, view.h) * 0.35,
      view.w / 2, view.h / 2, Math.max(view.w, view.h) * 0.75
    );
    vignette.addColorStop(0, 'rgba(0,0,0,0)');
    vignette.addColorStop(1, 'rgba(0,0,0,0.45)');
  }

  function text(str, x, y, size, color, align = 'center', weight = '800') {
    ctx.font = `${weight} ${size}px -apple-system, "Segoe UI", system-ui, sans-serif`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function drawMuteButton() {
    const r = muteRect();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.moveTo(cx - 9, cy - 4);
    ctx.lineTo(cx - 3, cy - 4);
    ctx.lineTo(cx + 2, cy - 9);
    ctx.lineTo(cx + 2, cy + 9);
    ctx.lineTo(cx - 3, cy + 4);
    ctx.lineTo(cx - 9, cy + 4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    if (Audio.muted) {
      ctx.beginPath();
      ctx.moveTo(cx + 6, cy - 6); ctx.lineTo(cx + 13, cy + 6);
      ctx.moveTo(cx + 13, cy - 6); ctx.lineTo(cx + 6, cy + 6);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(cx + 5, cy, 4, -Math.PI / 3, Math.PI / 3);
      ctx.arc(cx + 5, cy, 8, -Math.PI / 3, Math.PI / 3);
      ctx.stroke();
    }
  }

  function drawUI() {
    // flash overlay
    if (flash > 0.01) {
      ctx.fillStyle = hsl(flashHue, 90, 70, clamp(flash, 0, 0.6));
      ctx.fillRect(0, 0, view.w, view.h);
    }

    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, view.w, view.h);

    const topPad = 28;
    const pulse = 0.85 + 0.15 * Math.sin(time * 3);

    if (state === ST.PLAYING) {
      text(String(score), view.w / 2, topPad + 18, 48, '#ffffff');

      // Multiplier badge — the higher it climbs, the hotter and bigger it pulses.
      if (mult >= 2) {
        const heat = (mult - 1) / (MULT_CAP - 1);            // 0..1
        const mHue = lerp(190, 45, heat);                    // cool -> gold
        const pulseAmt = 1 + 0.12 * Math.sin(time * 8) * heat;
        const mSize = (18 + heat * 16) * pulseAmt;
        text(`×${mult}`, view.w / 2, topPad + 54, mSize, hsl(mHue, 95, 70), 'center', '900');
      }

      // Top-left: best + current level.
      text(`BEST ${best}`, 16, topPad, 13, 'rgba(255,255,255,0.55)', 'left', '600');
      text(`LV ${level}`, 16, topPad + 20, 17, hsl((200 + level * 24) % 360, 85, 72), 'left', '800');

      // First-launch prompt — shown only until the player takes their first shot,
      // so the opening tap (which just starts the orbit) isn't a surprise.
      if (!launched) {
        ctx.globalAlpha = pulse;
        text('tap to launch when the line turns green', view.w / 2, view.h * 0.86, 16, '#ffffff', 'center', '700');
        ctx.globalAlpha = 1;
      }

      // HYPERJUMP banner during/after a warp.
      const hjAge = time - hyperjumpTime;
      if (hjAge < 2.2) {
        const a = hjAge < 0.18 ? hjAge / 0.18 : 1 - clamp((hjAge - 1.3) / 0.9, 0, 1);
        const pop = 1 + 0.5 * Math.exp(-hjAge * 5);
        ctx.save();
        ctx.globalAlpha = clamp(a, 0, 1);
        ctx.shadowColor = 'rgba(150,205,255,0.95)';
        ctx.shadowBlur = 28;
        text('HYPERJUMP', view.w / 2, view.h * 0.30, Math.min(view.w * 0.14, 48) * pop, 'rgba(230,242,255,0.97)', 'center', '900');
        ctx.shadowBlur = 0;
        text('engaged', view.w / 2, view.h * 0.30 + 30, 15, 'rgba(200,225,255,0.85)', 'center', '700');
        ctx.restore();
        ctx.globalAlpha = 1;
      }
    } else if (state === ST.MENU) {
      const cx = view.w / 2;
      const cy = view.h * 0.34;
      // title
      ctx.save();
      ctx.shadowColor = 'rgba(120,180,255,0.9)';
      ctx.shadowBlur = 24;
      text('ORBITAL', cx, cy, Math.min(view.w * 0.18, 64), '#ffffff');
      ctx.restore();
      text('tap to fling between planets', cx, cy + 42, 15, 'rgba(255,255,255,0.7)', 'center', '600');
      text('the straighter the shot, the bigger the ×multiplier', cx, cy + 66, 13, 'rgba(255,255,255,0.55)', 'center', '600');
      text(`BEST  ${best}   ·   LV ${bestLevel}`, cx, cy + 92, 16, 'rgba(255,255,255,0.55)', 'center', '700');

      ctx.globalAlpha = pulse;
      text('TAP  TO  PLAY', cx, view.h * 0.82, 22, '#ffffff');
      ctx.globalAlpha = 1;
    } else if (state === ST.DEAD) {
      ctx.fillStyle = 'rgba(5,6,16,0.55)';
      ctx.fillRect(0, 0, view.w, view.h);
      const cx = view.w / 2;
      const cy = view.h * 0.36;
      const isBest = score >= best && score > 0;
      text(isBest ? 'NEW BEST!' : 'GAME OVER', cx, cy, 26, isBest ? '#ffe66b' : '#ff7a8a');
      text(String(score), cx, cy + 64, 72, '#ffffff');
      text(`REACHED LEVEL ${level}`, cx, cy + 110, 15, hsl((200 + level * 24) % 360, 85, 72), 'center', '800');
      text(`BEST  ${best}   ·   LV ${bestLevel}`, cx, cy + 138, 14, 'rgba(255,255,255,0.6)', 'center', '700');
      if (time - deathTime > 0.6) {
        ctx.globalAlpha = pulse;
        text('TAP  TO  RETRY', cx, view.h * 0.8, 20, '#ffffff');
        ctx.globalAlpha = 1;
      }
    }

    // Level-up banner — scales in and fades over ~1.8s.
    const bAge = time - bannerTime;
    if (bAge >= 0 && bAge < 1.8) {
      const t = bAge / 1.8;
      const alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      const pop = 1 + 0.5 * Math.exp(-bAge * 7) - Math.min(0.12, bAge * 0.07);
      const bHue = (200 + bannerLevel * 24) % 360;
      ctx.save();
      ctx.globalAlpha = clamp(alpha, 0, 1);
      ctx.shadowColor = hsl(bHue, 90, 60, 0.9);
      ctx.shadowBlur = 26;
      text(`LEVEL ${bannerLevel}`, view.w / 2, view.h * 0.42, Math.min(view.w * 0.16, 58) * pop, hsl(bHue, 90, 75), 'center', '900');
      ctx.shadowBlur = 0;
      text('less help from here on', view.w / 2, view.h * 0.42 + 36, 14, 'rgba(255,255,255,0.7)', 'center', '700');
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    drawMuteButton();
  }

  // ---------- Main loop ----------
  let lastT = 0;
  function frame(now) {
    const dt = lastT ? clamp((now - lastT) / 1000, 0, 0.033) : 0.016;
    lastT = now;

    update(dt);

    drawBackground();
    drawWorld();
    drawUI();

    requestAnimationFrame(frame);
  }

  // ---------- Boot ----------
  resize();
  initBgStars();
  initWorld();
  requestAnimationFrame(frame);

  // Minimal debug/automation hook (harmless in production; handy for testing).
  window.__ORBITAL = {
    get state() { return state; },
    get score() { return score; },
    get combo() { return combo; },
    get mult() { return mult; },
    get level() { return level; },
    get index() { return currentIndex; },
    get best() { return best; },
    get aim() { return aimAlignment(); },
    get orb() {
      return orb && { mode: orb.mode, x: orb.x, y: orb.y, angle: orb.angle, dir: orb.dir, alive: orb.alive };
    },
    get planets() { return planets.map((p) => ({ x: p.x, y: p.y, r: p.r })); },
    tap() { handleTap(); },
    toggleMute() { Audio.toggle(); },
  };
})();
