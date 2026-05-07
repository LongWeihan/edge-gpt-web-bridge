# Edge GPT Web Bridge

Edge GPT Web Bridge is a small local tool that lets Codex or another automation workflow ask ChatGPT through the Microsoft Edge web UI.

It is useful when you want an agent to use your own ChatGPT web account as an external advisor, while keeping the interaction visible in the browser.

## 中文快速上手

这个项目让 Codex 或其他本地自动化脚本固定使用 Microsoft Edge 打开 ChatGPT 网页端，并通过你已经登录的 ChatGPT 网页账号提问、复制长回答、配合文件上传和下载。

每个使用者都需要在自己的电脑上手动登录一次 ChatGPT。仓库不会也不应该包含任何人的浏览器 profile、cookie、账号数据、下载文件或测试输出。

```powershell
git clone https://github.com/LongWeihan/edge-gpt-web-bridge.git
cd edge-gpt-web-bridge
Copy-Item .\config.example.json .\config.json
node .\scripts\gpt-edge.mjs setup
```

第一次运行 `setup` 后，在打开的 Edge 窗口里手动登录 ChatGPT。之后可以这样测试：

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "用三句话解释 Transformer 的注意力机制。"
```

默认策略是 GPT-5.5 Thinking + `xhigh` / `深入`，新会话提问，并且不使用 Pro。只有在你明确愿意消耗 Pro 配额时才加 `--allow-pro`。

如果要让新的 Codex 会话复用这个能力，先安装仓库里的 skill：

```powershell
Copy-Item `
  -Path ".\codex-skill\edge-gpt-web" `
  -Destination "$env:USERPROFILE\.codex\skills\edge-gpt-web" `
  -Recurse -Force
```

然后在新 Codex 会话里说：

```text
Use $edge-gpt-web to ask ChatGPT in Edge. You may use my logged-in ChatGPT web account for ordinary questions. Avoid Pro unless I explicitly allow it. Ask before uploading sensitive files.
```

## What It Does

- Opens Microsoft Edge with a dedicated automation profile.
- Reuses your ChatGPT web login after you log in once.
- Sends prompts through the ChatGPT web UI.
- Tries to select GPT-5.5 Thinking with `xhigh` / `深入` reasoning by default.
- Avoids Pro by default, so smoke tests do not burn scarce Pro quota.
- Saves full answers to Markdown and JSON, including answers longer than the visible browser window.
- Supports file upload through the normal ChatGPT web UI when you attach files manually or via browser automation.

## Important Safety Notes

This tool operates a browser that may be logged in to a personal ChatGPT account.

- Do not commit `config.json`, `edge-profile/`, `outputs/`, screenshots, downloads, or browser profile data.
- Do not upload private files, secrets, logs, source code, medical/financial data, or personal data unless the user explicitly approves the exact files and purpose.
- Do not use Pro unless the user explicitly accepts Pro quota usage for that run.
- Do not use this to bypass CAPTCHA, paywalls, safety interstitials, or account restrictions.

## Requirements

- Windows with Microsoft Edge installed.
- Node.js 22 or newer.
- A ChatGPT account that can use the web app.
- Optional: Codex desktop app if you want to trigger this from Codex.

## Quick Start

Clone the repo:

```powershell
git clone https://github.com/LongWeihan/edge-gpt-web-bridge.git
cd edge-gpt-web-bridge
```

Create your local config:

```powershell
Copy-Item .\config.example.json .\config.json
```

Start Edge and open ChatGPT:

```powershell
node .\scripts\gpt-edge.mjs setup
```

The first time, log in to ChatGPT manually in the Edge window that opens. After login, check status:

```powershell
node .\scripts\gpt-edge.mjs status
```

Ask a question:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "用三句话解释 Transformer 的注意力机制。"
```

Long prompt from a file:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt-file .\my-prompt.md
```

Answers are saved under `outputs/`.

## Model Defaults

The default intent is:

- Model: latest GPT-5.5 shown in the ChatGPT web UI.
- Mode: Thinking.
- Effort: `xhigh`, shown as `深入` in Chinese UI.
- Session: new chat.
- Pro: disabled unless explicitly allowed.

Use `--allow-pro` only when you really want to spend Pro quota:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "Use Pro for this task." --allow-pro
```

Continue an existing conversation:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "基于上一轮继续展开。" --continue
```

Skip model configuration if you already selected the model in the UI:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "Use the current web UI model." --no-configure
```

## Using With Codex

You can install the included skill into your Codex skills directory:

```powershell
Copy-Item `
  -Path ".\codex-skill\edge-gpt-web" `
  -Destination "$env:USERPROFILE\.codex\skills\edge-gpt-web" `
  -Recurse -Force
```

Then in a new Codex session, say:

```text
Use $edge-gpt-web to ask ChatGPT in Edge. You may use my logged-in ChatGPT web account for ordinary questions. Avoid Pro unless I explicitly allow it. Ask before uploading sensitive files.
```

## File Uploads

The bridge itself is CDP-first. For full file upload automation, Codex can use browser/UI automation to click the ChatGPT attachment button and select local files.

Tested patterns:

- Single file: Markdown upload and file-grounded Q&A.
- Multiple files: paste quoted absolute file paths into the Windows file picker, for example:

```text
"C:\path\a.md" "C:\path\b.csv"
```

Included harmless test files live under `examples/`.

## Downloads

ChatGPT can create downloadable files in the web UI for simple generated artifacts such as Markdown files. The browser normally saves them to your Downloads folder. For text-only answers, the more reliable fallback is to copy the assistant answer and save it locally.

## Known Limitations

- ChatGPT web UI changes can break selectors.
- If Edge was already open without a remote debugging port, this CDP bridge cannot attach to that existing process. Use `setup` with the dedicated profile, or use Codex/browser UI automation as a fallback.
- Coordinate-only browser automation is fragile when the composer grows taller. Prefer CDP/DOM selection when possible.
- The bridge does not solve CAPTCHAs or login challenges. Log in manually.

## Smoke Test

After setup:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "请用 5 条 bullet 总结如何安全测试 Edge GPT bridge。"
```

You can also upload files from `examples/` through the ChatGPT UI to verify file-grounded answers.
