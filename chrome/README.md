# chrome — CDP tools cheat-sheet

Requires `npm install` in this folder once. Every script connects to Chrome
running on `:9222` with remote debugging enabled — start it first.

Adapted from [badlogic/pi-skills/browser-tools](https://github.com/badlogic/pi-skills/tree/main/browser-tools)
(MIT) — see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Start:
  chrome-start.js              # fresh profile
  chrome-start.js --profile    # copy your real profile (cookies, logins)

Navigate (defaults to https:// if no scheme given):
  chrome-nav.js example.com
  chrome-nav.js https://example.com --new   # open in a new tab

Screenshot:
  chrome-screenshot.js         # prints the temp file path

Evaluate JavaScript (bare expressions work directly; for multiple statements,
add an explicit `return`):
  chrome-eval.js 'document.title'
  chrome-eval.js 'const a = document.title; return a.toUpperCase()'

Coordinate interaction (for canvas apps — Flutter Web/CanvasKit, games — where
there's no real DOM to query or click by selector):
  chrome-click.js 400 300
  chrome-type.js "hello world"
  chrome-key.js Enter
  chrome-scroll.js 0 500

Wait:
  chrome-wait.js 500            # milliseconds

Console / network (captured continuously by a background logger that
chrome-start.js starts; these just read the log):
  chrome-console.js [-n 50] [--since <ISO timestamp>]
  chrome-network.js [-n 50] [--since <ISO timestamp>]

Tabs (index is a live snapshot — re-run `chrome-tabs.js` first if tabs may
have opened/closed since your last listing):
  chrome-tabs.js                # list, active tab marked with *
  chrome-tabs.js switch 1       # make tab 1 the active tab for every other script

## Canvas apps have no usable DOM

If `chrome-eval.js` queries against `document.querySelectorAll(...)` come back
empty on a page that clearly has content, the app is likely rendering to
`<canvas>` (Flutter Web/CanvasKit, an HTML5 game engine, etc.) rather than real
DOM. In that case: screenshot to see state, then interact via
`chrome-click.js`/`chrome-type.js`/`chrome-key.js` at pixel coordinates instead
of DOM selectors. See [CAPABILITIES.md](CAPABILITIES.md) for the real-usage
findings behind this.

Not covered here — still needs the MCP: interactive element picking by
description, content extraction to markdown, DOM/accessibility-tree queries,
GIF/video recording, JS dialog (alert/confirm/prompt) handling.
