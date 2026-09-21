#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const [dx, dy] = process.argv.slice(2).map(Number);
if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
	console.log("Usage: chrome-scroll.js <dx> <dy>");
	process.exit(1);
}

const browser = await connect();
const page = await resolveActivePage(browser);
await page.evaluate((dx, dy) => window.scrollBy(dx, dy), dx, dy);
console.log(`Scrolled by (${dx}, ${dy})`);
await browser.disconnect();
