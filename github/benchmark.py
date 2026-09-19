import json

CHARS_PER_TOKEN = 3.7

def toks(s):
    return len(s) / CHARS_PER_TOKEN

rows = []

def add(op, mcp_req, mcp_resp, cli_req, cli_resp):
    mcp_total = toks(mcp_req) + toks(mcp_resp)
    cli_total = toks(cli_req) + toks(cli_resp)
    rows.append((op, mcp_total, cli_total))

add(
    "list issues (empty repo)",
    '{"owner":"ralon99","repo":"mcp-cli-experiment"}',
    '{"issues":[],"totalCount":0,"pageInfo":{"hasNextPage":false,"hasPreviousPage":false}}',
    'gh issue list -R ralon99/mcp-cli-experiment --json number,title,state,labels',
    '[]',
)

add(
    "create issue",
    '{"method":"create","owner":"ralon99","repo":"mcp-cli-experiment","title":"Bug: is_even fails on negative numbers","body":"The is_even function in src/utils.py returns unexpected results for negative inputs. Needs a test case and possibly a fix."}',
    '{"id":"5512794134","url":"https://github.com/ralon99/mcp-cli-experiment/issues/1"}',
    'gh issue create -R ralon99/mcp-cli-experiment -t "Bug: add_docstrings missing" -b "Functions in src/utils.py lack docstrings, should add them for clarity."',
    'https://github.com/ralon99/mcp-cli-experiment/issues/2',
)

add(
    "list issues (2 issues)",
    '{"owner":"ralon99","repo":"mcp-cli-experiment"}',
    '{"issues":[{"number":2,"title":"Bug: add_docstrings missing","body":"Functions in src/utils.py lack docstrings, should add them for clarity.","state":"OPEN","user":{"login":"ralon99"},"assignees":[],"created_at":"2026-09-19T18:53:32Z","updated_at":"2026-09-19T18:53:32Z"},{"number":1,"title":"Bug: is_even fails on negative numbers","body":"The is_even function in src/utils.py returns unexpected results for negative inputs. Needs a test case and possibly a fix.","state":"OPEN","user":{"login":"ralon99"},"assignees":[],"created_at":"2026-09-19T18:53:24Z","updated_at":"2026-09-19T18:53:24Z"}],"totalCount":2,"pageInfo":{"hasNextPage":false,"hasPreviousPage":false,"startCursor":"Y3Vyc29yOnYyOpK0MjAyNi0wOS0xOVQxODo1MzozMlrPAAAAAUiWktw=","endCursor":"Y3Vyc29yOnYyOpK0MjAyNi0wOS0xOVQxODo1MzoyNFrPAAAAAUiWkBY="}}',
    'gh issue list -R ralon99/mcp-cli-experiment --json number,title,state,labels',
    '[{"labels":[],"number":2,"state":"OPEN","title":"Bug: add_docstrings missing"},{"labels":[],"number":1,"state":"OPEN","title":"Bug: is_even fails on negative numbers"}]',
)

add(
    "comment on issue",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","issue_number":1,"body":"Looking into this, will add a fix and a regression test."}',
    '{"id":"5744502771","url":"https://github.com/ralon99/mcp-cli-experiment/issues/1#issuecomment-5744502771"}',
    'gh issue comment 2 -R ralon99/mcp-cli-experiment -b "I can pick this up, will add docstrings this week."',
    'https://github.com/ralon99/mcp-cli-experiment/issues/2#issuecomment-5744503443',
)

add(
    "get file contents",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","path":"src/utils.py"}',
    'successfully downloaded text file (SHA: 5269fb6c9e28a9c87e028e32064e4eca6e1cd5dd)[Resource from plugin:github:github at repo://ralon99/mcp-cli-experiment/sha/85f007c6b60e5743dd161f9c87977d1e287e9d00/contents/src/utils.py] def add(a, b):\n    return a + b\n\n\ndef multiply(a, b):\n    return a * b\n\n\ndef is_even(n):\n    return n % 2 == 0\n',
    'gh api repos/ralon99/mcp-cli-experiment/contents/src/utils.py -q .content | base64 -d',
    'def add(a, b):\n    return a + b\n\n\ndef multiply(a, b):\n    return a * b\n\n\ndef is_even(n):\n    return n % 2 == 0',
)

add(
    "search code",
    '{"query":"is_even repo:ralon99/mcp-cli-experiment"}',
    '{"total_count":0,"incomplete_results":true,"items":[]}',
    'gh search code "is_even" --repo ralon99/mcp-cli-experiment --json path,repository',
    '[]',
)

add(
    "list branches",
    '{"owner":"ralon99","repo":"mcp-cli-experiment"}',
    '[{"name":"master","sha":"85f007c6b60e5743dd161f9c87977d1e287e9d00","protected":false}]',
    'git ls-remote --heads origin',
    '85f007c6b60e5743dd161f9c87977d1e287e9d00\trefs/heads/master',
)

