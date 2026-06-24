# Hyperjump × Scoring/Levels Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the scoring/grades/×multiplier/levels/progressive-difficulty rework with the hyperjump into one coherent game, re-expressing the hyperjump as an earned, between-levels warp.

**Architecture:** Build on top of the `new-scoring-system` branch content (the scoring rework, which has *no* warp code), then *add* the warp infrastructure and a redesigned, level-aligned trigger. Because the two bodies of code don't overlap, this is additive — no git-merge conflict resolution. The hyperjump becomes a `+8`-planet (one-level) warp that fires at the first level boundary where the multiplier is capped (fallback by the level-3 clear), pays out through the existing `levelUp()`, and keeps the warp-speed effect.

**Tech Stack:** Vanilla JS + HTML5 Canvas + Web Audio. No build, no deps, no test framework. Verification is via `node --check` (syntax) and a headless-Chrome harness driving `window.__ORBITAL` (puppeteer-core against the installed Google Chrome; recipe in project memory `playtest-headless.md`).

## Global Constraints

- Zero dependencies, zero build step; single `game.js` IIFE; everything procedural (no asset files). Copied verbatim from the project ethos in `README.md`.
- `PLANETS_PER_LEVEL = 8`; `MULT_CAP = 9` (existing constants on the scoring rework — do not change).
- Warp distance: `HYPERJUMP_SKIP = 8` (one level). Trigger: earned at the first level boundary with `mult >= MULT_CAP`; fallback fires by the level-3 clear (`HYPERJUMP_FALLBACK_LEVEL = 3`). One-shot per run.
- Land flash reserved for milestones only: level-up, hyperjump, perfect shot, death. Normal captures: no full-screen flash.
- No co-author / "Generated with" attribution on commits (user instruction).
- Bump `sw.js` `CACHE` when assets change.

---

### Task 1: Rebase the working tree onto the scoring rework

**Files:**
- Replace from branch: `game.js`, `README.md`, `index.html`, `manifest.webmanifest`, `sw.js`
- Keep: `docs/superpowers/specs/2026-06-24-hyperjump-scoring-integration-design.md` (already committed on this branch)

**Interfaces:**
- Produces: the scoring rework as the working base — `gradeShot()`, `launchDeviation()`, `aimAlignment()`, `capture()` (grade×mult), `levelUp(newLevel)`, `addPopup()`, the progressive difficulty curves (`homingTurn`, `captureSlack`, `flySpeed`, `angSpeed`), `mult`/`level`/`launched`/`popups` state, and the first-tap fix. **No** hyperjump/warp symbols exist yet.

- [ ] **Step 1: Take the five files from `new-scoring-system`**

```bash
cd /Users/tjvisser/dev/websites/orbital
git checkout feat/scoring-hyperjump-integration
git checkout origin/new-scoring-system -- game.js README.md index.html manifest.webmanifest sw.js
```

- [ ] **Step 2: Verify syntax**

Run: `node --check game.js && echo OK`
Expected: `OK`

- [ ] **Step 3: Verify it boots and scoring/levels work (headless harness)**

Start a server (`python3 -m http.server 8731` from repo root) and run a short aim-gated bot (see `playtest-headless.md` recipe; reuse the scratchpad puppeteer-core). Assert: `window.__ORBITAL` exposes `mult`, `level`, `aim`; a precise bot raises `mult` above 1 and `level` to ≥2; 0 console errors. Confirm there is **no** `hyperjumped`/`warpTo` symbol yet (`grep -c "warpTo\|hyperjump" game.js` → `0`).
Expected: scoring/levels behave; no warp code present; 0 errors.

- [ ] **Step 4: Commit**

```bash
git add game.js README.md index.html manifest.webmanifest sw.js
git commit -m "Base integration on the scoring/levels rework"
```

---

### Task 2: Port the warp infrastructure (present but not yet triggered)

**Files:**
- Modify: `game.js` (Audio module; game-state vars; difficulty/constants area; `update()`; `handleTap()`; `drawBackground()`; `drawUI()`)

**Interfaces:**
- Consumes: `cam`, `view`, `time`, `planets`, `currentIndex`, `orb`, `clamp`, `lerp`, `hsl`, `spawnBurst`, `ensureAhead`, `generateNext`, `text()` (all existing).
- Produces: `warping()` → bool, `warpT()` → 0..1, `warpTo(index)` → void, `Audio.hyperjump()`, and the state `hyperjumped`/`hyperjumpTime`/`warpFromX`/`warpFromY`. The warp visual + camera sweep + death-check suspension are wired but nothing calls `warpTo()` yet (so behaviour is unchanged this task).

- [ ] **Step 1: Add the warp sound to the `Audio` return object** (after `star()`)

