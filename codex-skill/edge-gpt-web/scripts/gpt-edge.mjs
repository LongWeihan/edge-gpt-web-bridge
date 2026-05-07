#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BRIDGE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CHATGPT_URL = "https://chatgpt.com/";

const DEFAULT_CONFIG = {
  remoteDebuggingPort: 9333,
  userDataDir: path.join(BRIDGE_ROOT, "edge-profile"),
  chatgptUrl: DEFAULT_CHATGPT_URL,
  defaultModel: "latest-5.5",
  defaultMode: "thinking",
  defaultEffort: "xhigh",
  defaultSession: "new-chat",
  allowPro: false,
  outputDir: path.join(BRIDGE_ROOT, "outputs"),
  edgePath: ""
};

function usage() {
  return `Edge GPT Bridge

Usage:
  node scripts/gpt-edge.mjs setup [--config config.json]
  node scripts/gpt-edge.mjs status [--config config.json] [--launch]
  node scripts/gpt-edge.mjs ask --prompt "..." [--config config.json] [--output outputs/answer.json]
  node scripts/gpt-edge.mjs ask --prompt-file prompt.md [--model latest-5.5] [--mode thinking] [--effort xhigh]
  node scripts/gpt-edge.mjs ask --prompt "..." --new-chat
  node scripts/gpt-edge.mjs ask --prompt "..." --continue

Commands:
  setup   Launch the dedicated Edge profile at ChatGPT so you can log in once.
  status  Check whether the Edge CDP endpoint and ChatGPT tab are reachable.
  ask     Ask ChatGPT through the Edge web UI and save JSON plus Markdown outputs.

Important:
  Use the dedicated Edge profile in config.json for reliable CDP automation. Log in to
  ChatGPT once in that profile, then reuse it for later Codex tasks.
  By default, ask avoids Pro and uses GPT-5.5 Thinking with xhigh/深入.
`;
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[key] = true;
    } else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function pathExists(candidate) {
  if (!candidate) return false;
  try {
    await fs.access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function loadConfig(flags) {
  const configPath = path.resolve(flags.config || process.env.EDGE_GPT_CONFIG || path.join(BRIDGE_ROOT, "config.json"));
  let fileConfig = {};
  if (await pathExists(configPath)) {
    fileConfig = JSON.parse(await fs.readFile(configPath, "utf8"));
  }
  const config = { ...DEFAULT_CONFIG, ...fileConfig };
  config.configPath = configPath;
  config.remoteDebuggingPort = Number(flags.port || config.remoteDebuggingPort || 9333);
  config.userDataDir = path.resolve(config.userDataDir || DEFAULT_CONFIG.userDataDir);
  config.outputDir = path.resolve(config.outputDir || DEFAULT_CONFIG.outputDir);
  config.chatgptUrl = config.chatgptUrl || DEFAULT_CHATGPT_URL;
  return config;
}

async function findEdgePath(config) {
  const candidates = [
    config.edgePath,
    process.env.EDGE_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe"
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  throw new Error("Cannot find msedge.exe. Set edgePath in config.json or EDGE_PATH.");
}

async function fetchJson(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForCdp(port, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await fetchJson(`http://127.0.0.1:${port}/json/version`, {}, 1500);
    } catch (error) {
      lastError = error;
      await sleep(500);
    }
  }
  throw new Error(`Edge CDP endpoint did not become ready on port ${port}: ${lastError?.message || "timeout"}`);
}

async function isCdpReady(port) {
  try {
    return await fetchJson(`http://127.0.0.1:${port}/json/version`, {}, 1000);
  } catch {
    return null;
  }
}

async function launchEdge(config) {
  const ready = await isCdpReady(config.remoteDebuggingPort);
  if (ready) return { launched: false, version: ready };

  await fs.mkdir(config.userDataDir, { recursive: true });
  const edgePath = await findEdgePath(config);
  const args = [
    `--remote-debugging-port=${config.remoteDebuggingPort}`,
    `--user-data-dir=${config.userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    config.chatgptUrl
  ];

  const child = spawn(edgePath, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: false
  });
  child.unref();
  const version = await waitForCdp(config.remoteDebuggingPort);
  return { launched: true, version };
}

async function listTargets(port) {
  return await fetchJson(`http://127.0.0.1:${port}/json/list`, {}, 5000);
}

async function createChatGptTarget(config) {
  const encoded = encodeURIComponent(config.chatgptUrl);
  try {
    await fetchJson(`http://127.0.0.1:${config.remoteDebuggingPort}/json/new?${encoded}`, { method: "PUT" }, 5000);
  } catch {
    await fetchJson(`http://127.0.0.1:${config.remoteDebuggingPort}/json/new?${encoded}`, {}, 5000).catch(() => null);
  }

  for (let i = 0; i < 20; i += 1) {
    const targets = await listTargets(config.remoteDebuggingPort);
    const target = targets.find((item) => item.type === "page" && (item.url || "").includes("chatgpt.com"));
    if (target) return target;
    await sleep(500);
  }
  throw new Error("Could not create a new ChatGPT page target in Edge.");
}

async function getOrCreateChatGptTarget(config, options = {}) {
  if (options.forceNewWindow) return await createChatGptTarget(config);
  let targets = await listTargets(config.remoteDebuggingPort);
  let target = targets.find((item) => item.type === "page" && (item.url || "").includes("chatgpt.com"));
  if (target) return target;
  return await createChatGptTarget(config);
}

class CdpClient {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.nextId = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    if (typeof WebSocket !== "function") {
      throw new Error("This script needs Node.js with global WebSocket support. Node 22+ is recommended.");
    }
    this.ws = new WebSocket(this.wsUrl);
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", reject, { once: true });
    });
    this.ws.addEventListener("message", (event) => {
      const raw = typeof event.data === "string" ? event.data : Buffer.from(event.data).toString("utf8");
      const message = JSON.parse(raw);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(`${message.error.message || "CDP error"} ${JSON.stringify(message.error.data || "")}`));
      else resolve(message.result || {});
    });
  }

  send(method, params = {}) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error("CDP WebSocket is not open.");
    }
    const id = ++this.nextId;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(payload);
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, 30000).unref?.();
    });
  }

  close() {
    try {
      this.ws?.close();
    } catch {
      // ignore close errors
    }
  }
}

