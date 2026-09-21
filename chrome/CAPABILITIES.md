# Chrome/browser capabilities — what's actually needed (Areny web app)

**Context:** debugging and manually verifying the Areny Flutter web app
(`flutter run -d web-server`, CanvasKit renderer) during development, plus
occasionally the Firebase Emulator Suite UI (a normal web app, not Flutter) at
`localhost:4000`. Written from real usage this session with the
`claude-in-chrome` MCP — not a spec of that MCP's full surface, only the parts
that got used and the parts that turned out not to work for this app.

## The one fact that shapes everything else

**Flutter Web with the CanvasKit renderer paints to a `<canvas>`, not real
DOM.** Every DOM/accessibility-based tool tried against the running app this
session came back empty or useless:

- `get_page_text` → `"No text content found. Page may contain only images,
  videos, or canvas-based content."`
- `read_page` (accessibility tree) → a single `generic [ref_1]` node, nothing
  else, even on a fully-rendered screen with dozens of visible widgets.
- `find` (natural-language element search) → `"no elements matching... the
  accessibility tree contains generic containers... none of these are
  specifically labeled"`.

So a replacement built around DOM scraping/selectors (the thing most
lightweight "use CDP directly" scripts optimize for) buys nothing here. The
only thing that reliably works is **look at a screenshot, click/type at pixel
coordinates**. Budget for that up front rather than discovering it mid-task.

(The Firebase Emulator Suite UI at `localhost:4000` is a normal React-ish app,
not canvas — DOM tools would likely work fine there if ever needed. It just
wasn't needed this session; see "Not needed" below.)

## Required capabilities

| Capability | Why | Used this session for |
|---|---|---|
| Navigate to a URL | Open the app / a specific route | `localhost:8000`, direct deep links like `.../couponFormScreen?couponId=...` |
| Screenshot the viewport | The *only* reliable way to see UI state (see above) | Checking login screen, picker layout, RTL |
| Click at (x, y) | Primary interaction — no clickable DOM elements to target | Tapping buttons, checkboxes, list rows |
| Type text | Fill text fields | Not yet exercised this session but needed for any form work |
| Key press | Enter/Tab/Escape, etc. | Not yet exercised, but standard |
| Scroll | Long forms, sheets | Scrolling the coupon form to reach the category section |
| Wait a fixed duration | Let an async build/emulator connection settle before the next screenshot | Waiting after navigation before screenshotting |
| Read browser console output | Flutter's `logInfo`/`logError` go straight to `console.*` — the only structured signal available, since there's no DOM to inspect for state | Diagnosing provider/init errors during dev |

That's the full list actually used. Everything below is either "sometimes
useful, didn't come up this session" or "not needed at all."

## What replaces this: `chrome/` CLI tools, and their cost

Every capability above, plus all three "occasionally useful" ones below, is
now covered by a script in this folder, connecting to Chrome over CDP instead
of through the `claude-in-chrome` MCP:

| Capability | Script | Approx. tokens/call (this tool vs MCP) |
|---|---|---:|
| Navigate | `chrome-nav.js` | 18 vs 56 |
| Screenshot | `chrome-screenshot.js` | 25 vs 65 (MCP also returns an inline image, billed separately — see BENCHMARK.md) |
| Click at (x, y) | `chrome-click.js` | 10 vs 57 |
| Type text | `chrome-type.js` | 12 vs 56 |
| Key press | `chrome-key.js` | 9 vs 54 |
| Scroll | `chrome-scroll.js` | not separately benchmarked; same connect pattern as click |
| Wait | `chrome-wait.js` | trivial, no MCP equivalent needed |
| Read console | `chrome-console.js` | 59 vs 76 |
| Read network requests | `chrome-network.js` | 35 vs 65 |
| Execute JS | `chrome-eval.js` | 12 vs 64 |
| Multiple tabs (list/switch) | `chrome-tabs.js` | 44 vs 154 (open+list), plus the MCP requires explicit cleanup (`tabs_close_mcp`) this tool has no equivalent for |

**Total cost, one session of the 11 benchmarked calls above:**

| | Initial load | 11 calls | Total |
|---|---:|---:|---:|
| MCP (8 relevant tools) | ~3,592 | ~776 | **~4,369** |
| This tool (chrome/*.js) | ~590 | ~224 | **~814** |

**~81% fewer tokens.** Full methodology and caveats (including why the
per-call gap is unusually large here, not just the schema tax):
[`methodology/chrome-example/BENCHMARK.md`](../methodology/chrome-example/BENCHMARK.md).
Setup: [`../REQUIREMENTS.md`](../REQUIREMENTS.md#chrome).
How to actually use it: [`README.md`](README.md).

## Occasionally useful, not required day-to-day

- **Read network requests.** Useful for Auth/Firestore REST calls hitting the
  emulator (e.g. confirming a sign-in request actually reached
  `localhost:9099`) or spotting a failed request. Didn't end up needing it
  this session, but it's cheap to keep if the replacement already exposes CDP
  network events.
- **Execute arbitrary JS in the page.** For poking `localStorage`/IndexedDB
  (Firebase Auth persistence) or checking a global like
  `window.flutterConfiguration`. Occasional, not routine.
- **Multiple tabs.** Only matters if comparing two sessions side by side
  (e.g. store-owner vs. customer view). Rare.

## Not needed

- **Accessibility tree / DOM query / "find by text or purpose."** Doesn't work
  against this app at all (see above). Don't build a replacement around it.
- **GIF/video recording.** Never used for debugging; screenshots are enough.
- **Form autofill helpers** (the kind that target `<input>` elements by
  label/placeholder). Flutter Web doesn't expose real form-field DOM
  reliably — same problem as the accessibility tree.
- **JS dialog handling** (`alert`/`confirm`/`prompt`). Haven't hit one in this
  app; it mostly uses in-app `Dialog`/`BottomSheet` widgets, which are just
  more canvas content, not real browser dialogs.

## Backend/Firebase debugging is a *different* tool, not "chrome" at all

The Firebase Local Emulator Suite (Firestore/Auth/Functions/Storage) is
inspected and seeded via `firebase-admin` Node scripts and the `firebase` CLI
— **no browser involved**:

- Read/write Firestore docs directly: a short `node -e "..."` script using
  `firebase-admin` with `FIRESTORE_EMULATOR_HOST` set (see
  `firebase/rules-test/manual/seed.js` and
  `firebase/functions/scripts/seedCategories.js` in this repo for real
  examples) — far more precise and cheaper than clicking through the
  Emulator UI to read the same data.
- Create/list Auth users the same way, via the Admin SDK against
  `FIREBASE_AUTH_EMULATOR_HOST`.
- Cloud Functions logs print straight to the emulator process's own stdout —
  readable by tailing that process's output, no browser needed.
- The one place a browser *could* help is eyeballing the Emulator Suite UI
  (`localhost:4000`) visually instead of querying — but that's a real DOM app,
  so ordinary DOM-based automation (not the vision/coordinate approach above)
  would apply there if it's ever worth building.

**Recommendation:** build two separate, small things, not one combined tool —
a CDP-driven script for the Flutter web UI (navigate, screenshot, click/type/
key, console read — the table above), and plain `node`/`firebase` CLI scripts
for emulator/backend state. They don't share a capability surface.
