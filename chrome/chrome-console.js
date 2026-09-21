#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { getCacheDir, parseLogArgs } from "./chrome-lib.js";

const { count, since } = parseLogArgs(process.argv.slice(2));

const file = path.join(getCacheDir(), "console.log");
if (!existsSync(file)) {
	console.log("(no console output captured yet — is chrome-start.js running?)");
	process.exit(0);
}

let lines = readFileSync(file, "utf8")
	.trim()
	.split("\n")
	.filter(Boolean)
	.map((l) => JSON.parse(l));

if (since) lines = lines.filter((l) => new Date(l.ts) >= since);
lines = lines.slice(-count);

for (const l of lines) {
	console.log(`[${l.ts}] ${l.type} ${l.url}: ${l.text}`);
}
