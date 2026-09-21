# Claude in Chrome MCP vs `chrome/` CLI tools — token cost benchmark

Test page: a throwaway static HTML page (input + button + a click handler that
logs to console) served from a local `http://localhost` HTTP server, plus
`https://example.com` for the plain navigate/screenshot rows. Both approaches
exercised the same real Chrome instance.

## Methodology

- Token estimate = character count / 3.7, same heuristic as the GitHub
  benchmark (`methodology/github-example/BENCHMARK.md`).
- "Initial load" = the `mcp__claude-in-chrome__*` tool schemas relevant to this
  tool's final capability list (`schemas.json` in this folder — `navigate`,
  `computer`, `tabs_context_mcp`, `tabs_create_mcp`, `tabs_close_mcp`,
  `read_console_messages`, `read_network_requests`, `javascript_tool`) vs. the
  CLI side's `chrome/README.md`. Scoped to what this tool replicates, not the
  MCP's full surface (it also ships `find`, `form_input`, `read_page`,
  `gif_creator`, etc. — deliberately not replicated, see `chrome/README.md`'s
  "not covered" list).
- Per-call cost = request (tool-call args, or shell command) + response (tool
  result text, or command stdout) character length, summed per operation.
  `benchmark.js` in this folder has the exact strings used.
- Both sides ran fresh — none of these operations (click, type, tabs) had been
  exercised via the MCP in this repo's earlier `chrome/CAPABILITIES.md`
  real-usage write-up, so this session ran them live on both sides rather than
  reusing old results.

## Initial load

| Approach | Tokens |
|---|---:|
| MCP (8 relevant tool schemas) | ~3,592 |
| CLI (`chrome/README.md`) | ~590 |

## Per-call (request + response, summed)

| Operation | MCP tokens | CLI tokens |
|---|---:|---:|
| tab context handshake (MCP-only — required once before any other tool call) | 58 | 0 |
| navigate | 56 | 18 |
| screenshot (text portion only — see caveat) | 65 | 25 |
| click | 57 | 10 |
| type | 56 | 12 |
| key press | 54 | 9 |
| execute JS | 64 | 12 |
| read console | 76 | 59 |
| read network | 65 | 35 |
| open + list tabs | 154 | 44 |
| close tabs (cleanup — MCP-only, CLI just leaves the debug Chrome instance running) | 72 | 0 |
| **Sum** | **776** | **224** |

## Totals

| | Initial load | 11 calls | **Total** |
|---|---:|---:|---:|
| MCP | 3,592 | 776 | **4,369** |
| CLI (chrome/*.js) | 590 | 224 | **814** |

**~81.4% fewer tokens**, and — unlike the GitHub benchmark, where the schema
tax dominated — here the *per-call* gap is proportionally almost as large as
the initial-load gap. Two structural reasons, not just verbosity:

1. **The MCP's tab-group model has fixed overhead the CLI doesn't**: a
   `tabs_context_mcp` handshake before the first real call, and
   `tabs_close_mcp` cleanup calls the tool's own docs require ("close it once
   you no longer need it... before finishing your task"). The CLI has neither
   — a script just connects to whatever Chrome is already running and exits;
   there's no session/group object to open or tear down.
2. **Every MCP response repeats a full `Tab Context` block** (available tabs,
   selected tab, etc.) after every single call, regardless of what was asked.
   The CLI scripts print only what was requested.

## Caveats

- Token counts are char/3.7 estimates, not a real tokenizer.
- Sample size is small (11 calls, one pass each).
- **Screenshot is not apples-to-apples.** The MCP's `computer` screenshot
  action returns the confirmation text counted here *plus* an inline JPEG
  image, billed as image tokens (a function of resolution, not character
  count) — not captured by this heuristic at all, so the MCP screenshot row
  is understated relative to its real cost. The CLI's `chrome-screenshot.js`
  returns only a file path — the agent decides separately whether to read
  that file, and pays image tokens only then and only at the resolution it
  chooses.
- Not evaluated: `find` (natural-language element search), `form_input`,
  `read_page` (accessibility tree), GIF/video recording, JS dialog handling —
  this tool's `chrome/CAPABILITIES.md` found these unnecessary or unusable
  (canvas-based apps have no real accessibility tree to query), so they were
  excluded from both sides rather than scored as an MCP advantage.
- Auth/permission prompting for the Chrome extension itself isn't counted;
  the CLI side has no such prompt (it's just a local process talking to CDP).

Re-run: `node benchmark.js` in this folder.
