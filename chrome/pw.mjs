#!/usr/bin/env node
// Browser driving over raw Chrome DevTools Protocol. No npm dependencies:
// Node 22+ ships a global WebSocket and fetch, and Chrome is already installed.
//
// Each subcommand is a separate short-lived process that attaches to a Chrome
// already listening on :9222, so there is no session to open or tear down and a
// response carries only what was asked for.
//
// Usage: pw.mjs <subcommand> [args]  -- run with no arguments to list subcommands
// Env:   PW_BROWSER (chrome path), PW_PORT (default 9222), PW_HEADLESS (no window)

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync, mkdirSync, chmodSync, readFileSync, existsSync, statSync, rmSync, cpSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';

const PORT = process.env.PW_PORT || 9222;
// Keyed by uid and port so two users sharing a host, or two sessions on
// different ports, do not fight over one log file in /tmp.
const WHO = `${process.getuid ? process.getuid() : 'u'}-${PORT}`;
const LOG = join(tmpdir(), `pw-events-${WHO}.jsonl`);
const PROFILE = join(tmpdir(), `pw-profile-${WHO}`);
const CHROME_PATHS = process.platform === 'win32'
  ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA]
      .filter(Boolean).map((dir) => join(dir, 'Google', 'Chrome', 'Application', 'chrome.exe'))
  : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    // Ubuntu's chromium-browser only starts the snap, which may see a private /tmp.
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium',
       '/usr/local/bin/google-chrome', '/usr/local/bin/chromium'];
const BROWSER = process.env.PW_BROWSER || CHROME_PATHS.find(existsSync) || CHROME_PATHS[0];
const DIALOG_POLICY = join(tmpdir(), `pw-dialog-${WHO}.json`);
// Each command is its own process, so the tab chosen by `tabs switch` or
// `nav --new` has to outlive it.
const ACTIVE_TAB = join(tmpdir(), `pw-tab-${WHO}.json`);

// Screenshots, PDFs and traces hold page content, so they are keyed by uid like
// the log and kept private. wx: a symlink planted at the path fails the write
// instead of silently redirecting it.
const artefact = (kind, ext, data) => {
  const path = join(tmpdir(), `pw-${kind}-${WHO}-${Date.now()}.${ext}`);
  writeFileSync(path, data, { mode: 0o600, flag: 'wx' });
  return path;
};

// The log, the chosen tab and the dialog policy hold addresses from every tab:
// owner-only too. Removed first because mode only applies on create, and wx
// then refuses a symlink planted in between.
const writePrivate = (path, data) => {
  try {
    rmSync(path, { force: true });
    writeFileSync(path, data, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    throw new Error(`cannot write ${path}: ${e.code} — another user may own it; remove it, or set PW_PORT to use other files`);
  }
};

// The shared temp folder lets anyone create these paths, so a file someone
// else owns is ignored rather than obeyed.
const readOwn = (path) => {
  try {
    if (process.getuid && statSync(path).uid !== process.getuid()) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return null; }
};

// Chrome draws parts of its own window, such as the address-bar dropdown, as
// page targets on *.top-chrome hosts. They are not tabs.
const CHROME_UI = /^chrome(-untrusted)?:\/\/[^/]+\.top-chrome\//;
const isTab = (t) => t.type === 'page' && !CHROME_UI.test(t.url);

async function targets() {
  const res = await fetch(`http://localhost:${PORT}/json/list`);
  return (await res.json()).filter(isTab);
}

const browserSocket = async () =>
  (await (await fetch(`http://localhost:${PORT}/json/version`)).json()).webSocketDebuggerUrl;

// /json/list reorders on every focus change. Target.getTargets reorders less,
// but still when a tab opens or navigates, so a number from `tabs` can point
// at another tab one command later. `tabs` also prints a short id, which
// never moves.
async function tabList() {
  const { targetInfos } = await cdp((send) => send('Target.getTargets'),
    { webSocketDebuggerUrl: await browserSocket() });
  return targetInfos.filter(isTab).map((t) => ({ id: t.targetId, title: t.title, url: t.url }));
}

// The chosen tab, or the first one once the chosen tab has been closed.
// /json/list puts the most recently focused tab first, so a chosen tab that is
// not first sits behind another one: `front` says which.
async function page() {
  const list = await targets();
  if (!list.length) throw new Error(`no page target on :${PORT} — run "pw.mjs start" first`);
  const id = readOwn(ACTIVE_TAB)?.id;
  const t = list.find((x) => x.id === id) || list[0];
  return { ...t, front: t.id === list[0].id };
}

// Log lines name a page or a request; a long data: URL would repeat ~2 KB on
// every line.
const clip = (u) => (u && u.length > 120 ? `${u.slice(0, 119)}…` : u);

const shortId = (t) => t.id.slice(0, 6).toLowerCase();

// An id from `tabs` first, since it cannot have moved; a number otherwise.
async function switchTab(which) {
  const list = await tabList();
  const want = (which ?? '').toLowerCase();
  const byId = want.length >= 6 ? list.filter((t) => t.id.toLowerCase().startsWith(want)) : [];
  const t = byId.length === 1 ? byId[0] : /^\d+$/.test(want) ? list[+want] : undefined;
  if (!t) throw new Error(`no tab ${which ?? ''} — run "tabs" for the list`);
  chooseTab(t);
  await fetch(`http://localhost:${PORT}/json/activate/${t.id}`);   // bring it to the front
  return t;
}

const chooseTab = (t) => writePrivate(ACTIVE_TAB, JSON.stringify({ id: t.id }));

async function openTab(url = 'about:blank') {
  // /json/new refuses GET on current Chrome.
  const res = await fetch(`http://localhost:${PORT}/json/new?${url}`, { method: 'PUT' });
  if (!res.ok) throw new Error(`could not open a tab: HTTP ${res.status}`);
  const t = await res.json();
  chooseTab(t);
  return t;
}

// One connection, N commands, then close. Callers batch so a single logical
// operation costs a single socket.
async function cdp(fn, target) {
  const t = target || (await page());
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  const pending = new Map();
  let seq = 0;
  await new Promise((ok, err) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => err(new Error('cdp connect failed')), { once: true });
  });
  const listeners = new Map();
  const on = (method, cb) => listeners.set(method, [...(listeners.get(method) || []), cb]);
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.method) {
      for (const cb of listeners.get(msg.method) || []) cb(msg.params);
      return;
    }
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    msg.error ? slot.reject(new Error(msg.error.message)) : slot.resolve(msg.result);
  });
  // Nothing else rejects a pending command, so a crashed target or a socket
  // torn down under us would hang the caller's process until its own timeout.
  ws.addEventListener('close', () => {
    for (const [id, slot] of pending) { pending.delete(id); slot.reject(new Error('cdp socket closed')); }
  }, { once: true });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = ++seq;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`cdp timeout: ${method}`));
      }, 30_000);
      const settle = (fn) => (v) => { clearTimeout(timer); fn(v); };
      pending.set(id, { resolve: settle(resolve), reject: settle(reject) });
      ws.send(JSON.stringify({ id, method, params }));
    });
  try {
    // Chrome holds mouse input for a tab that is not in front until the
    // command times out, and the chosen tab need not be the one in front.
    // Decided from the tab list, not by asking the page, which a busy script
    // would hold up; and only when behind, so a window is not raised for no
    // reason.
    if (t.front === false) await send('Page.bringToFront');
    return await fn(send, on);
  } finally {
    ws.close();
  }
}

