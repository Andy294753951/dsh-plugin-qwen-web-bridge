# Example: ask Qwen3.8-Max on qianwen.com

Assumptions:

- The browser is already logged in to qianwen.com.
- The extension is loaded and the bridge server is running.
- Commands below use `bridge/client.py`.

## 1. Open qianwen.com and select Qwen3.8-Max

```bash
python3 bridge/client.py --action navigate --params '{"url":"https://www.qianwen.com/"}'

python3 bridge/client.py --action eval --params '{
  "expression": "(()=>{const el=Array.from(document.querySelectorAll(\"div\")).find(e=>e.innerText.trim()===\"Qwen3.7-千问\"&&e.className.includes(\"cursor\")); if(!el) throw new Error(\"model selector not found\"); el.click(); return true;})()"
}'

python3 bridge/client.py --action eval --params '{
  "expression": "(()=>{const el=Array.from(document.querySelectorAll(\"div\")).filter(e=>(e.innerText||\"\").includes(\"Qwen3.8-Max\")).find(e=>e.className.includes(\"cursor-pointer\")); if(!el) throw new Error(\"Qwen3.8-Max option not found\"); el.click(); return true;})()"
}'
```

## 2. Put a question into the Slate editor

qianwen.com uses a Slate-based contenteditable editor. Direct DOM insertion does not
update React state; instead, update the Slate editor object through the React fiber.

```bash
python3 bridge/client.py --action eval --params '{
  "expression": "(()=>{const box=document.querySelector(\"[role=textbox]\"); const key=Object.getOwnPropertyNames(box).find(k=>k.startsWith(\"__reactFiber\")); let f=box[key]; while(f){const p=f.memoizedProps||{}; if(p.editor&&typeof p.editor.insertText===\"function\"){const ed=p.editor; ed.children=[{type:\"paragraph\",children:[{text:\"请用一句话介绍你自己，并告诉我今天是哪一年哪一天，以及你的模型版本。\"}]}]; ed.selection={anchor:{path:[0,0],offset:33},focus:{path:[0,0],offset:33}}; ed.onChange(); return JSON.stringify(ed.children);} f=f.return;} throw new Error(\"slate editor not found\");})()"
}'
```

## 3. Click send and wait

```bash
python3 bridge/client.py --action eval --params '{
  "expression": "document.querySelector(\"button[aria-label=\\\"发送消息\\\"]\").click()"
}'
```

Then wait 10-20 seconds and read the answer card.

## Notes

The exact selectors are tied to the current qianwen.com frontend (`@ali/qianwen-web`
4.2.1). If the site changes, update the JS snippets or use CDP actions
(`clickAt`, `typeText`, `pressKey`) instead.
