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
      star() { tone(1040, 1560, 0.10, 'triangle', 0.18); },
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
  let combo = 0;
  let best = store.best;

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
    currentIndex = 0;
    score = 0;
    combo = 0;
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
  const flySpeed = (lvl) => clamp(430 + lvl * 7, 430, 720);
  const angSpeed = (lvl) => clamp(2.5 + lvl * 0.04, 2.5, 3.8);
  const homingTurn = (lvl) => clamp(3.2 - lvl * 0.03, 1.6, 3.2);

  // ---------- Actions ----------
  function launch() {
    if (!orb || orb.mode !== 'orbit') return;
    const a = orb.angle;
    const tx = -Math.sin(a) * orb.dir;
    const ty = Math.cos(a) * orb.dir;
    const sp = flySpeed(currentIndex);
    orb.vx = tx * sp;
    orb.vy = ty * sp;
    orb.mode = 'fly';
    orb.planet = null;
    flightTime = 0;
    Audio.launch();
    spawnBurst(orb.x, orb.y, planets[currentIndex].hue, 8, 1.4);
  }

  function capture(p, idx) {
    attachToPlanet(p, { x: orb.vx, y: orb.vy });
    currentIndex = idx;
    p.reached = true;
    p.pulse = 1;
    score += 1;
    combo += 1;
    ensureAhead();
    shake = Math.min(shake + 5, 14);
    flash = 0.28; flashHue = p.hue;
    spawnBurst(orb.x, orb.y, p.hue, 16 + Math.min(combo, 16), 2.0);
    Audio.capture(combo);
    globalHue = 200 + currentIndex * 4;
  }

  function die() {
    if (state !== ST.PLAYING) return;
    state = ST.DEAD;
    deathTime = time;
    orb.alive = false;
    best = Math.max(best, score);
    store.best = best;
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

  // ---------- Input ----------
  function handleTap() {
    Audio.ensure();
    if (state === ST.MENU) {
      state = ST.PLAYING;
      launch();
    } else if (state === ST.PLAYING) {
      launch();
    } else if (state === ST.DEAD) {
      if (time - deathTime > 0.6) {
        initWorld();
        state = ST.PLAYING;
        launch();
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
    const k = clamp(dt * 4.5, 0, 1);
    cam.x = lerp(cam.x, tx, k);
    cam.y = lerp(cam.y, ty, k);

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
            score += 3;
            combo += 1;
            flash = 0.18; flashHue = 50;
            spawnBurst(s.x, s.y, 50, 14, 1.6);
            Audio.star();
          }
        }

        // capture next planet
        if (next) {
          const capR = next.r + 34;
          if (dist2(orb.x, orb.y, next.x, next.y) < capR * capR) {
            capture(next, currentIndex + 1);
          }
        }

        // death checks: off-screen or stuck flying too long
        if (state === ST.PLAYING) {
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
      ctx.globalAlpha = (0.25 + st.z * 0.6) * tw;
      ctx.fillStyle = '#cfe3ff';
      ctx.fillRect(x, y, st.s, st.s);
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
    ctx.save();
    ctx.setLineDash([3, 7]);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(orb.x, orb.y);
    ctx.lineTo(orb.x + tx * 70, orb.y + ty * 70);
    ctx.stroke();
    ctx.restore();
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
      if (combo >= 3) {
        text(`x${combo} streak`, view.w / 2, topPad + 52, 15, hsl((time * 90) % 360, 90, 75), 'center', '700');
      }
      text(`BEST ${best}`, 16, topPad, 13, 'rgba(255,255,255,0.55)', 'left', '600');
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
      text(`BEST  ${best}`, cx, cy + 74, 16, 'rgba(255,255,255,0.55)', 'center', '700');

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
      text(`BEST  ${best}`, cx, cy + 116, 16, 'rgba(255,255,255,0.6)', 'center', '700');
      if (time - deathTime > 0.6) {
        ctx.globalAlpha = pulse;
        text('TAP  TO  RETRY', cx, view.h * 0.8, 20, '#ffffff');
        ctx.globalAlpha = 1;
      }
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
    get index() { return currentIndex; },
    get best() { return best; },
    get orb() {
      return orb && { mode: orb.mode, x: orb.x, y: orb.y, angle: orb.angle, dir: orb.dir, alive: orb.alive };
    },
    get planets() { return planets.map((p) => ({ x: p.x, y: p.y, r: p.r })); },
    tap() { handleTap(); },
    toggleMute() { Audio.toggle(); },
  };
})();
