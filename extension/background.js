const BRIDGE_URL = 'http://127.0.0.1:17172';
const POLL_DELAY_MS = 700;
const RETRY_DELAY_MS = 2000;
let clientId = 'qwen-bridge-' + crypto.randomUUID();
let polling = false;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function post(path, body) {
  const resp = await fetch(BRIDGE_URL + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

async function findTab(params = {}) {
  const tabs = await chrome.tabs.query(params.query || {});
  if (params.tabId) {
    try { return await chrome.tabs.get(params.tabId); } catch {}
  }
  let tab = null;
  if (params.urlIncludes) tab = tabs.find(t => (t.url || '').includes(params.urlIncludes));
  if (!tab && params.titleIncludes) tab = tabs.find(t => (t.title || '').includes(params.titleIncludes));
  if (!tab) tab = tabs.find(t => t.active) || tabs[0];
  if (!tab) throw new Error('No tab found');
  return tab;
}

async function waitForLoad(tabId, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(250);
  }
  throw new Error('Timed out waiting for tab load');
}

async function evalInTab(tabId, expression, args = {}) {
  const injections = await chrome.scripting.executeScript({
    target: { tabId },
    world: 'MAIN',
    func: (opts) => {
      try {
        const value = (0, eval)(opts.expression);
        return { ok: true, value };
      } catch (err) {
        return { ok: false, error: String(err && err.message || err) };
      }
    },
    args: [{ expression, args }],
  });
  const res = injections[0] && injections[0].result;
  if (!res) throw new Error('Injection returned no result');
  if (!res.ok) throw new Error(res.error || 'Evaluation error');
  return res.value;
}

async function withDebugger(tabId, handler) {
  const target = { tabId };
  let attached = false;
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    return await handler(target);
  } finally {
    if (attached) {
      try { await chrome.debugger.detach(target); } catch {}
    }
  }
}

async function runCommand(cmd) {
  const params = cmd.params || {};
  switch (cmd.action) {
    case 'getTabs': {
      const tabs = await chrome.tabs.query({});
      return { tabs: tabs.map(t => ({ id: t.id, windowId: t.windowId, title: t.title, url: t.url, active: t.active, status: t.status })) };
    }
    case 'navigate': {
      let tab;
      if (params.newTab) {
        tab = await chrome.tabs.create({ url: params.url, active: true });
      } else {
        tab = await findTab(params);
        await chrome.tabs.update(tab.id, { url: params.url, active: true });
      }
      if (params.wait !== false) {
        try { tab = await waitForLoad(tab.id, Number(params.timeoutMs || 30000)); } catch {}
      }
      return { tab: { id: tab.id, title: tab.title, url: tab.url, status: tab.status } };
    }
    case 'eval': {
      const tab = await findTab(params);
      const value = await evalInTab(tab.id, params.expression, params.args || {});
      return { tabId: tab.id, value };
    }
    case 'waitFor': {
      const tab = await findTab(params);
      const timeoutMs = Number(params.timeoutMs || 30000);
      const start = Date.now();
      let last = null;
      while (Date.now() - start < timeoutMs) {
        try {
          last = await evalInTab(tab.id, params.expression, params.args || {});
          if (last) return { tabId: tab.id, value: last, elapsedMs: Date.now() - start };
        } catch (e) { last = { __error: String(e && e.message || e) }; }
        await sleep(Number(params.pollMs || 700));
      }
      throw new Error('waitFor timed out; last=' + JSON.stringify(last));
    }
    case 'clickAt': {
      const tab = await findTab(params);
      const x = Number(params.x);
      const y = Number(params.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('x and y are required');
      await withDebugger(tab.id, async (target) => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: Number(params.clickCount || 1) });
        await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: Number(params.clickCount || 1) });
      });
      return { clickedAt: { x, y } };
    }
    case 'typeText': {
      const tab = await findTab(params);
      if (params.focusExpression) {
        await evalInTab(tab.id, params.focusExpression, params.args || {});
      }
      await withDebugger(tab.id, async (target) => {
        await chrome.debugger.sendCommand(target, 'Input.insertText', { text: String(params.text || '') });
      });
      return { typed: true, length: String(params.text || '').length };
    }
    case 'pressKey': {
      const tab = await findTab(params);
      const key = params.key || 'Enter';
      const code = params.code || (key === 'Enter' ? 'Enter' : key);
      await withDebugger(tab.id, async (target) => {
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'keyDown', key, code, text: params.text || (key.length === 1 ? key : undefined),
          windowsVirtualKeyCode: params.vk || undefined, nativeVirtualKeyCode: params.vk || undefined,
        });
        await chrome.debugger.sendCommand(target, 'Input.dispatchKeyEvent', {
          type: 'keyUp', key, code,
          windowsVirtualKeyCode: params.vk || undefined, nativeVirtualKeyCode: params.vk || undefined,
        });
      });
      return { pressed: key };
    }
    case 'getCookies': {
      const domains = Array.isArray(params.domains) ? params.domains : ['qwen.ai', 'aliyun.com', 'qianwen.com', 'tongyi.com'];
      const out = [];
      for (const domain of domains) {
        try {
          const cookies = await chrome.cookies.getAll({ domain });
          out.push(...cookies);
        } catch (e) {}
      }
      return { cookies: out };
    }
    case 'getAllCookies': {
      return { cookies: await chrome.cookies.getAll({}) };
    }
    case 'capture': {
      const tab = await findTab(params);
      const format = params.format || 'png';
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format });
      return { tabId: tab.id, dataUrl };
    }
    case 'getInfo': {
      const tab = await findTab(params);
      return { tab: { id: tab.id, title: tab.title, url: tab.url, status: tab.status } };
    }
    default:
      throw new Error('Unsupported action: ' + cmd.action);
  }
}

async function heartbeat(status = 'idle', error = null) {
  try { await post('/api/client/heartbeat', { clientId, name: 'qwen-local-bridge', version: '1.0.1', status, error }); } catch {}
}

async function pollLoop() {
  if (polling) return;
  polling = true;
  while (true) {
    try {
      await heartbeat('idle');
      const resp = await fetch(`${BRIDGE_URL}/api/next?clientId=${encodeURIComponent(clientId)}`);
      const payload = await resp.json();
      if (!payload.ok) throw new Error(payload.error || 'Bridge error ' + resp.status);
      if (payload.command) {
        const id = payload.command.id;
        try {
          await heartbeat('running');
          const result = await runCommand(payload.command);
          await post('/api/result', { id, clientId, ok: true, result });
        } catch (err) {
          await post('/api/result', { id, clientId, ok: false, error: String(err && err.message || err) });
        }
        await heartbeat('idle');
      }
      await sleep(POLL_DELAY_MS);
    } catch (err) {
      await sleep(RETRY_DELAY_MS);
    }
  }
}

chrome.runtime.onInstalled.addListener(() => { chrome.alarms.create('qwen-bridge-pulse', { periodInMinutes: 0.5 }); pollLoop(); });
chrome.runtime.onStartup.addListener(() => { chrome.alarms.create('qwen-bridge-pulse', { periodInMinutes: 0.5 }); pollLoop(); });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'qwen-bridge-pulse') pollLoop(); });
pollLoop();
