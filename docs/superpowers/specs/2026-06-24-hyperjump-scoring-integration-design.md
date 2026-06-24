# ORBITAL — Hyperjump × Scoring/Levels Integration (Design)

**Date:** 2026-06-24
**Status:** Approved design, pending spec review

## Context & problem

Two divergent reworks of the same game must become one:

- **`main`** = original ORBITAL + the hidden hyperjump (PR #1) + the instakill fix & warp-speed effect (PR #2). Scoring is still the original `+1` per capture, `+3` per star.
- **`new-scoring-system`** = precision grading (PERFECT/GREAT/GOOD/GRAZE) → ×multiplier scoring, levels every 8 planets, progressive index-keyed difficulty, the first-tap fix, floating popups, refreshed copy. It was branched **before** the hyperjump, so it has none of it.

Both branches heavily rewrite `capture()`, `update()`, the difficulty curves, and the HUD — they conflict exactly where it matters. And the hyperjump, as shipped, breaks the new model three ways:

1. **Scoring is funky** — a flat `score += 20` sitting next to `grade × mult` (a single capture can already be `5 × 9 = 45`), plus `combo += 20` inflating the streak counter.
2. **Difficulty cliff** — the `+20` teleport lands you at planet 40, the *hardest tuning the game ever reaches* (homing floored at 0.55, catch window floored at 11px), so it "gets hard right off the bat" — an unfair near-instant death.
3. **Levels skipped** — `+20` planets crosses ~2.5 level boundaries whose banners/bonuses/theme shifts never fire.

## Goal

One coherent game. Keep the scoring/levels/difficulty rework as the foundation, and re-express the hyperjump as a **between-levels warp** that speaks the game's own units (levels and grade×mult), with **no difficulty cliff** and **no scoring anomaly**, while keeping the well-liked warp-speed effect. Also calm the per-capture screen flash.

## Foundation (kept from the rework, unchanged)

- Precision grades GRAZE/GOOD/GREAT/PERFECT from launch deviation; base points 1/2/3/5.
- **×multiplier** (cap 9): `+1` on GREAT/PERFECT, holds on GOOD, halves on GRAZE, resets to 1 on death. `score = base × mult`. Stars pay `3 × mult`.
- **Levels** every 8 planets via `levelUp()`: banner, colour-theme shift, `level × 25` bonus, difficulty step. Best score **and** best level saved.
- **Progressive difficulty** keyed to planet index: homing fades (~2.8 → 0.55), catch window tightens (~40 → 11px), fly speed rises (430 → 720), orbit sweep speeds up (2.5 → 3.8), planets shrink (30 → 15px), gaps widen. A dead-straight shot still lands with no assist, so depth punishes *imprecision* specifically.
- First-tap fix (opening tap starts the orbit; the next tap is your first aimed launch), floating score/grade popups, refreshed in-game + README copy.

## The change — hyperjump as an earned, between-levels warp

### Trigger (earned, with a guaranteed fallback)
One-shot per run, evaluated at each level-boundary clear (inside `levelUp()`):

- **Earned:** the first level boundary reached with the multiplier **at cap (×9)** fires the warp. (A flawless opening — 8 straight GREAT/PERFECT shots — caps ×9 by the level-2 clear at index 8.)
- **Fallback:** if you reach the **level-3 clear (index 16)** without having triggered it, it fires there regardless. So **every run gets exactly one**, by level 3 at the latest.

### Distance & landing
`warpTo(currentIndex + 8)` — advance exactly **one level**, landing **on the next level boundary**:

- Earned-early example: cap ×9 by the level-2 clear (index 8) → warp → land **index 16** (level-3 start).
- Fallback example: fire at the level-3 clear (index 16) → warp → land **index 24** (level-4 start).

Because it always lands on a boundary one level up, it is a single **normal difficulty step**, never the floored deep end. Verified against the real curves: landing at index 24 → homing 1.24 / catch ~15px (the exact step you'd feel climbing 3→4 by hand), versus the discarded index-40 landing → homing 0.55 / catch 11px (the cliff). The orb re-anchors at rest (`angle = π/2`), so the first post-warp shot is a free orbit-and-aim with no instant-death geometry.

### Scoring (coherent, no anomaly)
No flat `+20`, no `combo += 20`. The warp pays out purely in the game's own currency:

- The triggering capture scores its normal `grade × mult`.
- On arrival, the warp calls the existing **`levelUp(destinationLevel)`**, so the destination level's **banner, theme shift, and `level × 25` bonus** all fire as the warp settles, and it reads as a fast, free level-up.
- The multiplier is untouched by the warp (it's at cap when earned; the fallback leaves it as-is). `combo` is no longer bumped.

Net payout is a free level — deliberately **less** than grinding the level by hand (~8 graded captures), so the warp is a fair shortcut, never a score exploit.

### Warp-speed effect (kept verbatim)
The ~0.9s effect carries over unchanged: eased camera sweep across the skipped level, stars stretched into warp streaks, the rising whoosh, the blue flash, the glowing **HYPERJUMP** banner, and input locked during `warping()`. It now reads as the level transition. The off-screen death check stays suspended while `warping()` (the root-cause instakill fix from PR #2).

## Land-flash change

Reserve the full-screen flash for **milestones only**: level-up, hyperjump, perfect shot, death. Normal captures use the existing shake + particle burst + planet pulse, with **no screen wash**. This removes the per-capture flicker and prevents it compounding with the rework's extra flashes (PERFECT, level-up).

## Implementation approach

The two branches diverge inside the hotspots, so **re-apply the scoring rework onto current `main`** (cleaner and lower-risk than a conflict-heavy `git merge`), carrying the warp infrastructure (`warpTo`/`warpT`/`warpFrom`/the effect) across and re-pointing the hyperjump trigger + payout per this design. Expected touch points:

- `capture()` — grades + mult + level progression; remove the old `score += 20 / combo += 20` block.
- `levelUp()` — host the earned-warp trigger; called again on warp arrival for the destination level.
- `warpTo()` — reused as-is (`+8`).
- `update()` — warp camera sweep + death-check guard (already on `main`) reconciled with the rework's popup updates and first-tap state.
- difficulty curves — the rework's progressive values.
- `drawUI()` — multiplier badge, level readout, popups, and the HYPERJUMP/level banners reconciled; apply the milestone-only flash policy.
- `drawBackground()` — warp streaks.
- `Audio` — `perfect()` / `levelup()` / `hyperjump()` sounds.
- `sw.js` — bump cache.

## Testing

Headless-Chrome harness driving `window.__ORBITAL` (recipe in project memory):

- **Earned trigger:** an aim-gated (precise) bot caps ×9 and fires the warp at an early boundary; verify it lands on the next boundary, survives, and keeps climbing.
- **Fallback:** a sloppier bot never caps but still gets exactly one warp by the level-3 clear, and survives the landing.
- **Scoring:** the warp adds only the destination level bonus (no flat +20, no combo spike); per-capture score equals `grade × mult`.
- **Difficulty:** the post-warp landing is survivable (no instant death) for both bots.
- `node --check game.js`; 0 console errors across runs.

## Decisions locked

- Leap size: **+8 (one level)**, landing on the next boundary.
- Trigger: **earned by ×9 cap**, fallback guarantees one by the level-3 clear.
- Land flash: **reserve for milestones**.
- Core scoring / levels / progressive difficulty: **kept as the rework already has them**.