// Runtime.evaluate resolves normally when the page throws, so without this the
// caller reads an undefined value and reports success.
const evaluate = async (send, expression, extra = {}) => {
  const res = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, ...extra });
  const ex = res.exceptionDetails;
  if (ex) throw new Error(ex.exception?.description ?? ex.text);
  return res;
};

// Runs like the DevTools console (replMode): top-level await works, and a
// second eval may declare the same const again. Two console habits on top:
// - `{a: 1}` is an object, not a block, when it parses as one. Only parsed here,
//   so nothing runs twice.
// - a top-level `return` makes it a function body. "Illegal return statement"
//   is a parse error, so the first try ran nothing; any other error, including
//   a SyntaxError thrown while running, is the caller's and is not retried.
// ponytail: code that throws "Illegal return statement" itself, via eval(),
// runs twice. Nothing else produces that message at run time.
const evaluateCode = async (send, code) => {
  let expr = code;
  if (/^\s*\{[\s\S]*\}\s*$/.test(code)) {
    await send('Runtime.enable');   // compileScript refuses without it
    const { exceptionDetails } = await send('Runtime.compileScript', {
      expression: `(${code})`, sourceURL: '', persistScript: false,
    });
    if (!exceptionDetails) expr = `(${code})`;
  }
  try {
    return await evaluateRepl(send, expr);
  } catch (e) {
    if (!e.message.startsWith('SyntaxError: Illegal return statement')) throw e;
    return evaluateRepl(send, `(async () => {\n${code}\n})()`);
  }
};

// replMode waits for its own top-level awaits but hands back a promise that is
// the final value as the promise itself, which returnByValue flattens to {}.
// So take a handle first, and wait for a promise before reading the value.
async function evaluateRepl(send, expression) {
  const fail = (res) => {
    const ex = res.exceptionDetails;
    if (ex) throw new Error(ex.exception?.description ?? ex.text);
    return res;
  };
  const { result } = fail(await send('Runtime.evaluate', { expression, replMode: true, awaitPromise: true }));
  if (!result.objectId) return { result };
  return fail(result.subtype === 'promise'
    ? await send('Runtime.awaitPromise', { promiseObjectId: result.objectId, returnByValue: true })
    : await send('Runtime.callFunctionOn', {
      objectId: result.objectId, functionDeclaration: 'function () { return this; }', returnByValue: true,
    }));
}

