# GitHub tool — what it is, capabilities, cost

**What it is:** a plain `gh`/`git` replacement for the GitHub MCP server, covering
the parts of GitHub used day to day. No custom scripts required — just the official
GitHub CLI, already installed and authenticated.

**Use it for:**

| Capability | Approx. tokens/call (this tool vs MCP) |
|---|---|
| List / search issues | 21–66 vs 36–232 |
| Create an issue | 57 vs 89 |
| Comment on an issue | 49 vs 64 |
| Read a file's contents | 53 vs 109 |
| Search code in a repo | 22 vs 28 |
| List branches | 23 vs 36 |
| List commits | 64 vs 63 |
| Create a branch | 10 vs 125 |
| Push a file change | 156 vs 217 |
| Open a pull request | 54 vs 72 |

**Not covered** (still needs the MCP or a manual `gh api` call): PR review threads /
inline diff comments, teams, releases, milestones, sub-issues.

**Total cost, one session of the 11 calls above:**

| | Initial load | 11 calls | Total |
|---|---:|---:|---:|
| MCP (14 relevant tools) | ~5,632 | ~1,069 | **~6,701** |
| This tool (gh/git) | ~246 | ~576 | **~822** |

**~88% fewer tokens**, mostly from not loading the MCP's schemas at all.

Full methodology and caveats: [`BENCHMARK.md`](BENCHMARK.md).
Setup: [`../REQUIREMENTS.md`](../REQUIREMENTS.md#github).
How to actually use it: [`README.md`](README.md).
