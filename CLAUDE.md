# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

A collection of lightweight, plain-CLI replacements for heavy MCP servers. Each
external service gets its own self-contained folder with a usage guide and a
capability/cost summary, arguing that "official CLI + short README" usually beats
loading a full MCP server's tool schemas for the subset of a service actually used.
There is no application code, build, lint, or test suite — this is a documentation
repo plus one benchmark script.

## Layout and conventions

Each tool folder (e.g. `github/`, `chrome/`) answers two questions with two files:

- **`<tool>/CAPABILITIES.md`** — should I use this? Plain-English: what it covers,
  what it doesn't, token cost per capability vs. the equivalent MCP calls.
- **`<tool>/README.md`** — how do I use it? The actual commands/cheat-sheet, shaped
  for terse output (e.g. `gh --json <fields>` + `jq`/`-q` filters, not raw calls).

`methodology/` holds the reusable process (`HOW-TO-MEASURE.md`) plus one
subfolder per tool's worked benchmark (`methodology/<tool>-example/`), typically a
`BENCHMARK.md` write-up, the raw script that produced the numbers, and captured
tool schemas used for the MCP-side cost estimate. Benchmark evidence lives here,
*not* inside the tool folder — a tool's own two files stay usage-focused.

`REQUIREMENTS.md` at the root lists what needs to be installed/authenticated,
one section per tool (e.g. `gh` + auth for `github/`).

### Adding a new tool folder

Follow `methodology/HOW-TO-MEASURE.md`: rank the MCP's token footprint, scope to
capabilities actually used, find the CLI that already covers them (ponytail
ladder — stdlib/platform feature/existing dependency before new code), write the
README for that scoped subset, benchmark real calls both ways (char count / ~3.7
as the chars-per-token heuristic, consistent across all tools), then write up
`BENCHMARK.md`, `CAPABILITIES.md`, and `README.md`. Note what wasn't covered
rather than silently dropping it.

The Skills-based auto-loading integration described in the root `README.md` (a
`~/.claude/skills/<tool-name>/SKILL.md` per tool, for zero-cost auto-discovery in
Claude Code) is documented as an intended pattern but not yet wired up for any
tool in this repo — don't assume a skill exists for a tool folder without checking.
