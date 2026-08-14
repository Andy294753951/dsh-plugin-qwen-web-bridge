# Using from DeepSeek Harness

The plugin exposes a loopback HTTP API and a CLI, so a Harness agent can drive a
logged-in Qwen web tab through any shell tool.

1. Load the browser extension and start the bridge server (see README).
2. In the Harness session, ask the agent to run, for example:

```bash
python3 bridge/client.py --action navigate --params '{"url":"https://www.qianwen.com/"}'
python3 bridge/client.py --action eval --params '{"expression":"document.title"}'
```

3. The command result is returned as JSON. The agent can parse it and continue.

No Harness service or tool registration is required for this integration mode.