async function connectToChatGpt(config, options = {}) {
  await launchEdge(config);
  const target = await getOrCreateChatGptTarget(config, options);
  const cdp = new CdpClient(target.webSocketDebuggerUrl);
  await cdp.connect();
  await cdp.send("Runtime.enable");
  await cdp.send("Page.enable");
  await cdp.send("Page.bringToFront");
  if (!target.url || !target.url.includes("chatgpt.com")) {
    await cdp.send("Page.navigate", { url: config.chatgptUrl });
  }
  await waitForDocumentReady(cdp);
  return cdp;
}

async function evaluate(cdp, expression, timeoutMs = 30000) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout: timeoutMs
  });
  if (result.exceptionDetails) {
    const text = result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Runtime.evaluate failed";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitForDocumentReady(cdp, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = await evaluate(cdp, `(() => ({readyState: document.readyState, url: location.href, title: document.title}))()`);
    if (state.readyState === "interactive" || state.readyState === "complete") return state;
    await sleep(500);
  }
  throw new Error("Timed out waiting for ChatGPT document readiness.");
}

function pageUtilityScript() {
  return `
    const norm = (s) => String(s || "").replace(/\\s+/g, " ").trim();
    const visible = (el) => {
      if (!el || !(el instanceof Element)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const textOf = (el) => norm([
      el.innerText,
      el.textContent,
      el.getAttribute && el.getAttribute("aria-label"),
      el.getAttribute && el.getAttribute("title"),
      el.getAttribute && el.getAttribute("placeholder"),
      el.value
    ].filter(Boolean).join(" "));
    const center = (rect) => ({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 });
    const synthClick = (el) => {
      el.scrollIntoView({ block: "center", inline: "center" });
      const rect = el.getBoundingClientRect();
      const point = center(rect);
      for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
        el.dispatchEvent(new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          composed: true,
          view: window,
          clientX: point.x,
          clientY: point.y,
          button: 0
        }));
      }
      return { x: point.x, y: point.y, text: textOf(el), tag: el.tagName, role: el.getAttribute("role") };
    };
    const clickables = () => [...document.querySelectorAll([
      "button",
      "[role='button']",
      "a",
      "[aria-haspopup]",
      "[data-testid]",
      "[tabindex]:not([tabindex='-1'])",
      "input",
      "textarea",
      "[contenteditable='true']"
    ].join(","))].filter(visible);
  `;
}

