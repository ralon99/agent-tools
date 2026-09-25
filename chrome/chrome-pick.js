#!/usr/bin/env node
import { connect, resolveActivePage } from "./chrome-lib.js";

const message = process.argv.slice(2).join(" ") || "Pick elements";
const sessionId = crypto.randomUUID();

const browser = await connect();
const page = await resolveActivePage(browser);

await page.bringToFront();
await page.evaluate((msg, id) => {
	window.__chromePick?.cleanup();

	const blocked = ["pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "contextmenu"];
	const picks = [];
	const marks = [];
	const state = { id, done: false, cancelled: false, picks };

	const style = (el, css) => Object.assign(el.style, css);
	const box = (color) => {
		const el = document.createElement("div");
		style(el, {
			position: "fixed",
			pointerEvents: "none",
			zIndex: 2147483647,
			border: `2px solid ${color}`,
			background: `${color}22`,
			boxSizing: "border-box",
		});
		document.documentElement.appendChild(el);
		return el;
	};
	const place = (el, r) => style(el, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

	const hover = box("#2563eb");
	const banner = document.createElement("div");
	style(banner, {
		position: "fixed",
		top: "8px",
		left: "50%",
		transform: "translateX(-50%)",
		zIndex: 2147483647,
		pointerEvents: "none",
		padding: "8px 14px",
		borderRadius: "6px",
		background: "#111827",
		color: "#fff",
		font: "13px system-ui, sans-serif",
		boxShadow: "0 2px 8px #0005",
	});
	const renderBanner = () => {
		banner.textContent = `${msg} — click to pick (${picks.length}), Enter to finish, Esc to cancel`;
	};
	renderBanner();
	document.documentElement.appendChild(banner);

	const selectorFor = (el) => {
		if (el.id) return `#${CSS.escape(el.id)}`;
		const parts = [];
		for (let node = el; node && node.nodeType === 1 && node !== document.documentElement; node = node.parentElement) {
			if (node.id) {
				parts.unshift(`#${CSS.escape(node.id)}`);
				break;
			}
			const tag = node.localName;
			const sameTag = node.parentElement ? [...node.parentElement.children].filter((c) => c.localName === tag) : [];
			parts.unshift(sameTag.length > 1 ? `${tag}:nth-of-type(${sameTag.indexOf(node) + 1})` : tag);
		}
		return parts.join(" > ");
	};

	const onMove = (e) => place(hover, e.target.getBoundingClientRect());
	const block = (e) => {
		e.preventDefault();
		e.stopImmediatePropagation();
	};
	const onClick = (e) => {
		block(e);
		const el = e.target;
		const r = el.getBoundingClientRect();
		picks.push({
			x: Math.round(e.clientX),
			y: Math.round(e.clientY),
			selector: selectorFor(el),
			tag: el.localName,
			text: (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 120),
			rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
		});
		const mark = box("#16a34a");
		place(mark, r);
		marks.push(mark);
		renderBanner();
	};
	const cleanup = () => {
		for (const t of blocked) window.removeEventListener(t, t === "click" ? onClick : block, true);
		window.removeEventListener("mousemove", onMove, true);
		window.removeEventListener("keydown", onKey, true);
		for (const el of [hover, banner, ...marks]) el.remove();
	};
	const onKey = (e) => {
		if (e.key !== "Enter" && e.key !== "Escape") return;
		block(e);
		state.cancelled = e.key === "Escape";
		state.done = true;
		cleanup();
	};

	for (const t of blocked) window.addEventListener(t, t === "click" ? onClick : block, true);
	window.addEventListener("mousemove", onMove, true);
	window.addEventListener("keydown", onKey, true);
	window.__chromePick = { state, cleanup };
}, message, sessionId);

console.error("Waiting for picks in Chrome (Enter to finish, Esc to cancel)...");

// Polling instead of one long evaluate keeps the wait clear of CDP's protocol timeout.
let state;
while (true) {
	if (page.isClosed()) {
		console.error("Pick aborted: the tab was closed.");
		await browser.disconnect();
		process.exit(1);
	}
	try {
		state = await page.evaluate(() => window.__chromePick?.state ?? null);
	} catch {
		await new Promise((r) => setTimeout(r, 250));
		continue;
	}
	if (!state) {
		console.error("Pick aborted: the page navigated or reloaded.");
		await browser.disconnect();
		process.exit(1);
	}
	if (state.id !== sessionId) {
		console.error("Pick aborted: another chrome-pick.js took over this tab.");
		await browser.disconnect();
		process.exit(1);
	}
	if (state.done) break;
	await new Promise((r) => setTimeout(r, 250));
}

if (state.cancelled) {
	console.log("Cancelled");
} else if (!state.picks.length) {
	console.log("No picks");
} else {
	state.picks.forEach((p, i) => {
		if (i > 0) console.log("");
		console.log(`[${i + 1}] ${p.tag} at (${p.x}, ${p.y})`);
		console.log(`selector: ${p.selector}`);
		if (p.text) console.log(`text: ${p.text}`);
		console.log(`rect: ${p.rect}`);
	});
}

await browser.disconnect();