add(
    "list commits",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","fields":["sha","html_url"]}',
    '[{"html_url":"https://github.com/ralon99/mcp-cli-experiment/commit/85f007c6b60e5743dd161f9c87977d1e287e9d00","sha":"85f007c6b60e5743dd161f9c87977d1e287e9d00"}]',
    "gh api repos/ralon99/mcp-cli-experiment/commits -q '.[] | {sha: .sha, url: .html_url}'",
    '{"sha":"85f007c6b60e5743dd161f9c87977d1e287e9d00","url":"https://github.com/ralon99/mcp-cli-experiment/commit/85f007c6b60e5743dd161f9c87977d1e287e9d00"}',
)

add(
    "create branch",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","branch":"mcp-fix-is-even"}',
    '{"ref":"refs/heads/mcp-fix-is-even","url":"https://api.github.com/repos/ralon99/mcp-cli-experiment/git/refs/heads/mcp-fix-is-even","object":{"type":"commit","sha":"85f007c6b60e5743dd161f9c87977d1e287e9d00","url":"https://api.github.com/repos/ralon99/mcp-cli-experiment/git/commits/85f007c6b60e5743dd161f9c87977d1e287e9d00"},"node_id":"REF_kwDOUhsqvLpyZWZzL2hlYWRzL21jcC1maXgtaXMtZXZlbg"}',
    'git checkout -b cli-fix-docstrings -q',
    '',
)

add(
    "push file change",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","path":"src/test_utils.py","branch":"mcp-fix-is-even","message":"Add regression test for is_even","content":"from utils import is_even\\n\\n\\ndef test_is_even_negative():\\n    assert is_even(-4) is True\\n    assert is_even(-3) is False\\n"}',
    '{"content":{"name":"test_utils.py","path":"src/test_utils.py","sha":"cc39cd6af75d9c0d381bbbfd286f85e47ff79980","size":120,"html_url":"https://github.com/ralon99/mcp-cli-experiment/blob/mcp-fix-is-even/src/test_utils.py"},"commit":{"sha":"1107caeae4215583630c6f28ef0541557d1da486","message":"Add regression test for is_even","html_url":"https://github.com/ralon99/mcp-cli-experiment/commit/1107caeae4215583630c6f28ef0541557d1da486","author":{"name":"ralon99","email":"ralon99@gmail.com","date":"2026-09-19T18:54:42Z"}}}',
    'cat > src/test_utils2.py << EOF\nfrom utils import add, multiply\n\n\ndef test_add():\n    assert add(2, 3) == 5\n\n\ndef test_multiply():\n    assert multiply(2, 3) == 6\nEOF\ngit add -A && git commit -q -m "Add regression tests for add and multiply" && git push -u -q origin cli-fix-docstrings',
    "warning: in the working copy of 'src/test_utils2.py', LF will be replaced by CRLF the next time Git touches it\nremote: \nremote: Create a pull request for 'cli-fix-docstrings' on GitHub by visiting:\nremote:      https://github.com/ralon99/mcp-cli-experiment/pull/new/cli-fix-docstrings\nremote: \n",
)

add(
    "create pull request",
    '{"owner":"ralon99","repo":"mcp-cli-experiment","title":"Add regression test for is_even","head":"mcp-fix-is-even","base":"master","body":"Adds a test covering negative inputs, per #1."}',
    '{"id":"4579908818","url":"https://github.com/ralon99/mcp-cli-experiment/pull/3"}',
    'gh pr create -R ralon99/mcp-cli-experiment -B master -H cli-fix-docstrings -t "Add regression tests for add and multiply" -b "Adds coverage per #2."',
    'https://github.com/ralon99/mcp-cli-experiment/pull/4',
)

INITIAL_MCP_SUBSET_CHARS = 20837
INITIAL_CLI_CHEATSHEET_CHARS = 911

print(f"{'operation':30s} {'mcp_tok':>10s} {'cli_tok':>10s}")
mcp_call_total = 0.0
cli_call_total = 0.0
for op, m, c in rows:
    print(f"{op:30s} {m:10.1f} {c:10.1f}")
    mcp_call_total += m
    cli_call_total += c

mcp_initial = toks("x" * INITIAL_MCP_SUBSET_CHARS)
cli_initial = toks("x" * INITIAL_CLI_CHEATSHEET_CHARS)

print()
print(f"Initial load:   MCP={mcp_initial:.0f}  CLI={cli_initial:.0f}")
print(f"Sum of calls:   MCP={mcp_call_total:.0f}  CLI={cli_call_total:.0f}")
print(f"TOTAL:          MCP={mcp_initial+mcp_call_total:.0f}  CLI={cli_initial+cli_call_total:.0f}")
savings = 1 - (cli_initial+cli_call_total)/(mcp_initial+mcp_call_total)
print(f"Savings: {savings*100:.1f}%")
