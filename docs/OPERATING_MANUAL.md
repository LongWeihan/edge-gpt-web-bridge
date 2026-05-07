# Operating Manual

This manual is written for a fresh Codex session that needs to use ChatGPT web through Microsoft Edge.

## Default Policy

Use GPT-5.5 Thinking with `xhigh` / `深入` for normal tests and routine use. Do not use Pro unless the user explicitly approves Pro quota usage.

Use a new chat by default. Continue an existing chat only when prior context is intentional.

## Safe Workflow

1. Run `node .\scripts\gpt-edge.mjs setup`.
2. Ask the user to log in manually if ChatGPT is not logged in.
3. Run `node .\scripts\gpt-edge.mjs status`.
4. Ask with `node .\scripts\gpt-edge.mjs ask --prompt "..."`
5. Read the generated Markdown or JSON answer from `outputs/`.

## Sensitive Data

Before uploading files or pasting sensitive content, state exactly what will be sent to ChatGPT and ask for confirmation.

Treat these as sensitive by default:

- source code from private repos
- credentials, tokens, cookies, API keys
- logs with personal data
- medical, financial, legal, or identity information
- private documents or browser history

## Long Answers

Do not rely on visible screen height. Prefer the saved Markdown/JSON outputs. If using the web UI manually, click the assistant message copy button and save clipboard text to a local file.

## File Uploads

Use harmless test files first. For Windows file picker multi-select, paste quoted absolute paths:

```text
"C:\path\a.md" "C:\path\b.csv"
```

## Downloads

If ChatGPT creates a downloadable artifact, click the link and check the user Downloads folder. If no real download is available, copy the assistant answer and save it locally.
