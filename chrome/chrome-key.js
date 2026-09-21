#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const key = process.argv[2];
if (!key) {
	console.log("Usage: chrome-key.js <Key>  (e.g. Enter, Tab, Escape, ArrowDown)");
	process.exit(1);
}

const browser = await connect();
const page = await resolveActivePage(browser);
await page.keyboard.press(key);
console.log(`Pressed: ${key}`);
await browser.disconnect();