```js
      hyperjump() {
        // accelerating warp whoosh: pitch sweeps up, noise filter opens
        tone(140, 1500, 0.75, 'sawtooth', 0.16);
        tone(70, 760, 0.75, 'sine', 0.12);
        noise(0.75, 0.14, 240, 7000);
        tone(900, 2400, 0.5, 'triangle', 0.06);
      },
```

- [ ] **Step 2: Add warp state vars** (next to the other game-state `let`s, near `hyperjumpTime` does not exist yet — add the whole group)

```js
  let hyperjumped = false;     // one-shot hidden hyperjump fired this run?
  let hyperjumpTime = -10;     // time it last fired (drives warp animation + banner)
  let warpFromX = 0, warpFromY = 0;  // camera position captured at the warp's start
```

- [ ] **Step 3: Reset that state in `initWorld()`** (with the other resets)

```js
    hyperjumped = false;
    hyperjumpTime = -10;
```

- [ ] **Step 4: Add warp constants + helpers** (near `MULT_CAP`/`PLANETS_PER_LEVEL`)

```js
  const WARP_DUR = 0.9;                 // seconds the warp animation runs after a jump
  const HYPERJUMP_SKIP = 8;             // planets warped (one level)
  const HYPERJUMP_FALLBACK_LEVEL = 3;   // guaranteed warp by this level clear
  function warping() { return time - hyperjumpTime < WARP_DUR; }
  function warpT() { return clamp(1 - (time - hyperjumpTime) / WARP_DUR, 0, 1); }
```

- [ ] **Step 5: Add the `warpTo(index)` function** (just before `capture()`)

```js
  // Instantly move the orb to a far-ahead planet. Re-anchors it on the
  // destination's orbit; the camera is NOT snapped (it sweeps in over the warp,
  // see update()), and the off-screen death check is suspended while warping().
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
```

- [ ] **Step 6: Add the warp camera sweep in `update()`** — replace the existing camera follow block

Find:
```js
    const k = clamp(dt * 4.5, 0, 1);
    cam.x = lerp(cam.x, tx, k);
    cam.y = lerp(cam.y, ty, k);
```
Replace with:
```js
    if (warping()) {
      // sweep the camera forward across the skipped level, eased, so the jump
      // reads as fast forward travel
      const p = 1 - warpT();
      const e = p * p * (3 - 2 * p);    // smoothstep
      cam.x = lerp(warpFromX, tx, e);
      cam.y = lerp(warpFromY, ty, e);
    } else {
      const k = clamp(dt * 4.5, 0, 1);
      cam.x = lerp(cam.x, tx, k);
      cam.y = lerp(cam.y, ty, k);
    }
```

- [ ] **Step 7: Guard the off-screen death check with `!warping()`** in `update()`

Find `if (state === ST.PLAYING) {` (the death-check block with `sx/sy`/`M`) and change the condition to:
```js
        if (state === ST.PLAYING && !warping()) {
```

- [ ] **Step 8: Lock input during the warp** in `handleTap()` — in the `ST.PLAYING` branch

Change:
```js
    } else if (state === ST.PLAYING) {
      launch();
```
to:
```js
    } else if (state === ST.PLAYING) {
      if (warping()) return;   // ignore taps mid-warp; the jump is on rails
      launch();
```

- [ ] **Step 9: Add warp streaks to `drawBackground()`** — replace the parallax-star draw loop body

Find the loop that draws each `st` as `ctx.fillRect(x, y, st.s, st.s)` and replace its body with:
```js
      const tw = 0.55 + 0.45 * Math.sin(time * 2 + st.tw);
      if (warpT() > 0.02) {
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
```
(Keep the existing `let x = ...; let y = ...; wrap` lines above it and the `ctx.globalAlpha = 1;` after the loop.)

- [ ] **Step 10: Add the HYPERJUMP banner in `drawUI()`** — inside the `state === ST.PLAYING` block, after the score/mult/level HUD

```js
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
```

- [ ] **Step 11: Verify syntax + boot unchanged**

Run: `node --check game.js && echo OK`. Then boot the harness (Task 1 Step 3 style) and confirm normal play is unchanged and 0 console errors (no warp can fire yet — `hyperjumped` never set).
Expected: `OK`; identical behaviour to Task 1; 0 errors.

- [ ] **Step 12: Commit**

```bash
git add game.js
git commit -m "Port warp-speed infrastructure onto the scoring rework"
```

---

### Task 3: Wire the earned, between-levels warp trigger + payout

**Files:**
- Modify: `game.js` (`capture()` level-progression tail; add `hyperjumpWarp()` helper)