async function pageState(cdp) {
  return await evaluate(cdp, `(() => {
    ${pageUtilityScript()}
    const bodyText = norm(document.body?.innerText || "");
    const composer = (() => {
      const candidates = [...document.querySelectorAll("#prompt-textarea, textarea, [role='textbox'], [contenteditable='true']")]
        .filter(visible)
        .map((el) => ({ text: textOf(el), tag: el.tagName, role: el.getAttribute("role"), rect: el.getBoundingClientRect().toJSON?.() || { left: el.getBoundingClientRect().left, top: el.getBoundingClientRect().top, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height } }));
      return candidates[candidates.length - 1] || null;
    })();
    const buttons = clickables().slice(0, 120).map((el) => {
      const r = el.getBoundingClientRect();
      return { text: textOf(el).slice(0, 160), tag: el.tagName, role: el.getAttribute("role"), testid: el.getAttribute("data-testid"), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    });
    const hasLoginButton = !!document.querySelector("[data-testid='login-button'], button[name='login']") ||
      clickables().some((el) => /^(登录|Log in|Login)$/i.test(textOf(el)));
    const composerModeControls = clickables().filter((el) => {
      const r = el.getBoundingClientRect();
      return r.top > window.innerHeight * 0.38 &&
        r.top < window.innerHeight * 0.94 &&
        r.left > window.innerWidth * 0.55 &&
        r.right < window.innerWidth * 0.86;
    }).map((el) => {
      const r = el.getBoundingClientRect();
      return { text: textOf(el), tag: el.tagName, role: el.getAttribute("role"), x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }).filter((item) => item.text);
    return {
      title: document.title,
      url: location.href,
      bodyPreview: bodyText.slice(0, 1200),
      loggedInLikely: !!composer && !hasLoginButton && !/(登录 ChatGPT|登录以获取|Log in to ChatGPT|Sign up for free)/i.test(bodyText.slice(0, 2000)),
      composer,
      composerModeControls,
      buttons
    };
  })()`);
}

async function assertNotProMode(cdp, allowPro = false) {
  if (allowPro) return { ok: true, allowPro: true };
  const state = await pageState(cdp);
  const modeText = (state.composerModeControls || []).map((item) => item.text).join(" | ");
  if (/\bPro\b|专业|研究级智能模型/.test(modeText)) {
    throw new Error(`Refusing to send because the ChatGPT composer still appears to be in Pro mode: ${modeText}`);
  }
  return { ok: true, modeText };
}

async function clickByText(cdp, needles, options = {}) {
  const payload = JSON.stringify({ needles, options });
  return await evaluate(cdp, `(() => {
    ${pageUtilityScript()}
    const { needles, options } = ${payload};
    const lowerNeedles = needles.map((s) => norm(s).toLowerCase()).filter(Boolean);
    const candidates = clickables()
      .map((el) => {
        const r = el.getBoundingClientRect();
        const text = textOf(el);
        const lower = text.toLowerCase();
        const matched = lowerNeedles.some((needle) => lower.includes(needle));
        return { el, text, rect: r, area: r.width * r.height, matched };
      })
      .filter((item) => item.matched);

    let filtered = candidates;
    if (options.preferComposer) {
      const composerish = filtered.filter((item) => item.rect.top > window.innerHeight * 0.35 && item.rect.left > window.innerWidth * 0.35);
      if (composerish.length) filtered = composerish;
    }
    if (options.preferDialog) {
      const dialogish = filtered.filter((item) => item.rect.top > window.innerHeight * 0.2 && item.rect.top < window.innerHeight * 0.85 && item.rect.left > window.innerWidth * 0.25 && item.rect.left < window.innerWidth * 0.75);
      if (dialogish.length) filtered = dialogish;
    }
    if (options.preferRight) {
      const rightish = filtered.filter((item) => item.rect.left > window.innerWidth * 0.45);
      if (rightish.length) filtered = rightish;
    }
    filtered.sort((a, b) => {
      if (options.preferComposer) return b.rect.top - a.rect.top || a.area - b.area;
      if (options.preferSmall) return a.area - b.area;
      return a.rect.top - b.rect.top || a.area - b.area;
    });
    const target = filtered[0];
    if (!target) return { clicked: false, count: candidates.length, needles };
    const click = synthClick(target.el);
    return { clicked: true, count: candidates.length, selected: { text: target.text, x: click.x, y: click.y, tag: click.tag, role: click.role } };
  })()`);
}

