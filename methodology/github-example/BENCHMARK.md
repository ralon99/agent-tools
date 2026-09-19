# GitHub MCP vs `gh`/`git` CLI — token cost benchmark

Test repo: throwaway private repo, created for this benchmark and deleted afterward.

## Methodology

- Token estimate = character count / 3.7 (rough heuristic, consistent with the
  original full-server MCP ranking that motivated this tool).
- "Initial load" = tokens the tool definitions (MCP) or a one-time README (CLI) cost
  before any call is made.
- Per-call cost = request (tool-call args, or shell command) + response (tool
  result, or command stdout) character length, summed per operation.
- Both sides ran the same 11 real operations against the same throwaway repo
  (`schemas.json` and `benchmark.py` in this folder have the exact
  schemas/commands/outputs used; the CLI side's commands are in `../../github/README.md`).
- Scope: only the tools/commands actually used — issues, repo browsing/file
  content, and creating/pushing changes. PR review workflow, teams, releases, etc.
  were excluded from the MCP side since they aren't used.

## Initial load

| Approach | Tokens |
|---|---|
| MCP (14 relevant tool schemas) | ~5,632 |
| CLI (gh/git README) | ~246 |

The 14-tool subset is almost as expensive as the full 45-tool server (~6,000 tokens)
— `list_issues`, `search_issues`, and `issue_write` alone carry most of the weight
(large `fields` enums, custom-field filter objects, issue-type unions).

## Per-call (request + response, summed)

| Operation | MCP tokens | CLI tokens |
|---|---:|---:|
| list issues (empty repo) | 36 | 21 |
| create issue | 89 | 57 |
| list issues (2 issues) | 232 | 66 |
| comment on issue | 64 | 49 |
| get file contents | 109 | 53 |
| search code | 28 | 22 |
| list branches | 36 | 23 |
| list commits | 63 | 64 |
| create branch | 125 | 10 |
| push file change | 217 | 156 |
| create pull request | 72 | 54 |
| **Sum** | **1,069** | **576** |

MCP responses are consistently larger because they return full structured objects
(node ids, cursors, nested user/commit objects) even when only 1–2 fields are
needed; `gh --json <fields>` and `-q` jq filters let the CLI side return only what's
needed. `list commits` is a wash since both sides were already field-filtered to
`sha`+url.

## Totals

| | Initial load | 11 calls | **Total** |
|---|---:|---:|---:|
| MCP | 5,632 | 1,069 | **6,701** |
| CLI (gh/git) | 246 | 576 | **822** |

**~87.7% fewer tokens** with the CLI approach for this usage pattern, and the gap is
dominated by the initial schema load, not the calls themselves — after the first
handful of calls the CLI approach's response-shaping advantage keeps compounding,
but the schema tax is the single biggest line item.

## Caveats

- Token counts are char/3.7 estimates, not a real tokenizer — good enough for
  relative comparison, not exact.
- Sample size is small (11 calls, one pass each); results shown were mostly empty
  (new repo), so `list issues (2 issues)` is the only case with a realistic payload
  size on the MCP side — real usage with larger issue bodies/PR descriptions would
  widen the gap further in the CLI's favor, since MCP always returns full objects
  while `gh --json` lets you drop fields you don't need.
- The CLI side requires the agent to already know reasonable `gh`/`git`
  invocations — the README is what keeps that a one-time cost instead of per-call
  trial and error.
- Not evaluated: auth/permission handling, error message quality, and the PR-review
  workflow (add_comment_to_pending_review etc.), which isn't used here.

Re-run: `python benchmark.py` in this folder.
