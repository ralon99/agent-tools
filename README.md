# agent-tools

Lightweight, plain-CLI replacements for heavy MCP servers — one folder per external
service, each with its own usage guide and a short capability/cost summary. The
benchmark behind those numbers lives under `methodology/`, not in the tool itself.

## Why this exists

Loading an MCP server's tool definitions costs tokens before you've done anything —
sometimes thousands of them, every session, whether you end up using the server or
not. Most of what those tools do is already covered by an official CLI (`gh`, `git`,
etc.) that a coding agent already knows how to drive through a plain shell. This repo
is a growing collection of "use the CLI instead" write-ups, built and measured one
service at a time, starting with GitHub.

The idea comes from Mario Zechner's post
["What if you don't need MCP at all?"](https://mariozechner.at/posts/2025-11-02-what-if-you-dont-need-mcp/) —
his argument, tested here: a short README plus an existing CLI usually beats a full
MCP server on token cost, without losing capability, for the subset of a service you
actually use.

## Layout

Each tool folder is self-contained and answers two questions:

- **Should I use this?** → `<tool>/CAPABILITIES.md` — one short, plain-English page:
  what it does, what it doesn't cover, and the token cost per capability.
- **How do I use it?** → `<tool>/README.md` — the actual commands.

The measurement behind a tool's numbers isn't part of the tool — it lives as a
worked example under `methodology/`, since it's something you run once to produce
the CAPABILITIES.md figures, not something the tool itself needs at use time.

Top level:

- `github/` — GitHub via `gh` + `git`: issues, file/code browsing, branches,
  pushing changes, PRs
- `chrome/` — Chrome via CDP (puppeteer-core): navigate, screenshot,
  coordinate click/type/key (for canvas apps with no real DOM), console/network
  capture, multiple tabs
- `methodology/` — how to measure and write up the next tool, plus each tool's
  worked benchmark example (e.g. `methodology/github-example/`)
- `REQUIREMENTS.md` — what needs to be installed/authenticated, per tool

## How to use this with a coding agent

Nothing here is Claude-Code-specific — it's plain markdown and scripts, readable by
any coding agent. There are two ways to get an agent to actually use a tool folder:

**Manual, works with any agent:** tell the agent once, e.g. "read
`agent-tools/github/README.md` before doing GitHub work." One-time cost, no setup.

**Automatic, Claude Code only — via Skills:** Claude Code auto-lists every skill
under `~/.claude/skills/<name>/SKILL.md` at the start of every session, at near-zero
cost (just a name + one-line description per skill). It only loads a skill's full
instructions when the task actually matches and it invokes that skill. So to make a
tool folder here "auto-known" the moment a session starts, without paying any
schema-loading tax:

1. Create `~/.claude/skills/<tool-name>/SKILL.md`.
2. Write its description to trigger on that tool's task shape (e.g. for github:
   issues, PRs, repo browsing, pushing changes) — specific enough that Claude reaches
   for it instead of a heavier MCP when the task matches.
3. Have the skill body either inline the tool's `README.md` content or point at it
   (`Read agent-tools/github/README.md` as its first step).

This mirrors the MCP's own lazy-loading (cheap listing up front, full detail only on
use) but at a fraction of the standing cost, since the listing is a one-line
description instead of a full JSON tool schema. No skill has been wired up in this
repo yet — this is the intended integration point when you're ready to add one.

## Requirements

See [REQUIREMENTS.md](REQUIREMENTS.md).
