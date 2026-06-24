# ORBITAL 🪐

A one-thumb arcade game. Your orb circles a planet. **Tap** and it flings off on a
tangent toward the next one, snapping into orbit when it gets there. Mistime the
tap and you sail off into the void.

The trick is to **fire when the aim line turns green**, so the orb flies *straight*
at the next planet instead of looping around it. Clean shots score `PERFECT` or
`GREAT` and **stack a ×multiplier**; a sloppy `GRAZE` knocks it back down. The
deeper you climb, the less the game helps you land, so aim true and chase a
runaway multiplier.

Built to be **free, simple, and effortless to maintain**:

- **Zero dependencies, zero build step.** Just static files: HTML + CSS + one
  vanilla-JS file using `<canvas>`. Open `index.html` and it runs.
- **No backend, no database, no accounts.** High scores live in `localStorage`.
  Nothing to host beyond static files, nothing to pay for, nothing to break.
- **Procedural everything.** Art is drawn with Canvas; sound is synthesized live
  with the Web Audio API. No image/audio assets to license or manage.
- **Installable PWA.** Add to Home Screen for a fullscreen, offline-capable app
  (service worker caches everything on first load).

## Play locally

Any static file server works. Two easy options:

```bash
# Python (built into macOS/Linux)
python3 -m http.server 8000

# or Node
npx serve .
```

Then open the printed URL on your phone or desktop browser. On desktop you can
also press **Space** to tap and **M** to mute.

> A plain `file://` open mostly works too, but the service worker (offline mode)
> only activates over `http(s)://` or `localhost`.

## Deploy (free)

It's just static files, so any static host works. Examples:

```bash
# Vercel
npx vercel        # preview
npx vercel --prod # production

# Cloudflare Pages
npx wrangler pages deploy .

# GitHub Pages
# push the folder to a repo and enable Pages on the root.
```

No configuration required. There's no build command and no output directory to
set (use "Other"/"static" if the host asks).

## How to play

- Your orb auto-orbits whatever planet it's on. The dotted line shows where it
  will launch right now, shifting from **red to green** as that line swings onto
  the next planet. Green means you're pointed straight at it.
- **Tap** anywhere to launch. A little gravity-assist still bends your path toward
  the next planet, so a rough aim usually lands, but only a clean *straight* shot
  scores big.
- Every capture is **graded** on how straight the shot was:
  `PERFECT` › `GREAT` › `GOOD` › `GRAZE`. You score the grade's value times your
  **multiplier**.
- `GREAT` and `PERFECT` push the **×multiplier** up, `GOOD` holds it steady, and a
  sloppy `GRAZE` halves it. Only dying drops it back to ×1. String clean shots
  together and the score snowballs. Stars also pay out at your current multiplier.
- Clear a **level** every **8 planets**: the colors shift and you bank a bonus.
  The deeper you climb, the less gravity-assist you get and the tighter the catch
  window, so precise aim matters more and more.
- Cap your **×multiplier** to earn a hidden **hyperjump** — a warp that launches
  you a level forward. Don't cap it and you still get one by level 3.
- Your best score and best level are saved automatically.

## Project layout

| File | Purpose |
|------|---------|
| `index.html` | Page shell + service-worker registration |
| `style.css` | Full-bleed canvas, disables mobile scroll/zoom |
| `game.js` | The whole game: state machine, physics, audio, rendering |
| `manifest.webmanifest` | PWA metadata (name, icons, colors) |
| `sw.js` | Offline cache (bump `CACHE` version when you ship changes) |
| `icon.svg` / `icons/*` | App icons (regenerate with the command below) |

## Tweaking the game

All the knobs are near the top/middle of `game.js`:

- **Difficulty curves** — `flySpeed`, `angSpeed`, `homingTurn`, `captureSlack`,
  `planetRadius` and `generateNext()` control speed, orbit rate, gravity-assist,
  catch-window size, planet size, and gap distance as you climb. The deeper you
  go the more *sensitive* the survival physics get: `homingTurn` fades and
  `captureSlack` shrinks with depth, so your aim must be truer to land. (Lower
  their floors / steepen their slopes for an even harsher ramp.)
- **Scoring & grades** — `TIERS` defines each grade's deviation threshold, base
  points, and multiplier behavior; `MULT_CAP` caps the multiplier;
  `gradeShot()`/`aimAlignment()` do the straight-shot math.
- **Levels** — `PLANETS_PER_LEVEL` sets the cadence; `levelUp()` handles the
  banner, bonus, and sting.
- **Feel/juice** — `spawnBurst`, `addPopup`, `shake`, `flash`, and the `draw*`
  functions (incl. the colored aim line in `drawAimHint`).
- **Audio** — the `Audio` module synthesizes every sound; tweak frequencies there.

`window.__ORBITAL` exposes a small read/control hook (state, score, `tap()`)
that's handy for debugging or automated testing.

### Regenerate icons

If you edit `icon.svg`:

```bash
rsvg-convert -w 192 -h 192 icon.svg -o icons/icon-192.png
rsvg-convert -w 512 -h 512 icon.svg -o icons/icon-512.png
rsvg-convert -w 180 -h 180 icon.svg -o icons/apple-touch-icon.png
rsvg-convert -w 512 -h 512 icon.svg -o /tmp/core.png
magick /tmp/core.png -resize 410x410 -background "#05060f" -gravity center -extent 512x512 icons/icon-maskable-512.png
```

Bump `CACHE` in `sw.js` whenever you change assets so installed clients update.

## License

Do whatever you want with it.
