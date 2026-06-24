# ORBITAL 🪐

A one-thumb arcade game. Your orb circles a planet — **tap** to fling it off on a
tangent toward the next planet, where it snaps into orbit. Time it wrong and you
sail off into the void. Climb as high as you can, collect stars, build a streak.

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

No configuration required — there is no build command and no output directory to
set (use "Other"/"static" if the host asks).

## How to play

- The orb auto-orbits the planet it's attached to. The dotted line shows the
  direction it will launch **right now**.
- **Tap** (anywhere) to launch. A gentle gravity-assist curves you toward the
  next planet, so being roughly aimed is enough — but launch backwards and you'll
  miss.
- Reach the next planet's halo to capture it (+1). Fly through a star for +3.
- Each capture raises your streak; the higher you climb the faster and tighter it
  gets. Best score is saved automatically.

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

- **Difficulty curves** — `flySpeed`, `angSpeed`, `homingTurn`, `planetRadius`
  and `generateNext()` control speed, orbit rate, forgiveness, planet size, and
  gap distance as you climb.
- **Feel/juice** — `spawnBurst`, `shake`, `flash`, and the `draw*` functions.
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
