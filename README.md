# OpenCode architect workflow for one self-hosted model

Four roles, all on the same model:

- `head-architect`: talks a design through with you and writes PLAN.md (format
  in the `plan-md` skill), then audits the finished work.
- `architect` (default agent): sole orchestrator. Takes one PLAN.md task at a
  time, delegates it to the developer, inspects the result, has it reviewed,
  audits it and commits it as `task <ID>: ...`.
- `developer`: implements one task and writes REPORT.md.
- `reviewer`: reviews independently and writes REVIEW.md. It can edit only
  REVIEW.md.

The `context-hygiene` plugin is included and on: before each model call it
clears tool output that is no longer needed, which matters most with a local
model's smaller context window.

## Requirements

- OpenCode 1.x on Windows (tested with 1.18.34 and 1.19.4).
- Git for Windows. The agents run shell commands through bash and use `grep`,
  `tail` and `git`. OpenCode finds Git Bash through `git` on the PATH; if it
  does not, set the user environment variable `OPENCODE_GIT_BASH_PATH` to
  `C:\Program Files\Git\bin\bash.exe`.
- A model server with an OpenAI-compatible `/v1` API and tool calling.

## Install

Close OpenCode, clone this repository (or unzip the bundle), and in its folder
run:

```powershell
powershell -ExecutionPolicy Bypass -File .\install.ps1 `
  -Provider <provider> -Model <model-id> -BaseUrl https://<model-server>/v1
```

- `-Provider` is the provider id the agents use. If the server needs a key,
  store it with `opencode auth login` under this same id; it then lives in
  `auth.json`.
- `-Model` is the id the server lists under `/v1/models`:
  `(Invoke-RestMethod https://<model-server>/v1/models).data.id` (add
  `-Headers @{Authorization = "Bearer <key>"}` if it needs a key).
- The installer moves the existing `%USERPROFILE%\.config\opencode` aside to a
  timestamped backup and writes the bundle in its place. Sessions and
  credentials are not touched. Anything from the old config you still want,
  such as MCP servers, has to be copied back into the new `opencode.json`.
  A repository's own `opencode.json` or `.opencode` folder still applies on
  top of this config.

To update, `git pull` (or unzip the newer bundle) and run `.\install.ps1` with
no arguments. It keeps the provider, model and URL from the current install. The
installer copies the files, so the clone can live anywhere.

## Use

1. In a git repository, switch to `head-architect` (Tab) and work out the
   plan. It writes PLAN.md when you approve it.
2. Switch to `architect` and ask it to execute PLAN.md, or give it a
   single direct task.

## Keeping data in-house

The config allows only the `work` provider, so no cloud model can be picked by
accident, and session sharing is disabled. Web search is not enabled.
`webfetch` is still allowed for the architect, so it can read documentation by
URL. Remove it from `architect`'s permissions if outbound requests are
not wanted.

OpenCode itself still contacts the internet for its model catalogue, updates
and language-server downloads. To stop that, set these user environment
variables to `1`: `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_DISABLE_AUTOUPDATE`
and `OPENCODE_DISABLE_LSP_DOWNLOAD`. On first start OpenCode may also try to
install `@opencode-ai/plugin` from npm into the config folder. The bundle does
not need it, so a failure there is harmless.

## Context hygiene

The mode is set in `%USERPROFILE%\.config\opencode\context-hygiene.json`:
`on`, `shadow` (only logs what it would clear) or `off`. The file is re-read
on every call, so no restart is needed. The log is
`%USERPROFILE%\.local\share\opencode\context-hygiene.jsonl`. Clearing
finished-task output relies on the architect's `task <ID>:` commit messages.
