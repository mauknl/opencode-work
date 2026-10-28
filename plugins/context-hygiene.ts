import type { Plugin } from "@opencode-ai/plugin"
import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import { parseMode, selectCompletedTaskOutput, selectStaleReads, type Entry, type Mode, type ToolCall } from "../lib/context-hygiene"

// OpenCode v1 adapter for lib/context-hygiene.ts. Before every model call, tool
// outputs that no longer belong in context are sent as OpenCode's "[Old tool
// result content cleared]" placeholder. The tool calls themselves stay visible,
// so the agent can fetch anything again.
//
// - Subagent sessions: reads of files the agent has since edited.
// - Primary sessions (the architects): every tool output from before the last
//   successful `git commit` of a `task <ID>:` message, i.e. from tasks that are
//   finished and recorded in PLAN.md and git. The architect's reasoning from
//   before that commit is left out of the request altogether, because
//   reasoning has no placeholder form. Reasoning in the latest assistant
//   message is always kept: providers that verify reasoning (signed thinking)
//   require it for the tool call in progress.
//
// Mode: CONTEXT_HYGIENE env var (off|shadow|on) overrides the "mode" field of
// ~/.config/opencode/context-hygiene.json; anything else means "off". The file
// is re-read on every call, so switching needs no restart. Shadow mode only logs
// what it would clear, to ~/.local/share/opencode/context-hygiene.jsonl.
//
// Porting to the OpenCode v2 plugin API: keep lib/context-hygiene.ts and replace
// this adapter. v2 (as shipped in @opencode-ai/plugin 1.18.31) has no message
// transform; the aisdk.language hook can wrap the model with AI SDK middleware
// whose transformParams maps the prompt's tool-call/tool-result parts onto
// ToolCall and replaces stale tool-result outputs with the same placeholder.

const CONFIG_FILE = path.join(os.homedir(), ".config", "opencode", "context-hygiene.json")
const LOG_FILE = path.join(
  process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
  "opencode",
  "context-hygiene.jsonl",
)

function currentMode(): Mode {
  const fromEnv = parseMode(process.env.CONTEXT_HYGIENE)
  if (fromEnv) return fromEnv
  try {
    return parseMode(JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")).mode) ?? "off"
  } catch {
    return "off"
  }
}

function log(entry: Record<string, unknown>) {
  try {
    fs.appendFileSync(LOG_FILE, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n")
  } catch {
    // Logging must never break a session.
  }
}

export default (async ({ client, directory }) => {
  const isSubagent = new Map<string, boolean>()
  // Parts already logged per session, so the log records each clearing once
  // rather than on every model call that re-applies it.
  const logged = new Map<string, Set<string>>()

  async function subagentSession(sessionID: string): Promise<boolean> {
    const known = isSubagent.get(sessionID)
    if (known !== undefined) return known
    const res = await client.session.get({ path: { id: sessionID } })
    const answer = Boolean(res.data?.parentID)
    isSubagent.set(sessionID, answer)
    return answer
  }

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        const mode = currentMode()
        if (mode === "off") return
        const messages = output.messages
        const sessionID = messages[0]?.info.sessionID
        if (!sessionID) return
        const subagent = await subagentSession(sessionID)

        const calls: ToolCall[] = []
        const entries: Entry[] = []
        const latestAssistant = [...messages].reverse().find((m) => m.info.role === "assistant")
        for (const message of messages) {
          // A message whose only content is reasoning keeps it, so no assistant
          // message is ever sent empty.
          const hasContent = message.parts.some((part) => part.type === "text" || part.type === "tool")
          for (const part of message.parts) {
            if (part.type === "reasoning" && message !== latestAssistant && hasContent) {
              entries.push({ kind: "reasoning", id: part.id, chars: part.text.length })
            }
            if (part.type !== "tool") continue
            const state = part.state
            calls.push({
              id: part.id,
              tool: part.tool,
              completed: state.status === "completed",
              cleared: state.status === "completed" && state.time.compacted !== undefined,
              input: (state.input ?? {}) as Record<string, unknown>,
              outputChars: state.status === "completed" ? state.output.length : 0,
              exitCode: state.status === "completed" && typeof state.metadata?.exit === "number" ? state.metadata.exit : undefined,
            })
            entries.push(calls[calls.length - 1])
          }
        }

        const rule = subagent ? "stale-read" : "task-done"
        const selection = subagent ? selectStaleReads(calls, directory) : selectCompletedTaskOutput(entries)
        if (selection.ids.length === 0) return

        if (mode === "on") {
          const stale = new Set(selection.ids)
          const now = Date.now()
          // OpenCode keeps using this same array after the hook, so entries are
          // replaced in place. The stored message and part objects are copied,
          // never mutated, so nothing cleared here is persisted.
          messages.forEach((message, i) => {
            if (!message.parts.some((part) => stale.has(part.id))) return
            messages[i] = {
              ...message,
              parts: message.parts
                .filter((part) => !(part.type === "reasoning" && stale.has(part.id)))
                .map((part) =>
                  part.type === "tool" && stale.has(part.id) && part.state.status === "completed"
                    ? { ...part, state: { ...part.state, time: { ...part.state.time, compacted: now } } }
                    : part,
                ),
            }
          })
        }

        const seen = logged.get(sessionID) ?? new Set<string>()
        logged.set(sessionID, seen)
        const fresh = selection.ids.filter((id) => !seen.has(id))
        if (fresh.length === 0) return
        fresh.forEach((id) => seen.add(id))
        const freshChars = entries
          .filter((entry) => fresh.includes(entry.id))
          .reduce((sum, entry) => sum + ("kind" in entry ? entry.chars : entry.outputChars), 0)
        const reasoningParts = entries.filter((entry) => "kind" in entry && fresh.includes(entry.id)).length
        const agent = [...messages].reverse().find((m) => m.info.role === "user")?.info
        log({
          sessionID,
          agent: agent && "agent" in agent ? agent.agent : undefined,
          mode,
          rule,
          partIDs: fresh,
          files: selection.files,
          ...(reasoningParts > 0 && { reasoningParts }),
          estTokens: Math.round(freshChars / 3.6),
        })
      } catch (error) {
        // Fail open: on any error the messages go to the model unchanged.
        log({ error: error instanceof Error ? error.message : String(error) })
      }
    },
  }
}) satisfies Plugin
