#!/usr/bin/env node
import { connect, resolveActivePage, setActivePage } from "./chrome-lib.js";

const [cmd, arg] = process.argv.slice(2);

const browser = await connect();
const pages = await browser.pages();

if (cmd === "switch") {
	const index = Number(arg);
	const page = pages[index];
	if (!page) {
		console.error(`No tab at index ${index}`);
		process.exit(1);
	}
	setActivePage(page);
	console.log(`Switched to tab ${index}: ${page.url()}`);
} else {
	const active = await resolveActivePage(browser);
	for (let i = 0; i < pages.length; i++) {
		const marker = pages[i] === active ? "*" : " ";
		console.log(`${marker} ${i}: ${await pages[i].title()} — ${pages[i].url()}`);
	}
}

await browser.disconnect();
