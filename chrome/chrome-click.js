#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const [x, y] = process.argv.slice(2).map(Number);
if (!Number.isFinite(x) || !Number.isFinite(y)) {
	console.log("Usage: chrome-click.js <x> <y>");
	process.exit(1);
}

const browser = await connect();
const page = await resolveActivePage(browser);
await page.mouse.click(x, y);
console.log(`Clicked (${x}, ${y})`);
await browser.disconnect();
