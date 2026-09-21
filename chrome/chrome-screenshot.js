#!/usr/bin/env node
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { connect, resolveActivePage } from "./chrome-lib.js";

const browser = await connect();
const page = await resolveActivePage(browser);
const dir = mkdtempSync(path.join(os.tmpdir(), "chrome-screenshot-"));
const file = path.join(dir, "screenshot.png");
await page.screenshot({ path: file });
console.log(file);
await browser.disconnect();
