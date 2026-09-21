#!/usr/bin/env node
const ms = Number(process.argv[2]);
if (!Number.isFinite(ms)) {
	console.log("Usage: chrome-wait.js <milliseconds>");
	process.exit(1);
}
await new Promise((r) => setTimeout(r, ms));