async function clickCss(cdp, selectors) {
  return await evaluate(cdp, `(() => {
    ${pageUtilityScript()}
    const selectors = ${JSON.stringify(selectors)};
    for (const selector of selectors) {
      const elements = [...document.querySelectorAll(selector)].filter(visible);
      if (elements.length) return { clicked: true, selector, selected: synthClick(elements[elements.length - 1]) };
    }
    return { clicked: false, selectors };
  })()`);
}

async function pressEscape(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
}

async function keyComboCtrlA(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 2 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Control", code: "ControlLeft", windowsVirtualKeyCode: 17 });
}

async function pressBackspace(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
}

async function pressEnter(cdp) {
  await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13 });
}

function effortLabels(effort) {
  const map = {
    low: ["快速", "Fast", "Quick"],
    medium: ["标准", "Standard", "Medium"],
    high: ["进阶", "Advanced", "High"],
    xhigh: ["深入", "Deep", "Thorough", "Long"]
  };
  return map[effort] || map.medium;
}

async function configureChatGpt(cdp, { model, mode, effort }) {
  const wantedMode = String(mode || "thinking").toLowerCase();
  if (!wantedMode.includes("think")) return { configured: false, reason: "non-thinking mode requested" };

  const steps = [];
  let result = await clickByText(cdp, ["思考", "Thinking", "Pro", "Instant"], { preferComposer: true, preferSmall: true });
  steps.push({ step: "open-mode-menu", result });
  await sleep(600);

  result = await clickByText(cdp, ["配置", "Configure"], { preferDialog: true });
  steps.push({ step: "open-config-dialog", result });
  await sleep(600);

  if (!result.clicked) {
    result = await clickByText(cdp, ["Thinking", "思考"], { preferDialog: true });
    steps.push({ step: "direct-thinking-select", result });
    await sleep(500);
    return { configured: result.clicked, steps };
  }

  const targetModelNeedles = String(model || "").includes("5.5") ? ["5.5", "GPT-5.5", "最新"] : [];
  if (targetModelNeedles.length) {
    const state = await pageState(cdp);
    if (!/5\.5|最新/.test(state.bodyPreview)) {
      result = await clickByText(cdp, ["模型", "Model"], { preferDialog: true });
      steps.push({ step: "open-model-dropdown", result });
      await sleep(400);
      result = await clickByText(cdp, targetModelNeedles, { preferDialog: true });
      steps.push({ step: "select-model", result });
      await sleep(500);
    }
  }

  result = await clickByText(cdp, ["Thinking", "思考"], { preferDialog: true });
  steps.push({ step: "select-thinking", result });
  await sleep(500);

  result = await clickByText(cdp, ["快速", "标准", "进阶", "深入", "Fast", "Standard", "Medium", "Deep"], { preferDialog: true, preferRight: true });
  steps.push({ step: "open-effort-dropdown", result });
  await sleep(400);

  result = await clickByText(cdp, effortLabels(effort), { preferDialog: true });
  steps.push({ step: "select-effort", result });
  await sleep(500);

  await pressEscape(cdp);
  await sleep(300);
  return { configured: true, steps };
}

function resolveSessionMode(config, flags) {
  if (flags["new-window"]) return "new-window";
  if (flags["new-chat"]) return "new-chat";
  if (flags.continue) return "continue";
  return flags.session || config.defaultSession || "new-chat";
}

async function prepareSession(cdp, config, sessionMode) {
  if (sessionMode === "continue") return { sessionMode, action: "continued-current-chat" };
  if (sessionMode === "new-window") return { sessionMode, action: "new-window-created-before-connect" };
  if (sessionMode === "new-chat" || sessionMode === "new") {
    await cdp.send("Page.navigate", { url: config.chatgptUrl });
    await waitForDocumentReady(cdp);
    await sleep(1000);
    return { sessionMode: "new-chat", action: "navigated-to-chatgpt-root" };
  }
  throw new Error(`Unknown session mode: ${sessionMode}. Use new-chat, new-window, or continue.`);
}

