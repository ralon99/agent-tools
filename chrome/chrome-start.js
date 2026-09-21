#!/usr/bin/env node
import { execSync, spawn } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import puppeteer from "puppeteer-core";
import { getCacheDir } from "./chrome-lib.js";

const useProfile = process.argv[2] === "--profile";
if (process.argv[2] && process.argv[2] !== "--profile") {
	console.log("Usage: chrome-start.js [--profile]");
	console.log("\nOptions:");
	console.log("  --profile  Copy your real Chrome profile (cookies, logins)");
	process.exit(1);
}

const cacheDir = getCacheDir();

async function isChromeRunning() {
	try {
		const browser = await Promise.race([
			puppeteer.connect({ browserURL: "http://localhost:9222", defaultViewport: null }),
			new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1000)),
		]);
		await browser.disconnect();
		return true;
	} catch {
		return false;
	}
}

function findChromeBinary() {
	if (process.platform === "win32") {
		const candidates = [
			"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
			"C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
			path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
		];
		return candidates.find(existsSync) ?? null;
	}
	if (process.platform === "darwin") {
		const candidate = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
		return existsSync(candidate) ? candidate : null;
	}
	for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"]) {
		try {
			const resolved = execSync(`command -v ${name}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
			if (resolved) return resolved;
		} catch {}
	}
	return null;
}

function realProfileDir() {
	if (process.platform === "win32") return path.join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data");
	if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Application Support", "Google", "Chrome");
	return path.join(os.homedir(), ".config", "google-chrome");
}

const EXCLUDE_NAMES = new Set(["SingletonLock", "SingletonSocket", "SingletonCookie"]);
const EXCLUDE_PATH_PARTS = [
	`${path.sep}Sessions${path.sep}`,
	`${path.sep}Current Session`,
	`${path.sep}Current Tabs`,
	`${path.sep}Last Session`,
	`${path.sep}Last Tabs`,
];

function shouldCopy(srcPath) {
	if (EXCLUDE_NAMES.has(path.basename(srcPath))) return false;
	return !EXCLUDE_PATH_PARTS.some((part) => srcPath.includes(part));
}

function isProcessAlive(pid) {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function ensureLoggerRunning() {
	const pidFile = path.join(cacheDir, "logger.pid");
	if (existsSync(pidFile)) {
		const pid = Number(readFileSync(pidFile, "utf8").trim());
		if (pid && isProcessAlive(pid)) return;
	}
	const loggerPath = path.join(import.meta.dirname, "chrome-logger.js");
	spawn(process.execPath, [loggerPath], { detached: true, stdio: "ignore" }).unref();
}

const alreadyRunning = await isChromeRunning();

if (!alreadyRunning) {
	const binary = findChromeBinary();
	if (!binary) {
		console.error("✗ Chrome not found in the standard install locations for this platform.");
		console.error("  Install Google Chrome, or edit findChromeBinary() in chrome-start.js if it's in a nonstandard location.");
		process.exit(1);
	}

	for (const name of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
		rmSync(path.join(cacheDir, name), { force: true });
	}

	if (useProfile) {
		console.log("Syncing profile...");
		cpSync(realProfileDir(), cacheDir, { recursive: true, force: true, filter: shouldCopy });
	}

	spawn(
		binary,
		["--remote-debugging-port=9222", `--user-data-dir=${cacheDir}`, "--no-first-run", "--no-default-browser-check"],
		{ detached: true, stdio: "ignore" },
	).unref();

	let connected = false;
	for (let i = 0; i < 30; i++) {
		if (await isChromeRunning()) {
			connected = true;
			break;
		}
		await new Promise((r) => setTimeout(r, 500));
	}

	if (!connected) {
		console.error("✗ Failed to connect to Chrome after launch");
		process.exit(1);
	}

	console.log(`✓ Chrome started on :9222${useProfile ? " with your profile" : ""}`);
} else {
	console.log("✓ Chrome already running on :9222");
	if (useProfile) {
		console.log("  (--profile has no effect on an already-running Chrome — stop it first if you need the profile synced)");
	}
}

ensureLoggerRunning();