**Interfaces:**
- Consumes: `warpTo()`, `levelUp()`, `mult`, `MULT_CAP`, `currentIndex`, `PLANETS_PER_LEVEL`, `cam`, `Audio.hyperjump()`, `hyperjumped`/`hyperjumpTime`/`warpFromX/Y` (Task 2).
- Produces: `hyperjumpWarp()` → void. After this task the warp fires exactly once per run per the spec.

- [ ] **Step 1: Add the `hyperjumpWarp()` helper** (just after `warpTo()`)

```js
  // Earned between-levels warp: advance one level, landing on the next boundary,
  // and pay it out through the destination's normal level-up (banner/bonus/theme).
  function hyperjumpWarp() {
    hyperjumped = true;
    hyperjumpTime = time;
    warpFromX = cam.x; warpFromY = cam.y;
    warpTo(currentIndex + HYPERJUMP_SKIP);
    const destLevel = Math.floor(currentIndex / PLANETS_PER_LEVEL) + 1;
    if (destLevel > level) levelUp(destLevel);   // LEVEL banner + bonus + theme
    shake = Math.max(shake, 16);
    flash = 0.5; flashHue = 205;                 // cool-blue warp flash (milestone)
    spawnBurst(orb.x, orb.y, 205, 46, 2.8);
    Audio.hyperjump();
  }
```

- [ ] **Step 2: Trigger it from `capture()`** — replace the level-progression tail

Find:
```js
    // Level progression — every PLANETS_PER_LEVEL captured planets.
    const newLevel = Math.floor(currentIndex / PLANETS_PER_LEVEL) + 1;
    if (newLevel > level) levelUp(newLevel);
  }
```
Replace with:
```js
    // Level progression — every PLANETS_PER_LEVEL captured planets.
    const prevLevel = level;
    const newLevel = Math.floor(currentIndex / PLANETS_PER_LEVEL) + 1;
    if (newLevel > level) levelUp(newLevel);

    // Earned between-levels warp (one-shot). At a level-boundary clear, if the
    // multiplier is capped (earned) or we've hit the fallback level, warp one
    // level forward and pay it out as the destination level-up.
    if (!hyperjumped && newLevel > prevLevel &&
        (mult >= MULT_CAP || newLevel >= HYPERJUMP_FALLBACK_LEVEL)) {
      hyperjumpWarp();
    }
  }
```

- [ ] **Step 3: Expose `hyperjumped` on the debug hook** (in `window.__ORBITAL`, next to `get level`)

```js
    get hyperjumped() { return hyperjumped; },
```

- [ ] **Step 4: Write the verification harness** `scratchpad/verify-warp.mjs`

Drive headless Chrome with two in-page autopilots (reuse the aim-computation from `playtest-headless.md`):
- **Earned bot:** fire only when `aim >= 0.97` (near-perfect) so `mult` caps fast. Record: the index/level/state at the frame `hyperjumped` flips true, and 25 frames after.
- **Fallback bot:** fire when `aim >= 0.55` (sloppier, rarely caps). Record the same.
Assert for each: `hyperjumped` becomes true; the orb's `index` jumps by `+8`; landing index is a multiple of 8 (a boundary); `state` stays `1` (PLAYING) through and after the warp (no death); play continues (index later increases past the landing). Collect console errors.

- [ ] **Step 5: Run it — expect earned fires early & shallow, fallback by level 3, both survive**

Run: `node scratchpad/verify-warp.mjs`
Expected (JSON): `errors: []`; earned bot warps at a level-2 boundary (land index 16) when it caps; fallback bot warps at the level-3 clear (fire index 16 → land index 24); both `survived: true` and `progressedAfter: true`.

- [ ] **Step 6: Verify scoring is coherent (no flat +20, no combo inflation)**

In the same harness, sample `score` and `combo` one frame before and one frame after the warp. Assert: the post-warp `score` increase equals only the **destination level bonus** (`destLevel * 25`) plus the triggering capture's normal `grade × mult` (no extra flat 20); `combo` increases by **0** across the warp itself (the warp doesn't touch combo).
Expected: score delta matches `gradeXmult + destLevel*25`; combo unchanged by the warp.

- [ ] **Step 7: Commit**

```bash
git add game.js
git commit -m "Earned between-levels hyperjump: trigger + levelUp payout"
```

---

### Task 4: Reserve the land flash for milestones

**Files:**
- Modify: `game.js` (`capture()` flash line)

**Interfaces:**
- Consumes: `tier` (local in `capture()`), `flash`, `flashHue`.
- Produces: no new symbols. Normal GOOD/GREAT/GRAZE captures no longer flash; PERFECT, level-up (0.45), hyperjump (0.5), death (0.6) flashes remain.

- [ ] **Step 1: Restrict the per-capture flash to PERFECT only**