async function assistantState(cdp) {
  return await evaluate(cdp, `(() => {
    ${pageUtilityScript()}
    const assistantNodes = [...document.querySelectorAll("[data-message-author-role='assistant']")].filter(visible);
    let nodes = assistantNodes;
    if (!nodes.length) {
      nodes = [...document.querySelectorAll("article")].filter(visible).filter((el) => {
        const t = textOf(el);
        return t && !/^You\\b|^用户[:：]/i.test(t);
      });
    }
    const answer = nodes.length ? norm(nodes[nodes.length - 1].innerText || nodes[nodes.length - 1].textContent || "") : "";
    const buttonText = clickables().map(textOf).join(" | ");
    const isGenerating = /Stop|停止|生成中|正在/.test(buttonText) || !!document.querySelector("[data-testid='stop-button'], button[aria-label*='Stop'], button[aria-label*='停止']");
    return { assistantCount: nodes.length, answer, answerLength: answer.length, isGenerating, url: location.href, title: document.title };
  })()`);
}

async function focusComposer(cdp) {
  return await evaluate(cdp, `(() => {
    ${pageUtilityScript()}
    const selectors = ["#prompt-textarea", "textarea", "[role='textbox']", "[contenteditable='true']"];
    const candidates = selectors.flatMap((selector) => [...document.querySelectorAll(selector)]).filter(visible);
    candidates.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
    const el = candidates[0];
    if (!el) return { focused: false };
    el.scrollIntoView({ block: "center", inline: "center" });
    el.focus();
    const r = el.getBoundingClientRect();
    return { focused: true, text: textOf(el), rect: { x: r.left, y: r.top, w: r.width, h: r.height } };
  })()`);
}

async function setPrompt(cdp, prompt) {
  const focus = await focusComposer(cdp);
  if (!focus.focused) throw new Error("Could not find ChatGPT composer. Are you logged in?");
  await keyComboCtrlA(cdp);
  await pressBackspace(cdp);
  await cdp.send("Input.insertText", { text: prompt });
  await sleep(500);
  return focus;
}

async function clickSend(cdp) {
  let result = await clickCss(cdp, [
    "button[data-testid='send-button']",
    "button[aria-label*='Send']",
    "button[aria-label*='发送']",
    "button[type='submit']"
  ]);
  if (result.clicked) return { sent: true, result };

  result = await clickByText(cdp, ["Send", "发送"], { preferComposer: true, preferSmall: true });
  if (result.clicked) return { sent: true, result };

  await pressEnter(cdp);
  return { sent: true, result: { fallback: "pressed-enter" } };
}

async function askChatGpt(cdp, prompt, options) {
  const before = await assistantState(cdp);
  await setPrompt(cdp, prompt);
  const send = await clickSend(cdp);

  const timeoutMs = Number(options.timeoutMs || 240000);
  const deadline = Date.now() + timeoutMs;
  let last = "";
  let stableCycles = 0;
  let state = await assistantState(cdp);

  while (Date.now() < deadline) {
    state = await assistantState(cdp);
    const changedFromBefore = state.assistantCount > before.assistantCount || (state.answer && state.answer !== before.answer);
    if (changedFromBefore && state.answer) {
      if (state.answer === last && !state.isGenerating) {
        stableCycles += 1;
      } else {
        stableCycles = 0;
        last = state.answer;
      }
      if (stableCycles >= 2) break;
    }
    await sleep(1500);
  }

  if (!state.answer) {
    throw new Error("No assistant answer was extracted before timeout.");
  }
  return { before, send, finalState: state };
}

async function captureScreenshot(cdp, outputPng) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, fromSurface: true });
  await fs.writeFile(outputPng, Buffer.from(result.data, "base64"));
  return outputPng;
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

async function writeOutputs(config, flags, payload) {
  await fs.mkdir(config.outputDir, { recursive: true });
  const outputJson = path.resolve(flags.output || path.join(config.outputDir, `edge-gpt-answer-${timestampName()}.json`));
  const outputMd = outputJson.replace(/\\.json$/i, ".md");
  await fs.writeFile(outputJson, JSON.stringify(payload, null, 2), "utf8");
  const md = [
    `# Edge GPT Answer`,
    ``,
    `- Asked: ${payload.askedAt}`,
    `- URL: ${payload.url}`,
    `- Model requested: ${payload.model}`,
    `- Mode requested: ${payload.mode}`,
    `- Effort requested: ${payload.effort}`,
    ``,
    `## Prompt`,
    ``,
    payload.prompt,
    ``,
    `## Answer`,
    ``,
    payload.answer
  ].join("\\n");
  await fs.writeFile(outputMd, md, "utf8");
  return { outputJson, outputMd };
}

