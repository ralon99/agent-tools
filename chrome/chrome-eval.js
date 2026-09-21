#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const code = process.argv.slice(2).join(" ");
if (!code) {
	console.log("Usage: chrome-eval.js 'code'");
	console.log("\nExamples:");
	console.log('  chrome-eval.js "document.title"');
	console.log('  chrome-eval.js "document.querySelectorAll(\'a\').length"');
	process.exit(1);
}

const browser = await connect();
const page = await resolveActivePage(browser);

const result = await page.evaluate((c) => {
	const AsyncFunction = (async () => {}).constructor;
	// Try as a bare expression first (so "document.title" just works); fall back to
	// running it as a function body for multi-statement code with an explicit `return`.
	try {
		return new AsyncFunction(`return (${c})`)();
	} catch (e) {
		if (e instanceof SyntaxError) return new AsyncFunction(c)();
		throw e;
	}
}, code);

if (Array.isArray(result)) {
	for (let i = 0; i < result.length; i++) {
		if (i > 0) console.log("");
		for (const [key, value] of Object.entries(result[i])) console.log(`${key}: ${value}`);
	}
} else if (typeof result === "object" && result !== null) {
	for (const [key, value] of Object.entries(result)) console.log(`${key}: ${value}`);
} else {
	console.log(result);
}

await browser.disconnect();