// Centre of the first match, in viewport coordinates. Returning null rather
// than throwing lets callers report "not found" as data instead of a stack.
const CENTER_OF = (sel) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  el.scrollIntoView({ block: 'center', inline: 'center' });   // the rect is only a click target while on screen
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
})()`;

async function resolvePoint(send, args) {
  if (args.length >= 2 && args.every((a) => /^\d+$/.test(a))) {
    return { x: +args[0], y: +args[1] };
  }
  const { result } = await evaluate(send, CENTER_OF(args.join(' ')));
  if (!result.value) throw new Error(`no element matches ${args.join(' ')}`);
  return result.value;
}

async function click(send, args) {
  const { x, y } = await resolvePoint(send, args);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
  }
  return `clicked ${x},${y}`;
}

const FILL_JS = (pairs) => `(() => {
  const out = [];
  for (const [sel, value] of ${JSON.stringify(pairs)}) {
    const el = document.querySelector(sel);
    if (!el) { out.push(sel + ': not found'); continue; }
    if (el.type === 'checkbox' || el.type === 'radio') {
      el.checked = value !== 'false' && value !== '0';
    } else {
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
                  : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype
                  : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      setter ? setter.call(el, value) : (el.value = value);
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    out.push(sel + ': ok');
  }
  return out.join('\\n');
})()`;

// The first `=` outside brackets separates selector from value: the selector
// may carry its own (input[name="q"]) and the value may contain ] or =.
// ponytail: depth counting, not a CSS parser -- a literal ] inside an attribute
// string would split in the wrong place.
const splitPair = (a) => {
  let depth = 0;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '[') depth++;
    else if (a[i] === ']') depth--;
    else if (a[i] === '=' && depth === 0) return [a.slice(0, i), a.slice(i + 1)];
  }
  throw new Error(`expected selector=value, got ${a}`);
};

// HTML5 drag-and-drop does not respond to synthetic mouse events, and
// mouse-driven sort libraries do not respond to DragEvents. Pick by whether
// the source declares itself draggable.
const DRAG_JS = (src, dst) => `(() => {
  const s = document.querySelector(${JSON.stringify(src)});
  const d = document.querySelector(${JSON.stringify(dst)});
  if (!s || !d) return 'not found';
  const dt = new DataTransfer();
  const fire = (el, type) => el.dispatchEvent(
    new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt }));
  fire(s, 'dragstart'); fire(d, 'dragenter'); fire(d, 'dragover');
  fire(d, 'drop'); fire(s, 'dragend');
  return 'ok';
})()`;

async function dragMouse(send, a, b) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: a.x, y: a.y, button: 'left', clickCount: 1 });
  // Intermediate moves matter: sort libraries start dragging on movement, not
  // on the press, and a single jump looks like a click to them.
  for (let i = 1; i <= 8; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', button: 'left',
      x: Math.round(a.x + ((b.x - a.x) * i) / 8),
      y: Math.round(a.y + ((b.y - a.y) * i) / 8),
    });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: b.x, y: b.y, button: 'left', clickCount: 1 });
}

// CDP leaves keyCode/which at 0 and code empty unless they are passed, and the
// Enter-to-submit idiom and every shortcut handler read exactly those. text is
// what makes the page see a character, so it stays on keyDown only.
const KEYS = {
  Enter: { code: 'Enter', vk: 13, text: '\r' },
  Tab: { code: 'Tab', vk: 9, text: '\t' },
  Space: { code: 'Space', vk: 32, text: ' ', key: ' ' },
  Escape: { code: 'Escape', vk: 27 },
  Backspace: { code: 'Backspace', vk: 8 },
  Delete: { code: 'Delete', vk: 46 },
  ArrowUp: { code: 'ArrowUp', vk: 38 },
  ArrowDown: { code: 'ArrowDown', vk: 40 },
  ArrowLeft: { code: 'ArrowLeft', vk: 37 },
  ArrowRight: { code: 'ArrowRight', vk: 39 },
  Home: { code: 'Home', vk: 36 },
  End: { code: 'End', vk: 35 },
  PageUp: { code: 'PageUp', vk: 33 },
  PageDown: { code: 'PageDown', vk: 34 },
  Insert: { code: 'Insert', vk: 45 },
};
for (let i = 1; i <= 12; i++) KEYS[`F${i}`] = { code: `F${i}`, vk: 111 + i };
const CHAR_KEYS = { ' ': 'Space', '\n': 'Enter', '\t': 'Tab' };

// ponytail: a single character carries a key code only for letters and digits;
// punctuation sends vk 0 with its text, which inserts it but a handler reading
// keyCode sees 0. Add a US-layout table if one ever needs it.
function keyFor(name) {
  if (Object.hasOwn(CHAR_KEYS, name)) name = CHAR_KEYS[name];
  if (Object.hasOwn(KEYS, name)) return { key: name, ...KEYS[name] };
  if (!name || [...name].length !== 1) {
    throw new Error(`${name ? `unknown key ${name}` : 'key <name>'} — one of ${Object.keys(KEYS).join(', ')}, or a single character`);
  }
  const up = name.toUpperCase();
  const code = /^[A-Z]$/.test(up) ? `Key${up}` : /^\d$/.test(name) ? `Digit${name}` : '';
  return { key: name, code, vk: code ? up.charCodeAt(0) : 0, text: name };
}

// Sent back to back and awaited together: Chrome handles them in order, and
// waiting for each answer in turn made a 1000-character `type` take 35s.
async function press(send, ...keys) {
  await Promise.all(keys.flatMap((k) => ['keyDown', 'keyUp'].map((type) =>
    send('Input.dispatchKeyEvent', {
      type, key: k.key, code: k.code,
      windowsVirtualKeyCode: k.vk, nativeVirtualKeyCode: k.vk,
      ...(k.text && type === 'keyDown' ? { text: k.text } : {}),
    }))));
}

async function key(send, name) {
  await press(send, keyFor(name));
  return `pressed ${name}`;
}

// Key events go to whatever has focus, and after nav that is <body>, which
// discards the text. Reporting a character count for discarded text is the
// worst failure shape there is, so refuse instead. One key press per character,
// so autocomplete and shortcut handlers see each key.
const FOCUSED_JS = '(e => e ? e.tagName.toLowerCase() + (e.id ? "#" + e.id : "") : "none")(document.activeElement)';
const unfocused = (f) => ['body', 'html', 'none'].includes(f.split('#')[0]);

const LEAVE_WATCH_JS = `(() => {
  window.__pwLeaving = false;
  if (window.__pwWatching) return;
  window.__pwWatching = true;
  addEventListener('submit', (e) => {
    const t = e.target.getAttribute('target');
    if (!e.defaultPrevented && (!t || t === '_self')) window.__pwLeaving = true;
  });
  addEventListener('beforeunload', () => { window.__pwLeaving = true; });
})()`;

async function typeText(send, text) {
  const { result } = await evaluate(send, FOCUSED_JS);
  const start = result.value;
  if (unfocused(start)) throw new Error('nothing focused — click the field first');
  // An Enter that submits a form leaves the old page focused until the new one
  // replaces it, and Chrome starts that navigation after it has answered the
  // key event, so neither focus nor a navigation event can tell in time. The
  // submit event can: it fires while the key is handled. A listener notes a
  // submit nobody cancelled, or the page starting to unload; a page already
  // replaced has no note at all, which counts as leaving too.
  await evaluate(send, LEAVE_WATCH_JS);
  // CRLF is one line break: two Enters could submit a form mid-text.
  const chars = [...text.replace(/\r\n?/g, '\n')];
  const keys = chars.map(keyFor);
  let now = start;
  let done = 0;
  while (done < keys.length) {
    // Tab moves focus and Enter can submit a form, so the rest of the text
    // may have nowhere to go: send up to one of them, then re-check focus.
    let end = done;
    while (end < keys.length - 1 && keys[end].key !== 'Tab' && keys[end].key !== 'Enter') end++;
    await press(send, ...keys.slice(done, end + 1));
    done = end + 1;
    if (done < keys.length) {
      let leaving;
      try { ({ result: { value: leaving } } = await evaluate(send, 'window.__pwLeaving !== false')); } catch { leaving = true; }
      if (leaving) {
        throw new Error(`typed ${done} of ${keys.length} chars, then ${keys[end].key} started loading another page; the rest was not typed`);
      }
      try { ({ result: { value: now } } = await evaluate(send, FOCUSED_JS)); } catch { now = 'none'; }
      if (unfocused(now)) {
        throw new Error(`typed ${done} of ${keys.length} chars, then ${keys[end].key} left nothing focused; the rest was not typed`);
      }
    }
  }
  return `typed ${chars.length} chars into ${start}${now === start ? '' : `, ending in ${now}`}`;
}

// A wheel event at the viewport centre, not window.scrollBy: canvas apps
// ignore the document scroll position and listen for the wheel.
async function scroll(send, dx, dy) {
  const { result } = await evaluate(send, '[innerWidth >> 1, innerHeight >> 1]');
  const [x, y] = result.value;
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX: dx, deltaY: dy });
}

// A snapshot has to be actionable, not just readable. Listing roles and names
// without a way to address the element forces the caller to probe the DOM
// separately to find a selector, which costs more round trips than the
// snapshot saved. So every line ends in a selector that `click` accepts.
const SNAPSHOT_JS = String.raw`(() => {
  const ROLES = { A:'link', BUTTON:'button', INPUT:'textbox', TEXTAREA:'textbox',
    SELECT:'combobox', SUMMARY:'disclosure', IMG:'image', FORM:'form',
    NAV:'navigation', TABLE:'table', H1:'heading', H2:'heading', H3:'heading',
    H4:'heading', H5:'heading', H6:'heading' };

  const selectorFor = (el) => {
    if (el.id) return '#' + CSS.escape(el.id);
    const named = el.getAttribute('name');
    if (named) {
      const byName = el.tagName.toLowerCase() + '[name="' + named + '"]';
      // A radio group shares one name, so this only addresses an element when
      // it matches exactly one.
      if (document.querySelectorAll(byName).length === 1) return byName;
    }
    const path = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      if (cur.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
      let part = cur.tagName.toLowerCase();
      const sibs = cur.parentElement
        ? [...cur.parentElement.children].filter((c) => c.tagName === cur.tagName) : [];
      if (sibs.length > 1) part += ':nth-of-type(' + (sibs.indexOf(cur) + 1) + ')';
      path.unshift(part);
      // Climb until the path addresses one element: click acts on the first
      // match, so an ambiguous selector acts on the wrong element. A tag name
      // that is not valid selector syntax (o:p) throws -- stop there rather
      // than climb to <html> building a selector that can never match.
      try { if (document.querySelectorAll(path.join(' > ')).length === 1) break; } catch { break; }
    }
    return path.join(' > ');
  };

  const INPUT_ROLES = { checkbox:'checkbox', radio:'radio', file:'file',
    button:'button', submit:'button', reset:'button', range:'slider' };
  const roleFor = (el) => el.getAttribute('role') ||
    (el.tagName === 'INPUT' ? (INPUT_ROLES[el.type] || 'textbox') : ROLES[el.tagName]) ||
    el.tagName.toLowerCase();

  const nameFor = (el) => (
    el.getAttribute('aria-label') || el.labels?.[0]?.textContent ||
    el.getAttribute('placeholder') || el.getAttribute('alt') ||
    el.getAttribute('title') || el.innerText?.trim().split('\n')[0] || el.value || ''
  ).trim().slice(0, 80);

  const lines = [];
  for (const el of document.querySelectorAll(
    'a,button,input,textarea,select,summary,[role],[onclick],h1,h2,h3,h4,h5,h6')) {
    const box = el.getBoundingClientRect();
    if (!box.width && !box.height) continue;        // not rendered; not clickable
    const role = roleFor(el);
    const name = nameFor(el);
    lines.push(role + (name ? ' "' + name + '"' : '') + '  @' + selectorFor(el));
  }
  return document.title + '\n' + lines.join('\n');
})()`;

// Runs in the page. Clicks are swallowed while it is active, so the user can
// point at things without triggering them; Enter finishes, Escape cancels.
const PICK_OVERLAY = (msg, id) => {
  window.__pwPick?.cleanup();

  const blocked = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu'];
  const picks = [];
  const marks = [];
  const state = { id, done: false, cancelled: false, picks };

  const style = (el, css) => Object.assign(el.style, css);
  const box = (color) => {
    const el = document.createElement('div');
    style(el, {
      position: 'fixed',
      pointerEvents: 'none',
      zIndex: 2147483647,
      border: `2px solid ${color}`,
      background: `${color}22`,
      boxSizing: 'border-box',
    });
    document.documentElement.appendChild(el);
    return el;
  };
  const place = (el, r) => style(el, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });

  const hover = box('#2563eb');
  const banner = document.createElement('div');
  style(banner, {
    position: 'fixed',
    top: '8px',
    left: '50%',
    transform: 'translateX(-50%)',
    zIndex: 2147483647,
    pointerEvents: 'none',
    padding: '8px 14px',
    borderRadius: '6px',
    background: '#111827',
    color: '#fff',
    font: '13px system-ui, sans-serif',
    boxShadow: '0 2px 8px #0005',
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
    return parts.join(' > ');
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
      text: (el.innerText || el.value || el.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 120),
      rect: `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`,
    });
    const mark = box('#16a34a');
    place(mark, r);
    marks.push(mark);
    renderBanner();
  };
  const cleanup = () => {
    for (const t of blocked) window.removeEventListener(t, t === 'click' ? onClick : block, true);
    window.removeEventListener('mousemove', onMove, true);
    window.removeEventListener('keydown', onKey, true);
    for (const el of [hover, banner, ...marks]) el.remove();
  };
  const onKey = (e) => {
    if (e.key !== 'Enter' && e.key !== 'Escape') return;
    block(e);
    state.cancelled = e.key === 'Escape';
    state.done = true;
    cleanup();
  };

  for (const t of blocked) window.addEventListener(t, t === 'click' ? onClick : block, true);
  window.addEventListener('mousemove', onMove, true);
  window.addEventListener('keydown', onKey, true);
  window.__pwPick = { state, cleanup };
};

const installPicker = (send, message, id) =>
  evaluate(send, `(${PICK_OVERLAY})(${JSON.stringify(message)}, ${JSON.stringify(id)})`);

// The poll loop stays inside one cdp() call: the socket closes when it returns.
// Each poll is its own short send, so the 30s command timeout never covers the wait.
async function pickElements(message) {
  const tab = await page();
  const id = crypto.randomUUID();
  const state = await cdp(async (send) => {
    await send('Page.bringToFront');
    await installPicker(send, message, id);
    console.error('Waiting for picks in Chrome (Enter to finish, Esc to cancel)...');
    for (;;) {
      let s;
      try {
        ({ result: { value: s } } = await evaluate(send, 'window.__pwPick?.state ?? null'));
      } catch (e) {
        const gone = e.message === 'cdp socket closed'
          || !(await targets().catch(() => [])).some((t) => t.id === tab.id);
        if (gone) throw new Error('Pick aborted: the tab was closed.');
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }
      if (!s) throw new Error('Pick aborted: the page navigated or reloaded.');
      if (s.id !== id) throw new Error('Pick aborted: another pick took over this tab.');
      if (s.done) return s;
      await new Promise((r) => setTimeout(r, 250));
    }
  }, tab);
  if (state.cancelled) return 'Cancelled';
  if (!state.picks.length) return 'No picks';
  return state.picks.map((p, i) => [
    `[${i + 1}] ${p.tag} at (${p.x}, ${p.y})`,
    `selector: ${p.selector}`,
    ...(p.text ? [`text: ${p.text}`] : []),
    `rect: ${p.rect}`,
  ].join('\n')).join('\n\n');
}

// First bare integer wins, so `-n 20`, `20` and a stray `20]` all mean 20.
// An unparsed count must never reach slice(): slice(-NaN) and slice(-0) both
// return the whole log, which is the one thing these commands exist to avoid.
const lineCount = (a) => Math.abs(a.map((x) => parseInt(x, 10)).find(Number.isFinite) ?? 20) || 20;

// --since and its date come out before counting: the date's leading year would
// otherwise read as the line count.
function logArgs(a) {
  const i = a.indexOf('--since');
  if (i < 0) return { n: lineCount(a), since: null };
  // An unquoted `--since 2026-11-01 09:30` arrives as two words; the time
  // belongs to the date, not to the line count.
  const day = a[i + 1] ?? '';
  const time = /^\d{4}-\d\d-\d\d$/.test(day) && /^\d\d?:\d\d(:\d\d(\.\d+)?)?(Z|[+-]\d\d:?\d\d)?$/.test(a[i + 2] ?? '') ? a[i + 2] : '';
  const joined = /^\d{4}-\d\d-\d\d$/.test(day) ? `${day}T${time.replace(/^(\d):/, '0$1:') || '00:00'}` : day;
  // Date.parse also takes "5" or "Nov 1" and invents a year: only an ISO date
  // with an optional time and zone counts.
  const iso = joined.match(/^(\d{4}-\d\d-\d\d[T ]\d\d:\d\d(?::\d\d(?:\.\d+)?)?)(Z|[+-]\d\d:?\d\d)?$/);
  // The log stamps UTC, so a time without a zone is UTC too: a time copied
  // from the log then means what it says in any time zone.
  const since = iso ? Date.parse(iso[1].replace(' ', 'T') + (iso[2] ?? 'Z')) : NaN;
  if (Number.isNaN(since)) throw new Error(`--since needs a date such as 2026-11-01T09:30, got ${day}`);
  return { n: lineCount([...a.slice(0, i), ...a.slice(i + (time ? 3 : 2))]), since };
}

const loggedAt = (line) => { try { return Date.parse(JSON.parse(line).at); } catch { return 0; } };

function pick(kind, n, since = null) {
  if (!existsSync(LOG)) return '';
  return readFileSync(LOG, 'utf8').trim().split('\n')
    .filter((l) => l.includes(`"kind":"${kind}"`) && (since === null || loggedAt(l) >= since))
    .slice(-n).join('\n');
}

const realProfileDir = () =>
  process.platform === 'win32' ? join(process.env.LOCALAPPDATA ?? '', 'Google', 'Chrome', 'User Data')
    : process.platform === 'darwin' ? join(homedir(), 'Library', 'Application Support', 'Google', 'Chrome')
      : join(homedir(), '.config', 'google-chrome');

// A copy of a live profile must not carry the owner's lock files or the tabs it
// had open, or the copy would restore them.
const SKIP_NAMES = new Set(['SingletonLock', 'SingletonSocket', 'SingletonCookie']);
const SKIP_PARTS = [`${sep}Sessions${sep}`, `${sep}Current Session`, `${sep}Current Tabs`,
  `${sep}Last Session`, `${sep}Last Tabs`];
const shouldCopy = (src) => !SKIP_NAMES.has(basename(src)) && !SKIP_PARTS.some((p) => src.includes(p));

async function startBrowser(useProfile = false) {
  // Idempotent: a second start would attach a second logger to the same target
  // and write every console and network line twice.
  try {
    await targets();
    return `chrome already on :${PORT}${useProfile ? ' (--profile had no effect on a running chrome: close it first)' : ''}`;
  } catch { /* nothing listening yet */ }
  mkdirSync(PROFILE, { recursive: true, mode: 0o700 });
  chmodSync(PROFILE, 0o700);   // session cookies for every site; mkdir mode does not touch a profile that already exists
  for (const name of SKIP_NAMES) rmSync(join(PROFILE, name), { force: true });
  if (useProfile) cpSync(realProfileDir(), PROFILE, { recursive: true, force: true, filter: shouldCopy });
  for (const f of [LOG, DIALOG_POLICY, ACTIVE_TAB]) rmSync(f, { force: true });
  writePrivate(LOG, '');   // console/network must mean this session, not the last
  const child = spawn(
    BROWSER,
    [`--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, '--no-first-run',
     '--no-default-browser-check', ...(/^(1|true|yes)$/i.test(process.env.PW_HEADLESS ?? '') ? ['--headless=new'] : []), 'about:blank'],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  for (let i = 0; i < 50; i++) {
    try {
      await targets();
      break;
    } catch {
      if (i === 49) throw new Error('chrome did not open a debugging port');
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  spawn(process.execPath, [process.argv[1], 'logger'], { detached: true, stdio: 'ignore' }).unref();
  // A nav straight after start would otherwise run before the logger listens,
  // and its first request would go unlogged.
  for (let i = 0; i < 50; i++) {
    if (readFileSync(LOG, 'utf8').includes('"kind":"logger"')) return `chrome on :${PORT}`;
    await new Promise((r) => setTimeout(r, 100));
  }
  return `chrome on :${PORT}, but the console/network logger did not report ready`;
}

async function navigate(send, on, raw, settle) {
  // Bare hosts get https://, except loopback -- a local dev server is
  // almost never on TLS, and guessing wrong costs a whole retry.
  const loopback = /^(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(raw);
  // `host:8080` also matches a scheme-ish pattern, so only treat a URL as
  // complete when it has `://`, or is one of the schemes that never does.
  const schemed = /^\w+:\/\//.test(raw) || /^(data|file|about|blob):/.test(raw);
  const url = schemed ? raw : `${loopback ? 'http' : 'https'}://${raw}`;
  await send('Page.enable');
  const loaded = new Promise((r) => on('Page.domContentEventFired', r));
  // A same-document jump (#hash), a download and a failed load fire no
  // DOMContentLoaded; waiting for one would only hit the 30s cap.
  const { loaderId, errorText, isDownload } = await send('Page.navigate', { url });
  if (isDownload) return `${url} — started a download, the page did not change`;
  // The tab shows Chrome's error page, whose empty title would read as success.
  // ERR_ABORTED without a download is a 204-style answer: nothing to show.
  if (errorText === 'net::ERR_ABORTED') return `${url} — no new page, the page did not change`;
  if (errorText) throw new Error(`${url} — failed to load: ${errorText}`);
  if (loaderId) await Promise.race([loaded, new Promise((r) => setTimeout(r, 30_000))]);
  await new Promise((r) => setTimeout(r, +(settle ?? 1200)));
  const { result } = await evaluate(send, 'document.title');
  return `${url} — ${result.value}`;
}

// Console and network only exist while something is listening, so start
// spawns this to hold a socket open and append events to a file the
// short-lived read commands can tail. It holds the browser-level socket and
// attaches to every tab, including tabs opened later, so no tab goes unlogged.
async function runLogger() {
  const ws = new WebSocket(await browserSocket());
  await new Promise((ok) => ws.addEventListener('open', ok, { once: true }));
  let seq = 0;
  const send = (method, params = {}, sessionId) => {
    ws.send(JSON.stringify({ id: ++seq, method, params, ...(sessionId ? { sessionId } : {}) }));
    return seq;
  };
  const log = (entry) => appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n');
  const urlOf = new Map();   // targetId -> current url
  const tabOf = new Map();   // sessionId -> targetId
  // Ready once auto-attach has answered and every tab it found is listening.
  const waiting = new Set();
  let ready = false;
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    const p = msg.params;
    if (msg.id && waiting.delete(msg.id) && !waiting.size && !ready) {
      ready = true;
      log({ kind: 'logger', state: 'ready' });
    }
    const url = urlOf.get(tabOf.get(msg.sessionId));
    // A target can open on about:blank and only then load a Chrome UI page.
    // Attach events still run, so a child of such a page is not left paused.
    if (msg.sessionId && msg.method !== 'Target.attachedToTarget' && CHROME_UI.test(url ?? '')) return;
    if (msg.method === 'Target.targetCreated' || msg.method === 'Target.targetInfoChanged') {
      urlOf.set(p.targetInfo.targetId, p.targetInfo.url);
    } else if (msg.method === 'Target.attachedToTarget') {
      // Auto-attach holds every new target paused until it is told to run, so
      // the domains are on before its scripts do. One gap seen: a tab opened
      // through /json/new with an address already loading logs that first
      // response but not its request. `nav --new` opens about:blank and then
      // navigates, so it is not affected. A cross-origin
      // iframe runs in its own process as a child target of its tab, reached
      // only through auto-attach on the tab's own session.
      const { sessionId, targetInfo } = p;
      const wanted = isTab(targetInfo) || targetInfo.type === 'iframe';
      if (wanted) {
        tabOf.set(sessionId, targetInfo.targetId);
        urlOf.set(targetInfo.targetId, targetInfo.url);
        for (const [m, params] of [['Runtime.enable'], ['Network.enable'], ['Page.enable'],
          ['Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }]]) {
          const id = send(m, params, sessionId);
          if (!ready) waiting.add(id);
        }
      }
      send('Runtime.runIfWaitingForDebugger', {}, sessionId);
      // Detach goes to the session that attached it: the browser's or a tab's.
      if (!wanted) send('Target.detachFromTarget', { sessionId }, msg.sessionId);
    } else if (msg.method === 'Runtime.consoleAPICalled') {
      const text = p.args.map((a) => a.value ?? a.description ?? '').join(' ');
      log({ kind: 'console', level: p.type, url: clip(url), text });
    } else if (msg.method === 'Runtime.exceptionThrown') {
      const text = p.exceptionDetails.exception?.description || p.exceptionDetails.text;
      log({ kind: 'console', level: 'error', url: clip(url), text });
    } else if (msg.method === 'Page.javascriptDialogOpening') {
      const policy = readOwn(DIALOG_POLICY) ?? { action: 'accept' };
      log({ kind: 'dialog', type: p.type, url: clip(url), text: p.message, action: policy.action });
      send('Page.handleJavaScriptDialog',
        { accept: policy.action !== 'dismiss', ...(policy.text ? { promptText: policy.text } : {}) }, msg.sessionId);
    } else if (msg.method === 'Network.requestWillBeSent') {
      log({ kind: 'network', method: p.request.method, url: clip(p.request.url) });
    } else if (msg.method === 'Network.responseReceived') {
      log({ kind: 'network', status: p.response.status, url: clip(p.response.url) });
    }
  });
  send('Target.setDiscoverTargets', { discover: true });   // keeps each tab's url current
  waiting.add(send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: true }));
  await new Promise(() => {});
}