async function readPrompt(flags) {
  if (flags.prompt) return String(flags.prompt);
  if (flags["prompt-file"]) return await fs.readFile(path.resolve(flags["prompt-file"]), "utf8");
  throw new Error("ask requires --prompt or --prompt-file.");
}

async function commandSetup(config) {
  const launch = await launchEdge(config);
  const target = await getOrCreateChatGptTarget(config);
  console.log(JSON.stringify({
    ok: true,
    launched: launch.launched,
    browser: launch.version.Browser,
    port: config.remoteDebuggingPort,
    profile: config.userDataDir,
    chatgptTarget: { title: target.title, url: target.url },
    next: "If ChatGPT asks you to log in, complete login once in this Edge window, then run status or ask."
  }, null, 2));
}

async function commandStatus(config, flags) {
  if (flags.launch) await launchEdge(config);
  const ready = await isCdpReady(config.remoteDebuggingPort);
  if (!ready) {
    console.log(JSON.stringify({ ok: false, port: config.remoteDebuggingPort, reason: "CDP endpoint is not running. Run setup first." }, null, 2));
    return;
  }
  const cdp = await connectToChatGpt(config);
  try {
    const state = await pageState(cdp);
    console.log(JSON.stringify({ ok: true, port: config.remoteDebuggingPort, profile: config.userDataDir, state }, null, 2));
  } finally {
    cdp.close();
  }
}

async function commandAsk(config, flags) {
  const prompt = await readPrompt(flags);
  const sessionMode = resolveSessionMode(config, flags);
  const cdp = await connectToChatGpt(config, { forceNewWindow: sessionMode === "new-window" });
  try {
    const sessionResult = await prepareSession(cdp, config, sessionMode);
    const initial = await pageState(cdp);
    if (!initial.loggedInLikely) {
      throw new Error("ChatGPT does not look logged in or the composer is not visible. Run setup and log in once in the dedicated Edge profile.");
    }

    const model = flags.model || config.defaultModel;
    const mode = flags.mode || config.defaultMode;
    const effort = flags.effort || config.defaultEffort;
    let configureResult = { skipped: true };
    if (!flags["no-configure"]) {
      configureResult = await configureChatGpt(cdp, { model, mode, effort });
    }
    const proGuard = await assertNotProMode(cdp, flags["allow-pro"] || config.allowPro);

    const askResult = await askChatGpt(cdp, prompt, { timeoutMs: flags["timeout-ms"] || flags.timeoutMs });
    const askedAt = new Date().toISOString();
    const payload = {
      askedAt,
      model,
      mode,
      effort,
      prompt,
      answer: askResult.finalState.answer,
      answerLength: askResult.finalState.answerLength,
      url: askResult.finalState.url,
      title: askResult.finalState.title,
      sessionResult,
      proGuard,
      configureResult
    };
    const outputs = await writeOutputs(config, flags, payload);
    if (flags.screenshot) {
      payload.screenshot = await captureScreenshot(cdp, outputs.outputJson.replace(/\\.json$/i, ".png"));
      await fs.writeFile(outputs.outputJson, JSON.stringify(payload, null, 2), "utf8");
    }
    console.log(JSON.stringify({ ok: true, outputs, answerLength: payload.answerLength, url: payload.url }, null, 2));
  } finally {
    cdp.close();
  }
}

async function maybeWriteDefaultConfig() {
  const configPath = path.join(BRIDGE_ROOT, "config.json");
  if (await pathExists(configPath)) return;
  await fs.mkdir(BRIDGE_ROOT, { recursive: true });
  const edgePath = fssync.existsSync("C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe")
    ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
    : "";
  const config = { ...DEFAULT_CONFIG, edgePath };
  await fs.writeFile(configPath, JSON.stringify(config, null, 2), "utf8");
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const command = flags._[0] || "help";
  if (command === "help" || flags.help) {
    console.log(usage());
    return;
  }
  await maybeWriteDefaultConfig();
  const config = await loadConfig(flags);
  if (command === "setup") return await commandSetup(config);
  if (command === "status") return await commandStatus(config, flags);
  if (command === "ask") return await commandAsk(config, flags);
  throw new Error(`Unknown command: ${command}\\n\\n${usage()}`);
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message, stack: process.env.DEBUG ? error.stack : undefined }, null, 2));
  process.exitCode = 1;
});
