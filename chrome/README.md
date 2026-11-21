# chrome — CDP cheat-sheet

One script, `pw.mjs`, over raw Chrome DevTools Protocol. Needs Node 22+
(built-in WebSocket/fetch) and Chrome. No `npm install`.

    node chrome/pw.mjs <cmd> [args]

Each command is a short-lived process attached to Chrome on `:9222`. Env:
`PW_BROWSER` (chrome path), `PW_PORT` (default 9222), `PW_HEADLESS=1` (no window).

Pick/start logic adapted from badlogic/pi-skills (MIT) — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Start / stop (start is idempotent):
  start                  # fresh profile in the temp dir, console/network logger attached
  start --profile        # first copy your real Chrome profile (cookies, logins); no effect if Chrome already runs
  close

Navigate (https:// assumed; http:// for localhost):
  nav example.com [settle-ms]
  nav https://example.com --new      # new tab, becomes the active tab

Look:
  snapshot               # title + one line per interactive element: role "name"  @selector
  find <text>            # snapshot lines containing text
  screenshot             # prints the png path
  pdf                    # prints the pdf path

Act (selector or x y; selectors come from `snapshot`):
  click '#submit'  |  click 400 300
  type "hello"           # needs a focused field; refuses otherwise
  key Enter              # Enter Tab Space Escape Backspace Delete Arrows Home End PageUp PageDown F1-F12, or one char
  fill 'input[name="q"]=cats' '#agree=true'
  upload 'input[type=file]' ./a.png
  drag '#from' '#to'     # HTML5 drag if draggable, else mouse moves
  scroll 0 500           # wheel event at viewport centre
  wait 500               # ms

Evaluate JavaScript (DevTools-console semantics: top-level await, `{a:1}` is an object,
top-level `return` allowed):
  eval 'document.title'
  eval 'const a = document.title; return a.toUpperCase()'

Console / network (from the logger `start` spawns; these read its log):
  console [-n 50] [--since 2026-11-01T09:30]     # --since is UTC
  network [-n 50] [--since <ISO>]

Tabs (a tab id from `tabs` does not move; the numeric index can):
  tabs
  tabs switch <id-or-index>

Dialogs (alert/confirm/prompt are handled by the logger, accept by default):
  dialog                       # list seen dialogs
  dialog accept ["prompt text"]
  dialog dismiss

Emulation and capture:
  media dark|light|print|none
  trace [seconds]              # Chrome trace json, prints path and event count

Pick (the user points at things in Chrome; blocks until Enter/Esc; page clicks are
swallowed meanwhile — run it in the background and ask the user to pick):
  pick "Pick the broken button"   # per pick: tag, (x, y), selector, text, rect; or "Cancelled" / "No picks"
Aborts with exit 1 if the tab closes, the page navigates, or another pick takes over.

Check the tool itself (needs `start` first):
  selfcheck

## Canvas apps have no usable DOM

If `eval` queries like `document.querySelectorAll(...)` and `snapshot` come back
empty on a page that clearly has content, the app renders to `<canvas>` (Flutter
Web/CanvasKit, an HTML5 game). Screenshot to see state, then `click x y`, `type`,
`key`, `scroll` at pixel coordinates. `pick` returns the canvas as the selector;
use its (x, y). See [CAPABILITIES.md](CAPABILITIES.md).

## Known failure modes

- `type` before focusing a field errors with "nothing focused"; `click` the field first.
- Port 9222 already taken by another Chrome: `start` reports "already" and does
  not launch; set `PW_PORT` or `close` it.
- `console`/`network` are empty if Chrome was not launched by `start`.
- Page-thrown errors in `eval` surface as errors, not as `undefined`.
- Not covered: content extraction to markdown, GIF/video recording.
