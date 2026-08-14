# Qwen Web Bridge Plugin

A small local plugin that lets an agent (or any local process) drive an already logged-in
Qwen web session in Edge/Chrome. It was originally built to ask Qwen3.8-Max from WSL
without touching the login state.

```
agent / harness
      |
      | HTTP JSON (127.0.0.1:17172)
      v
bridge_server.py  <------->  Qwen Web Bridge (browser extension)
                                  |  tabs / scripting / debugger / cookies
                                  v
                    logged-in qwen.ai or qianwen.com tab
```

## Contents

- `extension/` — Manifest V3 browser extension (unpacked).
- `bridge/bridge_server.py` — stdlib-only Python bridge server.
- `bridge/client.py` — tiny command-line client.
- `plugin.json` — optional metadata, adjust to the target harness schema if needed.
- `examples/` — ready-to-use command recipes.

## 1. Load the extension

1. Open `edge://extensions` (or `chrome://extensions`).
2. Enable **Developer mode**.
3. Click **Load unpacked** and select `extension/`.
4. Pin the extension if you want to see its badge.

The extension polls `http://127.0.0.1:17172` for commands. It does not phone home
anywhere else.

## 2. Start the bridge server

```bash
python3 bridge/bridge_server.py --bind 127.0.0.1 --port 17172
```

On WSL2, Windows browsers can normally reach this WSL listener through
`http://127.0.0.1:17172`.

## 3. Send commands

```bash
python3 bridge/client.py --action getTabs
python3 bridge/client.py --action getInfo
python3 bridge/client.py --action eval --expression "document.title"
python3 bridge/client.py --action navigate --params '{"url":"https://www.qianwen.com/"}'
python3 bridge/client.py --action getCookies --params '{"domains":["qianwen.com","aliyun.com"]}'
```

Use `--raw '<json-command>'` for anything else.

## Supported actions

| action        | meaning |
|---------------|---------|
| `getTabs`     | list browser tabs |
| `getInfo`     | active tab info |
| `navigate`    | navigate or create a tab (`params.url`) |
| `eval`        | run JS in page MAIN world (`params.expression`, optional `params.tabId`) |
| `waitFor`     | poll a JS expression until truthy |
| `getCookies`  | read Qwen/Aliyun cookies (`params.domains`) |
| `getAllCookies` | read all browser cookies (sensitive, local only) |
| `capture`     | PNG screenshot of visible tab |
| `clickAt`     | trusted CDP click at `params.x`, `params.y` |
| `typeText`    | trusted CDP text insertion after optional `params.focusExpression` |
| `pressKey`    | trusted CDP key press |

## Security notes

- The bridge server listens on loopback by default; do **not** bind `0.0.0.0` on a
  shared network.
- `getCookies` / `getAllCookies` expose browser login material. Only use them for
  local automation; never log or commit cookie values.
- The extension requests `cookies` and `debugger` permissions because that is what
  logged-in web automation requires. Review the manifest before publishing to a
  public plugin registry.

## Example: ask Qwen3.8-Max on qianwen.com

See `examples/qianwen_ask.md`.

## DeepSeek Harness integration

This project is published as a `dsh-plugin` for DeepSeek Harness. It does not need
to run inside the Harness process: the Harness agent can call it through its shell
tool with `bridge/client.py`, or through any HTTP client on `127.0.0.1:17172`.

A compact workflow:

```bash
python3 bridge/bridge_server.py &
python3 bridge/client.py --action navigate --params '{"url":"https://www.qianwen.com/"}'
python3 bridge/client.py --action eval --params '{"expression":"document.title"}'
```

See `examples/qianwen_ask.md` for a complete Qwen3.8-Max question-and-answer flow.

## Repository

- GitHub: https://github.com/Andy294753951/dsh-plugin-qwen-web-bridge
- Topic: `dsh-plugin`
