#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const text = process.argv.slice(2).join(" ");
if (!text) {
	console.log("Usage: chrome-type.js 'text'");
	process.exit(1);
}

const browser = await connect();
const page = await resolveActivePage(browser);
await page.keyboard.type(text);
console.log(`Typed: ${text}`);
await browser.disconnect();
