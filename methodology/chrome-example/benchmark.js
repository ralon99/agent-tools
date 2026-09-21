const CHARS_PER_TOKEN = 3.7;
const toks = (s) => s.length / CHARS_PER_TOKEN;

const rows = [];
function add(op, mcpReq, mcpResp, cliReq, cliResp) {
	const mcp = toks(mcpReq) + toks(mcpResp);
	const cli = toks(cliReq) + toks(cliResp);
	rows.push([op, mcp, cli]);
}

add(
	"tab context handshake",
	'{"createIfEmpty":true}',
	'{"availableTabs":[{"tabId":2070843140,"title":"New Tab","url":"chrome://newtab/"}],"tabGroupId":1876840483}\n\nTab Context:\n- Available tabs:\n  \u2022 tabId 2070843140: "New Tab" ("chrome://newtab/")',
	"",
	"",
);

add(
	"navigate",
	'{"tabId":2070843140,"url":"http://localhost:8791"}',
	'Navigated to http://localhost:8791\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost" ("http://localhost:8791")',
	"chrome-nav.js https://example.com",
	"Navigated to https://example.com/",
);

add(
	"screenshot (text portion only; MCP also returns an inline image not counted here)",
	'{"action":"screenshot","tabId":2070843140}',
	'Successfully captured screenshot (1568x783, jpeg) - ID: ss_9380b2e0q\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	"chrome-screenshot.js",
	"C:\\Users\\ralon\\AppData\\Local\\Temp\\chrome-screenshot-PjPtVK\\screenshot.png",
);

add(
	"click",
	'{"action":"left_click","tabId":2070843140,"coordinate":[75,15]}',
	'Clicked at (75, 15)\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	"chrome-click.js 90 18",
	"Clicked (90, 18)",
);

add(
	"type",
	'{"action":"type","tabId":2070843140,"text":"hello world"}',
	'Typed "hello world"\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	'chrome-type.js "hello world"',
	"Typed: hello world",
);

add(
	"key press",
	'{"action":"key","tabId":2070843140,"text":"Enter"}',
	'Pressed 1 key: Enter\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	"chrome-key.js Enter",
	"Pressed: Enter",
);

add(
	"execute JS",
	'{"action":"javascript_exec","tabId":2070843140,"text":"fetch(\'http://localhost:8791\').then(r=>r.status)"}',
	'{}\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	'chrome-eval.js "document.title"',
	"Example Domain",
);

add(
	"read console",
	'{"tabId":2070843140,"pattern":"submit"}',
	'Found 1 console messages:\n\n[1] [9:55:34 AM] [LOG] (http://localhost:8791/:9:10)\nsubmit clicked, value=hello world\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")',
	"chrome-console.js -n 5",
	"[2026-09-21T06:52:55.985Z] log file:///C:/Users/ralon/AppData/Local/Temp/claude/C--Projects-agent-tools/0064681b-a3ac-4281-8748-612c52bcab93/scratchpad/test.html: submit clicked, value=hello world",
);

add(
	"read network",
	'{"tabId":2070843140}',
	"Found 1 network request:\n\n1. url: http://localhost:8791/\n   method: GET\n   statusCode: 200\n\nTab Context:\n- Executed on tabId: 2070843140\n- Available tabs:\n  \u2022 tabId 2070843140: \"localhost:8791\" (\"http://localhost:8791/\")",
	"chrome-network.js -n 2",
	"[2026-09-21T06:53:40.216Z] -> GET https://example.com/\n[2026-09-21T06:53:40.217Z] <- 200 https://example.com/",
);

add(
	"open + list tabs",
	"{}{}",
	'Created new tab. Tab ID: 2070843143\n\nTab Context:\n- Executed on tabId: 2070843143\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")\n  \u2022 tabId 2070843143: "New Tab" ("")' +
		'{"availableTabs":[{"tabId":2070843140,"title":"localhost:8791","url":"http://localhost:8791/"},{"tabId":2070843143,"title":"New Tab","url":"chrome://newtab/"}],"selectedTabId":2070843140,"tabGroupId":1876840483}\n\nTab Context:\n- Available tabs:\n  \u2022 tabId 2070843140: "localhost:8791" ("http://localhost:8791/")\n  \u2022 tabId 2070843143: "New Tab" ("chrome://newtab/")',
	"chrome-nav.js https://example.com --newchrome-tabs.js",
	"Navigated to https://example.com/  0:  \u2014 file:///C:/.../test.html\n* 1: Example Domain \u2014 https://example.com/",
);

add(
	"close tabs (cleanup; CLI has no equivalent, a debug Chrome instance is just left running)",
	'{"tabId":2070843143}{"tabId":2070843140}',
	"Closed tab 2070843143. 1 tab(s) remain.\n\nTab Context:\n- Available tabs:\n  \u2022 tabId 2070843140: \"localhost:8791\" (\"http://localhost:8791/\")" +
		"Closed tab 2070843140. Group is now empty (auto-removed).\n\nTab Context:\n- Available tabs:",
	"",
	"",
);

const INITIAL_MCP_SCHEMA_CHARS = 13292; // methodology/chrome-example/schemas.json, wc -c
const INITIAL_CLI_README_CHARS = 2182; // chrome/README.md, wc -c

console.log(`${"operation".padEnd(60)} ${"mcp_tok".padStart(10)} ${"cli_tok".padStart(10)}`);
let mcpTotal = 0;
let cliTotal = 0;
for (const [op, m, c] of rows) {
	console.log(`${op.padEnd(60)} ${m.toFixed(1).padStart(10)} ${c.toFixed(1).padStart(10)}`);
	mcpTotal += m;
	cliTotal += c;
}

const mcpInitial = toks("x".repeat(INITIAL_MCP_SCHEMA_CHARS));
const cliInitial = toks("x".repeat(INITIAL_CLI_README_CHARS));

console.log();
console.log(`Initial load:   MCP=${mcpInitial.toFixed(0)}  CLI=${cliInitial.toFixed(0)}`);
console.log(`Sum of calls:   MCP=${mcpTotal.toFixed(0)}  CLI=${cliTotal.toFixed(0)}`);
console.log(`TOTAL:          MCP=${(mcpInitial + mcpTotal).toFixed(0)}  CLI=${(cliInitial + cliTotal).toFixed(0)}`);
const savings = 1 - (cliInitial + cliTotal) / (mcpInitial + mcpTotal);
console.log(`Savings: ${(savings * 100).toFixed(1)}%`);
