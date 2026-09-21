#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { getCacheDir } from "./chrome-lib.js";

// ponytail: one logger process per cache dir, no crash-recovery beyond
// chrome-start.js respawning it when logger.pid is stale — fine for a
// single-developer debugging tool, not a service.

const cacheDir = getCacheDir();
writeFileSync(path.join(cacheDir, "logger.pid"), String(process.pid));

const consoleLog = path.join(cacheDir, "console.log");
const networkLog = path.join(cacheDir, "network.log");

function append(file, entry) {
	appendFileSync(file, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
}

function attach(page) {
	page.on("console", (msg) => {
		append(consoleLog, { url: page.url(), type: msg.type(), text: msg.text() });
	});
	page.on("request", (req) => {
		append(networkLog, { url: req.url(), method: req.method(), phase: "request" });
	});
	page.on("response", (res) => {
		append(networkLog, { url: res.url(), status: res.status(), phase: "response" });
	});
}

const browser = await puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null });

for (const page of await browser.pages()) attach(page);

browser.on("targetcreated", async (target) => {
	const page = await target.page();
	if (page) attach(page);
});

browser.on("disconnected", () => process.exit(0));
