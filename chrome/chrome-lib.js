import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";

export function getCacheDir() {
	const dir =
		process.platform === "win32"
			? path.join(process.env.LOCALAPPDATA, "chrome-tools")
			: path.join(os.homedir(), ".cache", "chrome-tools");
	mkdirSync(dir, { recursive: true });
	return dir;
}

export async function connect(timeoutMs = 5000) {
	try {
		return await Promise.race([
			puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null }),
			new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
		]);
	} catch (e) {
		console.error("Could not connect to Chrome on :9222 —", e.message);
		console.error("  Run: chrome-start.js");
		process.exit(1);
	}
}

function activeTabFile() {
	return path.join(getCacheDir(), "active-tab.json");
}

// page.target()._targetId is undocumented (no public accessor), but it's the
// only stable per-tab id available — needed to persist "active tab" across
// separate one-shot CLI invocations.
export async function resolveActivePage(browser) {
	const file = activeTabFile();
	if (existsSync(file)) {
		const { targetId } = JSON.parse(readFileSync(file, "utf8"));
		for (const page of await browser.pages()) {
			if (page.target()._targetId === targetId) return page;
		}
	}
	const pages = await browser.pages();
	const page = pages.at(-1);
	if (!page) {
		console.error("No open tab found. Run: chrome-nav.js <url>");
		process.exit(1);
	}
	setActivePage(page);
	return page;
}

export function setActivePage(page) {
	writeFileSync(activeTabFile(), JSON.stringify({ targetId: page.target()._targetId }));
}

export function parseLogArgs(args) {
	let count = 50;
	let since = null;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === "-n") {
			count = Number(args[++i]);
			if (!Number.isInteger(count) || count < 1) {
				console.error(`-n must be a positive integer, got: ${args[i]}`);
				process.exit(1);
			}
		} else if (args[i] === "--since") {
			since = new Date(args[++i]);
			if (Number.isNaN(since.getTime())) {
				console.error(`--since must be a valid date, got: ${args[i]}`);
				process.exit(1);
			}
		}
	}
	return { count, since };
}
