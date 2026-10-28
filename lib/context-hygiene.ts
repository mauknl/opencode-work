import * as path from "node:path"

// Context hygiene: find tool outputs that no longer belong in the model's
// context, so an adapter can send a placeholder in their place.
//
// This module is deliberately independent of OpenCode's message types. Each
// OpenCode plugin API version gets a thin adapter that maps its own shapes onto
// ToolCall and applies the result, so moving to the OpenCode v2 plugin API only
// means writing a new adapter. See plugins/context-hygiene.ts.
//
// Two rules, each for the sessions where it applies:
//
// - selectStaleReads (subagents): a read is cleared once a completed edit of the
//   same file follows it. Measured on this machine's subagent sessions, that
//   removes ~16% of subagent input tokens. Lossless variants (clearing only
//   reads a later read fully covers) saved under 1%.
// - selectCompletedTaskOutput (architects): once the architect commits an
//   accepted task as `task <ID>: ...` (the plan-md convention), every tool
//   output and every block of the architect's own reasoning from before that
//   commit is cleared. The state now lives in PLAN.md and git, and the
//   architect's messages and tool calls stay visible. The commit's own output
//   stays: it is the only place the architect sees the new commit's hash, and
//   without it the architect invents one when it reports the commit. Simulated on 42 architect
//   sessions, the tool outputs were ~44% of architect input tokens; on the
//   longest runs since, reasoning from finished tasks was 51-60% of what was
//   left after that.
//
// Background: jev-research.md §21 and PLAN.md.

export type Mode = "off" | "shadow" | "on"

export const MODES: readonly Mode[] = ["off", "shadow", "on"]

/** One tool call in conversation order, as an adapter sees it. */
export type ToolCall = {
  /** Adapter-defined identifier used to apply the clearing afterwards. */
  id: string
  tool: string
  completed: boolean
  /** Already cleared by OpenCode or by an earlier pass. */
  cleared: boolean
  input: Record<string, unknown>
  /** Length of the output in characters, for the token estimate. */
  outputChars: number
  /** Exit code of a shell command, when the adapter knows it. */
  exitCode?: number
}

/** A block of the model's own reasoning, in conversation order among the tool calls. */
export type Reasoning = {
  kind: "reasoning"
  id: string
  /** Length of the reasoning text in characters, for the token estimate. */
  chars: number
}

export type Entry = ToolCall | Reasoning

const isReasoning = (entry: Entry): entry is Reasoning => "kind" in entry && entry.kind === "reasoning"

export type Selection = {
  ids: string[]
  files: string[]
  estTokens: number
}

const READ_TOOLS = new Set(["read"])
const EDIT_TOOLS = new Set(["edit", "write", "apply_patch", "multiedit"])

// Characters per token, the same estimate the measurements used.
const CHARS_PER_TOKEN = 3.6

// apply_patch names its files inside the patch text rather than in an argument.
const PATCH_FILE_LINE = /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)$/gm

export function parseMode(value: unknown): Mode | undefined {
  return typeof value === "string" && (MODES as readonly string[]).includes(value) ? (value as Mode) : undefined
}

export function filesTouched(call: ToolCall, worktree: string): string[] {
  const resolve = (p: string) => path.resolve(worktree, p.trim())
  if (call.tool === "apply_patch") {
    const text = call.input.patchText
    if (typeof text !== "string") return []
    return [...text.matchAll(PATCH_FILE_LINE)].map((m) => resolve(m[1]))
  }
  const file = call.input.filePath
  return typeof file === "string" && file.trim() !== "" ? [resolve(file)] : []
}

/**
 * Reads that a later completed edit of the same file has made stale.
 * `calls` must be in conversation order.
 */
export function selectStaleReads(calls: ToolCall[], worktree: string): Selection {
  // Last position at which each file was edited.
  const lastEdit = new Map<string, number>()
  calls.forEach((call, index) => {
    if (!call.completed || !EDIT_TOOLS.has(call.tool)) return
    for (const file of filesTouched(call, worktree)) lastEdit.set(file, index)
  })

  const ids: string[] = []
  const files = new Set<string>()
  let chars = 0
  calls.forEach((call, index) => {
    if (!call.completed || call.cleared || !READ_TOOLS.has(call.tool)) return
    const [file] = filesTouched(call, worktree)
    if (file === undefined) return
    const editedAt = lastEdit.get(file)
    if (editedAt === undefined || editedAt < index) return
    ids.push(call.id)
    files.add(file)
    chars += call.outputChars
  })
  return { ids, files: [...files], estTokens: Math.round(chars / CHARS_PER_TOKEN) }
}

// `git ... commit ... task 11.7b: ...`, including -m, -F with a heredoc, and
// chained commands. The ID format follows the plan-md skill.
const TASK_COMMIT = /\bgit\b[\s\S]*?\bcommit\b[\s\S]*?\btask\s+\d+(?:\.\d+)*[a-z]?\s*:/i

// Skill output carries standing instructions (for example the plan-md format)
// that stay relevant across tasks. OpenCode's own pruner protects it as well.
const PROTECTED_TOOLS = new Set(["skill"])

export function isTaskCommit(call: Entry): boolean {
  if (isReasoning(call) || call.tool !== "bash" || !call.completed || call.exitCode !== 0) return false
  const command = call.input.command
  return typeof command === "string" && TASK_COMMIT.test(command)
}

/**
 * Tool outputs and reasoning made obsolete by a completed task: everything
 * before the last successful `task <ID>:` commit. The commit itself is kept.
 * `entries` must be in conversation order.
 */
export function selectCompletedTaskOutput(entries: Entry[]): Selection {
  let boundary = -1
  entries.forEach((entry, index) => {
    if (isTaskCommit(entry)) boundary = index
  })
  const ids: string[] = []
  let chars = 0
  for (const call of entries.slice(0, Math.max(boundary, 0))) {
    if (isReasoning(call)) {
      ids.push(call.id)
      chars += call.chars
      continue
    }
    if (!call.completed || call.cleared || PROTECTED_TOOLS.has(call.tool)) continue
    ids.push(call.id)
    chars += call.outputChars
  }
  return { ids, files: [], estTokens: Math.round(chars / CHARS_PER_TOKEN) }
}