Find:
```js
    flash = (tier.name === 'PERFECT' ? 0.4 : 0.28); flashHue = tier.hue;
```
Replace with:
```js
    // Land flash reserved for milestones — only PERFECT captures flash; GOOD/
    // GREAT/GRAZE rely on shake + burst + planet pulse (no full-screen wash).
    if (tier.name === 'PERFECT') { flash = 0.4; flashHue = tier.hue; }
```

- [ ] **Step 2: Verify the flicker is gone**

Run: `node --check game.js && echo OK`. Then in the harness, drive ~20 normal (GOOD/GREAT) captures and assert `flash` stays at/near 0 across them (sample `flash` is not exposed — instead assert no full-screen wash by capturing two screenshots mid-capture and confirming no uniform colour cast; or expose `get flash()` on `__ORBITAL` temporarily for the assert and remove it after).
Expected: no per-capture screen wash; milestone flashes (level-up/hyperjump/perfect/death) still fire.

- [ ] **Step 3: Commit**

```bash
git add game.js
git commit -m "Reserve the land flash for milestones, not every capture"
```

---

### Task 5: HUD reconciliation, full playtest, ship

**Files:**
- Modify: `game.js` (only if the HYPERJUMP and LEVEL banners visually collide), `sw.js` (cache bump)

**Interfaces:**
- Consumes: everything above.
- Produces: the shipped integrated game.

- [ ] **Step 1: Visually reconcile the warp + level banners**

Capture a screenshot at the warp frame (harness: screenshot ~0.2s after `hyperjumped` flips). The HYPERJUMP banner sits at `view.h*0.30`; the LEVEL banner (from `levelUp`) sits at its own y. Confirm they stack legibly (HYPERJUMP above, LEVEL below). If they overlap, move the LEVEL banner's y down by ~0.06·h *only during* `warping()`; otherwise leave it. Record the decision in the commit message.
Expected: both banners readable during the warp.

- [ ] **Step 2: Full integration playtest**

Run the Task 3 harness for a longer session (~45s) with the earned bot. Assert: reaches deep levels, exactly one warp per run, 0 console errors, `mult`/`level`/popups/first-tap all behaving, the milestone-only flash in effect.
Expected: clean run, single warp, 0 errors.

- [ ] **Step 3: Bump the service-worker cache**

In `sw.js` change the `CACHE` constant to the next version (e.g. `orbital-v4`).

- [ ] **Step 4: Update the README "How to play" with the new warp behaviour**

Add one line under the level bullet: cap your ×multiplier to earn an early hyperjump that warps you a level forward (otherwise it triggers by level 3). Keep the website-copy voice (no em dashes).

- [ ] **Step 5: Final syntax + commit**

```bash
node --check game.js && echo OK
git add game.js sw.js README.md
git commit -m "Reconcile HUD banners, bump cache, document the warp"
```

- [ ] **Step 6: Push and open a PR**

```bash
git push -u origin feat/scoring-hyperjump-integration
gh pr create -R visseranalytics/orbital --base main --head feat/scoring-hyperjump-integration \
  --title "Scoring/levels rework + level-aligned hyperjump" --body-file <(printf '%s\n' "<summary referencing the spec and design panel>")
```

---

## Self-Review

**Spec coverage:**
- Foundation kept (grades/mult/levels/difficulty/first-tap/popups/copy) → Task 1 (base) ✓
- Hyperjump = earned, between-levels, +8 to boundary → Task 3 (trigger `mult >= MULT_CAP` || fallback level 3; `warpTo(currentIndex + HYPERJUMP_SKIP)`) ✓
- No difficulty cliff (lands one level up) → Task 3 (`+8` boundary landing) + Task 3 Step 5 (survival assert) ✓
- Coherent scoring (no flat +20 / combo inflation; pay via `levelUp`) → Task 3 (`hyperjumpWarp` calls `levelUp(destLevel)`, no combo bump) + Step 6 (score/combo assert) ✓
- Warp-speed effect kept → Task 2 (camera sweep, streaks, whoosh, banner, input lock, death-check guard) ✓
- Land flash reserved for milestones → Task 4 ✓
- Implementation = additive on the rework, not a conflicted merge → Task 1 strategy ✓

**Placeholder scan:** PR body in Task 5 Step 6 is the only `<…>`; it's a one-line summary to fill at execution (the spec/panel content exists). All code steps contain complete code. No "add error handling"/"TBD".

**Type/name consistency:** `warping()`, `warpT()`, `warpTo(index)`, `hyperjumpWarp()`, `HYPERJUMP_SKIP`, `HYPERJUMP_FALLBACK_LEVEL`, `WARP_DUR`, `hyperjumped`, `hyperjumpTime`, `warpFromX/Y` are defined in Task 2 and used consistently in Task 3. `MULT_CAP`/`PLANETS_PER_LEVEL`/`levelUp`/`gradeShot` are existing names confirmed from the branch read.