const [cmd, ...args] = process.argv.slice(2);

const commands = {
  start: () => startBrowser(args.includes('--profile')),
  pick: () => pickElements(args.join(' ') || 'Pick elements'),
  logger: () => runLogger(),
  nav: async () => {
    const [raw, settle] = args.filter((a) => a !== '--new');
    if (!raw) throw new Error('nav <url> [settle-ms] [--new]');
    const tab = args.includes('--new') ? await openTab() : undefined;
    return cdp((send, on) => navigate(send, on, raw, settle), tab);
  },
  snapshot: () =>
    cdp(async (send) => {
      const { result } = await evaluate(send, SNAPSHOT_JS);
      return result.value;
    }),
  click: () => cdp((send) => click(send, args)),
  type: () => cdp((send) => typeText(send, args.join(' '))),
  key: () => cdp((send) => key(send, args[0])),
  eval: () =>
    cdp(async (send) => {
      const { result } = await evaluateCode(send, args.join(' '));
      return typeof result.value === 'object' ? JSON.stringify(result.value) : String(result.value ?? result.description ?? '');
    }),
  console: () => { const { n, since } = logArgs(args); return pick('console', n, since); },
  network: () => { const { n, since } = logArgs(args); return pick('network', n, since); },
  tabs: async () => {
    if (args[0] === 'switch') {
      const t = await switchTab(args[1]);
      return `switched to ${shortId(t)}: ${clip(t.url)}`;
    }
    const list = await tabList();
    const active = await page();
    return list.map((t, i) => `${t.id === active.id ? '*' : ' '} ${i} ${shortId(t)}  ${t.title} — ${clip(t.url)}`).join('\n');
  },
  scroll: () => {
    const [dx, dy] = args.map(Number);
    if (args.length !== 2 || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('scroll <dx> <dy>');
    return cdp(async (send) => { await scroll(send, dx, dy); return `scrolled ${dx},${dy}`; });
  },
  wait: async () => {
    const ms = Number(args[0]);
    // setTimeout fires at once past 2^31-1 ms, which would report a wait that never happened.
    if (!args[0] || !Number.isFinite(ms) || ms < 0 || ms > 2 ** 31 - 1) throw new Error('wait <ms>, at most 2147483647');
    await new Promise((r) => setTimeout(r, ms));
    return `waited ${ms}ms`;
  },
  screenshot: () =>
    cdp(async (send) => {
      const { data } = await send('Page.captureScreenshot', { format: 'png' });
      return artefact('shot', 'png', Buffer.from(data, 'base64'));
    }),
  find: () =>
    cdp(async (send) => {
      const { result } = await evaluate(send, SNAPSHOT_JS);
      const q = args.join(' ').toLowerCase();
      const hits = result.value.split('\n').filter((l) => l.toLowerCase().includes(q));
      return hits.length ? hits.join('\n') : `nothing matching "${args.join(' ')}"`;
    }),
  fill: () => {
    if (!args.length) throw new Error('fill <selector=value> [selector=value ...]');
    return cdp(async (send) => {
      const { result } = await evaluate(send, FILL_JS(args.map(splitPair)));
      return result.value;
    });
  },
  upload: () => {
    if (args.length < 2) throw new Error('upload <selector> <file> [file ...]');
    return cdp(async (send) => {
      const files = args.slice(1).map((f) => resolve(f));
      for (const f of files) if (!existsSync(f)) throw new Error(`no such file: ${f}`);
      await send('DOM.enable');
      const { root } = await send('DOM.getDocument', { depth: 0 });
      const { nodeId } = await send('DOM.querySelector', { nodeId: root.nodeId, selector: args[0] });
      if (!nodeId) throw new Error(`no element matches ${args[0]}`);
      await send('DOM.setFileInputFiles', { nodeId, files });
      return `attached ${files.length} file(s) to ${args[0]}`;
    });
  },
  drag: () =>
    cdp(async (send) => {
      const [src, dst] = args;
      const { result } = await evaluate(send, `!!document.querySelector(${JSON.stringify(src)})?.draggable`);
      if (result.value) {
        const { result: r } = await evaluate(send, DRAG_JS(src, dst));
        if (r.value !== 'ok') throw new Error(r.value);
        return `dragged ${src} onto ${dst} (html5)`;
      }
      await dragMouse(send, await resolvePoint(send, [src]), await resolvePoint(send, [dst]));
      return `dragged ${src} onto ${dst} (mouse)`;
    }),
  dialog: () => {
    if (!args.length) {
      return pick('dialog', 50) || 'no dialogs seen';
    }
    if (!['accept', 'dismiss'].includes(args[0])) throw new Error('dialog <accept|dismiss> [text]');
    writePrivate(DIALOG_POLICY, JSON.stringify({ action: args[0], text: args.slice(1).join(' ') || undefined }));
    return `dialogs will be ${args[0]}ed`;
  },
  media: () =>
    cdp(async (send) => {
      const m = args[0] || 'none';
      await send('Emulation.setEmulatedMedia', ['dark', 'light'].includes(m)
        ? { features: [{ name: 'prefers-color-scheme', value: m }] }
        : { media: m === 'none' ? '' : m });
      return `emulating ${m}`;
    }),
  pdf: () =>
    cdp(async (send) => {
      const { data } = await send('Page.printToPDF', { printBackground: true });
      return artefact('page', 'pdf', Buffer.from(data, 'base64'));
    }),
  trace: () =>
    cdp(async (send, on) => {
      const events = [];
      // push(...batch) passes one argument per event and blows the stack on a
      // large batch, which dies mid-run and leaves tracing enabled.
      on('Tracing.dataCollected', (p) => { for (const e of p.value) events.push(e); });
      const complete = new Promise((r) => on('Tracing.tracingComplete', r));
      await send('Tracing.start', { transferMode: 'ReportEvents' });
      await new Promise((r) => setTimeout(r, +(args[0] || 3) * 1000));
      await send('Tracing.end');
      await complete;
      const path = artefact('trace', 'json', JSON.stringify({ traceEvents: events }));
      return `${path} — ${events.length} events`;
    }),
  // Browser.close races its own socket teardown: the socket dying is the
  // success signal, not a failure.
  close: () => cdp((send) => send('Browser.close').catch(() => {}))
    // The port keeps answering for ~150ms after the reply, so "closed" only
    // means closed once it stops: a start in that window finds a dying
    // instance and returns without spawning anything.
    .then(async () => {
      for (let i = 0; i < 25; i++) {
        try { await targets(); } catch { return 'closed'; }
        await new Promise((r) => setTimeout(r, 100));
      }
      return `chrome on :${PORT} still answering after Browser.close`;
    })
    .catch((e) => `could not close: ${e.message} (kill the chrome on :${PORT} by hand)`),

  // The smallest thing that fails if snapshot stops being actionable: every
  // line must carry a selector, and a selector taken from the snapshot must
  // actually resolve to the element it names. Needs `start` first.
  selfcheck: () =>
    cdp(async (send) => {
      const fixture = 'data:text/html,' + encodeURIComponent(
        '<title>t</title><h1>Head</h1><input id=a placeholder=Name>' +
        '<input type=checkbox id=c><input type=radio name=r><input type=radio name=r>' +
        '<div id=s draggable=true>s</div><div id=d>d</div>' +
        '<button>Send</button><ul><li>x<li>y</ul><input id=k>' +
        '<div><div><div><div><ul><li><a href="#">deep</a></ul></div></div></div></div>'.repeat(2) +
        '<div style="height:3000px"></div><button id=below>Below</button>' +
        '<script>k.onkeydown=e=>{k.dataset.last=e.key+":"+e.keyCode+":"+e.code;' +
        'k.dataset.enters=(+k.dataset.enters||0)+(e.key==="Enter")};' +
        'd.ondragover=e=>e.preventDefault();' +
        'd.ondrop=e=>{e.preventDefault();d.textContent="hit"};' +
        'console.log("pw-selfcheck-first-tab")</script>');
      const startedAt = Date.now() - 1000;
      await send('Page.navigate', { url: fixture });
      await new Promise((r) => setTimeout(r, 400));
      const { result } = await evaluate(send, SNAPSHOT_JS);
      const lines = result.value.split('\n').slice(1).filter(Boolean);

      const problems = [];
      if (!lines.length) problems.push('snapshot produced no elements');
      for (const line of lines) {
        if (!line.includes('  @')) problems.push(`no selector: ${line}`);
      }
      if (!lines.some((l) => l.startsWith('textbox "Name"  @#a'))) {
        problems.push('placeholder did not become the accessible name, or id was not used');
      }
      if (!lines.some((l) => l.startsWith('button "Send"'))) problems.push('button text not picked up');
      if (!lines.some((l) => l.startsWith('checkbox'))) {
        problems.push('a checkbox was not reported as role checkbox');
      }

      // fill must reach the value through the native setter, and drag must
      // actually deliver a drop -- both are silent when they regress.
      await evaluate(send, FILL_JS([['#a', 'typed'], ['#c', 'true']]));
      const { result: filled } = await evaluate(send,
        'document.querySelector("#a").value + "/" + document.querySelector("#c").checked');
      if (filled.value !== 'typed/true') problems.push(`fill produced ${filled.value}, want typed/true`);

      const { result: dropped } = await evaluate(send, DRAG_JS('#s', '#d'));
      if (dropped.value !== 'ok') problems.push(`drag returned ${dropped.value}`);
      const { result: dtext } = await evaluate(send, 'document.querySelector("#d").textContent');
      if (dtext.value !== 'hit') problems.push('drag did not deliver a drop event');

      // Every emitted selector must resolve, and resolve uniquely.
      for (const line of lines) {
        const sel = line.split('  @')[1];
        const { result: r } = await evaluate(send, `document.querySelectorAll(${JSON.stringify(sel)}).length`);
        if (r.value !== 1) problems.push(`selector ${sel} matched ${r.value} elements, want 1`);
      }
      await evaluate(send, 'scrollTo(0, 0)');
      await scroll(send, 0, 400);
      await new Promise((r) => setTimeout(r, 300));
      const { result: scrolled } = await evaluate(send, 'scrollY');
      if (!(scrolled.value > 0)) problems.push(`scroll 0 400 left scrollY at ${scrolled.value}`);

      // A control below the fold has to be scrolled on screen before its centre
      // is a usable click coordinate.
      const { result: centre } = await evaluate(send, `[${CENTER_OF('#below')}.y, innerHeight]`);
      const [cy, vh] = centre.value;
      if (!(cy >= 0 && cy <= vh)) problems.push(`#below centre y=${cy} outside viewport 0..${vh}`);

      // A throwing page expression must reach the caller as an error.
      let threw = '';
      try { await evaluate(send, 'null.x'); } catch (e) { threw = e.message; }
      if (!threw.includes('TypeError')) problems.push(`page exception did not surface (got "${threw}")`);

      // A top-level return runs as a function body; a SyntaxError thrown while
      // running must not run the code a second time.
      const { result: ret } = await evaluateCode(send, 'const a = 2; return a * 3');
      if (ret.value !== 6) problems.push(`eval with return gave ${ret.value}, want 6`);
      let runtimeSyntax = '';
      try {
        // Holds a `return` and compiles, so only the runtime error can trigger a retry.
        await evaluateCode(send, 'window.runs = (window.runs || 0) + 1; JSON.parse("x"); function f() { return 1 }');
      } catch (e) { runtimeSyntax = e.message; }
      const { result: runs } = await evaluate(send, 'window.runs');
      if (!runtimeSyntax.startsWith('SyntaxError') || runs.value !== 1) {
        problems.push(`a runtime SyntaxError ran the code ${runs.value} times ("${runtimeSyntax}")`);
      }
      // Without a return, a function body would turn any value into undefined.
      const { result: awaited } = await evaluateCode(send, 'await Promise.resolve(5)');
      if (awaited.value !== 5) problems.push(`top-level await gave ${awaited.value}, want 5`);
      // Like the DevTools console, a second eval may declare the same const.
      let redeclared = '';
      for (let i = 0; i < 2; i++) {
        try { await evaluateCode(send, 'const pwTwice = 1; pwTwice'); } catch (e) { redeclared = e.message; }
      }
      if (redeclared) problems.push(`declaring a const in a second eval failed: ${redeclared}`);
      // `return` inside an inner function or a string is not a top-level return.
      for (const [code, want] of [
        ['await Promise.resolve(1); [1,2].map(function (x) { return x * 2 })', '[2,4]'],
        ['const v = await Promise.resolve("ok"); v + " return"', '"ok return"'],
        ['const w = await Promise.resolve(3); return w + 1', '4'],
        ['{a: 1}', '{"a":1}'],
        // A promise as the final value is waited for, as the console does.
        ['new Promise((r) => setTimeout(() => r(5), 50))', '5'],
        ['(async () => 7)()', '7'],
        ['document.title', '"t"'],
      ]) {
        let got;
        try { got = JSON.stringify((await evaluateCode(send, code)).result.value); } catch (e) { got = e.message; }
        if (got !== want) problems.push(`eval ${code} gave ${got}, want ${want}`);
      }

      const counts = [[], ['-n'], ['-n', '5'], ['-20'], ['20]'], ['0']].map(lineCount);
      if (counts.join() !== '20,20,5,20,20,20') problems.push(`lineCount gave ${counts}, want 20,20,5,20,20,20`);
      const sinceArgs = logArgs(['--since', '2026-11-01T09:30:00Z', '-n', '5']);
      if (sinceArgs.n !== 5 || sinceArgs.since !== Date.parse('2026-11-01T09:30:00Z')) {
        problems.push(`logArgs gave ${JSON.stringify(sinceArgs)}`);
      }
      const bareDate = logArgs(['--since', '2026-11-01']);
      if (bareDate.n !== 20) problems.push('the --since year was read as the line count');
      if (bareDate.since !== Date.UTC(2026, 10, 1)) problems.push('a bare --since date was not UTC midnight');
      const splitTime = logArgs(['--since', '2026-11-01', '9:30', '-n', '5']);
      if (splitTime.n !== 5 || splitTime.since !== Date.UTC(2026, 10, 1, 9, 30)) {
        problems.push(`an unquoted --since time gave ${JSON.stringify(splitTime)}`);
      }
      for (const loose of ['5', 'Nov 1']) {
        let refused = false;
        try { logArgs(['--since', loose]); } catch { refused = true; }
        if (!refused) problems.push(`--since ${loose} was accepted as a date`);
      }

      const split = ['#a=b', 'input[name="q"]=x]y', '#a=x=y'].map(splitPair);
      const wantSplit = [['#a', 'b'], ['input[name="q"]', 'x]y'], ['#a', 'x=y']];
      if (JSON.stringify(split) !== JSON.stringify(wantSplit)) problems.push(`splitPair gave ${JSON.stringify(split)}`);

      // A key press must carry a virtual key code: keyCode stays 0 otherwise
      // and the Enter-to-submit idiom silently does nothing.
      await evaluate(send, 'document.querySelector("#k").focus()');
      await key(send, 'ArrowDown');
      const { result: pressed } = await evaluate(send, 'document.querySelector("#k").dataset.last ?? "none"');
      if (pressed.value !== 'ArrowDown:40:ArrowDown') problems.push(`key ArrowDown recorded ${pressed.value}`);
      let badKey = '';
      try { await key(send, 'Meh'); } catch (e) { badKey = e.message; }
      if (!badKey.includes('unknown key')) problems.push('an unknown key name did not throw');
      let noKey = '';
      try { await key(send, undefined); } catch (e) { noKey = e.message; }
      if (!noKey.startsWith('key <name>')) problems.push(`key with no name said "${noKey}"`);
      await key(send, 'a');
      const { result: letter } = await evaluate(send, 'document.querySelector("#k").dataset.last');
      if (letter.value !== 'a:65:KeyA') problems.push(`key a recorded ${letter.value}`);
      await evaluate(send, 'document.querySelector("#k").value = ""');

      // type must refuse when nothing is focused rather than report a count.
      await evaluate(send, 'document.activeElement.blur()');
      let blind = '';
      try { await typeText(send, 'zz'); } catch (e) { blind = e.message; }
      if (!blind.includes('nothing focused')) problems.push(`type with nothing focused returned "${blind}"`);
      await evaluate(send, 'document.querySelector("#k").focus()');
      await typeText(send, 'zz');
      const { result: typed } = await evaluate(send, 'document.querySelector("#k").value');
      if (typed.value !== 'zz') problems.push(`type produced "${typed.value}", want zz`);
      const { result: lastTyped } = await evaluate(send, 'document.querySelector("#k").dataset.last');
      if (lastTyped.value !== 'z:90:KeyZ') problems.push(`type sent no key events (last key ${lastTyped.value})`);
      await evaluate(send, 'document.querySelector("#k").dataset.enters = 0');
      await typeText(send, 'x\r\ny');
      const { result: enters } = await evaluate(send, 'document.querySelector("#k").dataset.enters');
      if (enters.value !== '1') problems.push(`typing a CRLF pressed Enter ${enters.value} times, want 1`);
      // A Tab that leaves nothing focused: the rest must not be counted as
      // typed. The field drops focus itself, since where a Tab off the last
      // control lands differs between a window and headless.
      await evaluate(send, `(() => { const k = document.querySelector("#k");
        k.addEventListener("keydown", (e) => { if (e.key === "Tab") { e.preventDefault(); k.blur(); } });
        k.focus(); })()`);
      let tabbedOut = '';
      try { await typeText(send, 'x\ty'); } catch (e) { tabbedOut = e.message; }
      if (!tabbedOut.startsWith('typed 2 of 3 chars')) problems.push(`typing past the last field said "${tabbedOut}"`);

      // Enter ends a pick, Escape cancels it, and both leave a state to read.
      for (const [name, cancelled] of [['Enter', false], ['Escape', true]]) {
        await installPicker(send, 'selfcheck', name);
        await key(send, name);
        const { result: picked } = await evaluate(send, 'JSON.stringify(window.__pwPick.state)');
        const st = JSON.parse(picked.value);
        if (!st.done || st.cancelled !== cancelled || st.picks.length) problems.push(`pick ${name} left ${picked.value}`);
      }

      // start must no-op while an instance is live, and leave the log alone.
      const logBefore = existsSync(LOG) ? readFileSync(LOG, 'utf8') : '';
      const again = await startBrowser();
      if (!again.includes('already')) problems.push(`start against a live port said "${again}"`);
      if ((existsSync(LOG) ? readFileSync(LOG, 'utf8') : '') !== logBefore) {
        problems.push('start truncated the log of a live session');
      }

      // Tabs come last: opening one moves the focus off the page the checks
      // above drive.
      const savedTab = existsSync(ACTIVE_TAB) ? readFileSync(ACTIVE_TAB, 'utf8') : null;
      const opened = [];
      try {
        // A popup the page opens loads the moment it exists, so its first
        // request is logged only if the logger attaches as the tab is created.
        // The debugging port is a real http page that needs no server. A
        // network line shows this; a console line would not, since Chrome
        // replays console messages to a listener that comes late.
        const marker = `pw-selfcheck-${Date.now()}`;
        const before = Date.now() - 1000;
        await evaluate(send, `window.open("http://localhost:${PORT}/json/version?${marker}"), 1`, { userGesture: true });
        opened.push(await openTab('data:text/html,' + encodeURIComponent(`<script>console.log("${marker}")</script>`)));
        // Waits for the lines rather than a fixed time: a cold profile was seen
        // taking 650ms to log the new tab's console line.
        const requested = () => pick('network', 50, before).split('\n')
          .some((l) => l.includes('"method":"GET"') && l.includes(marker));
        const logged = () => pick('console', 50, before).includes(marker);
        for (let i = 0; i < 50 && !(requested() && logged()); i++) await new Promise((r) => setTimeout(r, 100));
        const popup = (await targets()).find((t) => t.url.startsWith('http') && t.url.includes(marker));
        if (popup) opened.push(popup);
        if (!requested()) problems.push('the logger missed the first request of a popup');
        if (!logged()) problems.push('the logger missed console output of a new tab');
        if (!pick('console', 200, startedAt).includes('pw-selfcheck-first-tab')) {
          problems.push('the logger missed the tab selfcheck runs in');
        }
        if (pick('console', 50, Date.now() + 60_000)) problems.push('--since in the future still returned lines');

        // A new tab shifts the numbers; an id from before it must still land.
        const target = (await tabList()).find((t) => t.id !== opened[0].id);
        opened.push(await openTab());
        const landed = target && await switchTab(shortId(target));
        if (!target || landed.id !== target.id || (await page()).id !== target.id) {
          problems.push('switching by id after a new tab opened picked the wrong tab');
        }
        // An Enter that submits a form must stop the typing, and a failed load
        // must not read as success. Both need a page of their own.
        const form = await openTab('data:text/html,' + encodeURIComponent(
          `<form action="http://localhost:${PORT}/json/version"><input id=q></form>`));
        opened.push(form);
        await new Promise((r) => setTimeout(r, 300));
        const submitted = await cdp(async (s) => {
          await evaluate(s, 'document.querySelector("#q").focus()');
          try { await typeText(s, 'ab\ncd'); } catch (e) { return e.message; }
          return 'typed it all';
        }, form);
        // In a tab of its own: the form's page may still be loading.
        const blank = await openTab();
        opened.push(blank);
        const failed = await cdp(async (s, o) => {
          try { await navigate(s, o, 'http://localhost:1/', 0); } catch (e) { return e.message; }
          return 'loaded';
        }, blank);
        if (!submitted.includes('started loading another page')) problems.push(`an Enter that submits a form said "${submitted}"`);
        if (!failed.includes('failed to load')) problems.push(`a failed nav said "${failed}"`);

        const tabMode = (statSync(ACTIVE_TAB).mode & 0o777).toString(8);
        if (process.platform !== 'win32' && tabMode !== '600') problems.push(`chosen-tab file mode ${tabMode}, want 600`);
      } finally {
        for (const t of opened) await fetch(`http://localhost:${PORT}/json/close/${t.id}`);
        savedTab === null ? rmSync(ACTIVE_TAB, { force: true }) : writePrivate(ACTIVE_TAB, savedTab);
      }

      // Artefacts carry page content: readable by their owner only.
      // Windows derives mode bits from the read-only attribute, not the ACL, so
      // they are meaningless there; access control is left to NTFS.
      const art = artefact('selfcheck', 'txt', 'x');
      const mode = (statSync(art).mode & 0o777).toString(8);
      if (process.platform !== 'win32' && mode !== '600') problems.push(`artefact mode ${mode}, want 600`);
      rmSync(art, { force: true });

      if (problems.length) throw new Error('selfcheck FAILED\n  ' + problems.join('\n  '));
      return `selfcheck OK — ${lines.length} elements, all addressable`;
    }),
};

if (!Object.hasOwn(commands, cmd)) {
  console.error(`usage: pw.mjs <${Object.keys(commands).filter((c) => c !== 'logger').join('|')}> [args]`);
  process.exit(2);
}
try {
  const out = await commands[cmd]();
  // An empty result still has to print: silence reads as a crash.
  console.log(out === '' ? '(none)' : out);
  process.exit(0);
} catch (err) {
  console.error(String(err.message || err));
  process.exit(1);
}
