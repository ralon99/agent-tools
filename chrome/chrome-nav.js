#!/usr/bin/env node
import { connect, resolveActivePage, setActivePage } from "./chrome-lib.js";

const args = process.argv.slice(2);
const url = args[0];
const openNew = args.includes("--new");

if (!url) {
	console.log("Usage: chrome-nav.js <url> [--new]");
	process.exit(1);
}

const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;

const browser = await connect();
const page = openNew ? await browser.newPage() : await resolveActivePage(browser);
await page.goto(target, { waitUntil: "domcontentloaded" });
setActivePage(page);
console.log(`Navigated to ${page.url()}`);
await browser.disconnect();
