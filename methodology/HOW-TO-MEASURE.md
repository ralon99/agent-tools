# How to measure: MCP vs CLI, for the next tool

The process used to build and benchmark the `github` tool, generalized so it can be
repeated for the next MCP server worth replacing.

1. **Rank candidate MCPs by token footprint.** Load each server's tool schemas (e.g.
   via a tool-search call for all its tool names) and sum JSON character length /
   ~3.7 chars-per-token for an approximate cost. This tells you which MCP is worth
   the effort before you invest in a replacement.

2. **Scope to actual usage.** List which of that MCP's tools/capabilities are
   actually used. Drop the rest from the comparison — an unused capability isn't a
   real cost.

3. **Find the CLI that already does this.** Check the ponytail ladder: standard
   library → platform feature → already-installed dependency → a few readable lines
   → only then write new code. For most SaaS MCPs (GitHub, Slack, etc.) an official
   CLI already exists.

4. **Write a short, plain-English README for the scoped subset.** Just the commands
   needed for the actual use cases, shaped for terse output (`--json` + field
   selection, jq filters, etc.). This is the CLI approach's "initial load" cost —
   keep it tiny.

5. **Set up a disposable sandbox if the MCP touches external state.** A throwaway
   repo/channel/etc. so real calls don't touch anything that matters. Delete it when
   done.

6. **Run the same operations both ways.** Once via the actual MCP tool call, once
   via the CLI command. Record the exact request+response (or command+stdout)
   character length for each. Convert with the same chars/~3.7 heuristic used for
   the schema ranking, so both halves of the comparison stay consistent.

7. **Tally and write up.** Initial load + sum of per-call tokens, for both
   approaches. Put the numbers in that tool's `BENCHMARK.md`, a short
   `CAPABILITIES.md` summary, and the practical `README.md`. Note caveats: heuristic
   accuracy, sample size, what wasn't covered.

See `github-example/` for a worked example of all of the above: the raw benchmark
data script (`benchmark.py`), schema evidence (`schemas.json`), and the write-up
(`BENCHMARK.md`) that fed `../github/CAPABILITIES.md`.
