---
name: edge-gpt-web
description: Use Microsoft Edge to operate the user's ChatGPT web account through a reusable local bridge. Use when Codex needs to ask ChatGPT in the Edge web UI, use the user's authorized private ChatGPT account, select GPT-5.5 Thinking with medium reasoning, retrieve long answers from the webpage, or automate ChatGPT web interactions from another project.
---

# Edge GPT Web

Use the bundled `scripts/gpt-edge.mjs` bridge to operate ChatGPT in Microsoft Edge through CDP. Prefer this bridge over ad hoc screen-coordinate clicking.

## Safety

The user has authorized ordinary use of Edge and their private ChatGPT web account for GPT queries. For ordinary tests, avoid `Pro` and use `最新 · 5.5` + `Thinking` + `深入/xhigh`. Only use `Pro` when the user explicitly asks for it and accepts Pro quota usage.

Still ask for action-time confirmation before uploading private files, entering passwords or OTPs, submitting forms, sending third-party messages, changing permissions, purchasing, or transmitting secrets and sensitive personal data.

Do not solve CAPTCHAs, bypass paywalls, or bypass browser safety interstitials.

## Setup

From the skill directory, run:

```powershell
node .\scripts\gpt-edge.mjs setup
```

This opens a dedicated Edge profile at `https://chatgpt.com/`. If ChatGPT is not logged in, have the user log in once in that Edge window. Then run:

```powershell
node .\scripts\gpt-edge.mjs status
```

Proceed when `state.loggedInLikely` is `true`.

## Ask ChatGPT

Short prompt:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "用三句话解释这个问题。"
```

Long prompt:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt-file C:\path\to\prompt.md
```

By default the bridge attempts to select `latest-5.5`, `thinking`, and `xhigh`; in Chinese ChatGPT UI, `xhigh` maps to `深入`. It also refuses to send if the composer still appears to be in `Pro` mode, unless `--allow-pro` is provided.

Avoid historical context by default:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "..." --new-chat
```

Continue the current conversation only when that is intentional:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "..." --continue
```

If the model menu has changed or the page is already configured manually, use:

```powershell
node .\scripts\gpt-edge.mjs ask --prompt "..." --no-configure
```

## Outputs

Read the generated JSON or Markdown file from `outputs/`. The bridge extracts the last assistant message from the DOM, so answers longer than the visible browser window should still be captured.

If extraction fails, retry with `--screenshot` and inspect whether the page is logged out, rate-limited, errored, or has changed UI structure.

## Reuse From Another Project

Call the bridge with an absolute path, or set `EDGE_GPT_CONFIG` to point at the desired `config.json`:

```powershell
$env:EDGE_GPT_CONFIG="C:\path\to\edge-gpt-bridge\config.json"
node C:\path\to\edge-gpt-web\scripts\gpt-edge.mjs ask --prompt "..."
```
