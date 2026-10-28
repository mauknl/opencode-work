---
name: plan-md
description: The PLAN.md format used across this setup — phase and task numbering, the required per-task fields, checkbox status conventions, and the rules for advancing and auditing a plan. Load before creating a PLAN.md, before updating task status, and when a plan written by another agent needs to be read or repaired.
license: MIT
compatibility: opencode
metadata:
  audience: architects
---

## What this covers

`PLAN.md` is the shared contract between `head-architect` (which writes it)
and `architect` (which executes it one task at a time). It lives at the
repository root. Every agent that touches it must use the structure below,
because the others parse it by shape.

## Who owns what

- `head-architect` authors the plan. It runs the design conversation with the
  user and writes the initial `PLAN.md`.
- `architect` executes it. It amends the plan when reality diverges from it,
  and checks tasks off as it accepts them. It reaches that acceptance by
  delegating the work, never by implementing it itself.

The workers, `developer` and `reviewer`, never touch `PLAN.md` at all unless
the architect explicitly instructs it.

## Structure

A plan is a sequence of Phases. Each phase groups numbered atomic tasks. Task IDs
are `<phase>.<task>` — `Task 1.1`, `Task 1.2`, `Task 2.1`. IDs are stable: never
renumber a task once work has started, because commits reference the ID.

Each task must be scoped to fit comfortably inside a single developer context
window. A task that cannot be stated in the structure below is too big and should
be split before any delegation happens.

## Required task structure

Every task uses exactly this shape:

```markdown
- [ ] Task <ID>: <Short Title>
  - Files to touch: <Exact file paths to create or modify>
  - Requirements: <Explicit functional specifications and acceptance criteria>
  - Constraints: <What NOT to modify, safety bounds, performance limits>
  - Reference Memory: <Existing functions, types, schemas, or tests to mirror>
```

All four fields are mandatory. Their purpose:

- **Files to touch** names likely paths so a worker starts in the right place. It
  is a pointer, not a prohibition — a worker may read more widely, and may touch
  an unlisted file when the task genuinely requires it.
- **Requirements** must be concrete and testable. "Handle errors properly" is not
  a requirement; "return a 409 with the existing record id when the slug already
  exists" is.
- **Constraints** carry the non-goals: what must not change, compatibility that
  must hold, scope that must not widen.
- **Reference Memory** points at existing code to mirror, which is what keeps
  independently delegated tasks converging on one house style.

## Status conventions

- `- [ ]` — not started, or started and not yet accepted.
- `- [x]` — accepted. Only the architect writes this, and only after its own final
  audit, not merely because a worker reported success or a reviewer approved.

A task is never marked complete by the developer or the reviewer. Workers do
not edit `PLAN.md` at all unless explicitly instructed.

## Executing a plan

1. Select the single next unchecked task. Never combine task IDs, and never
   assign a whole phase in one delegation.
2. Delegate it to the developer, inspect the result, and have the reviewer
   review it.
3. Audit independently before acceptance.
4. Mark `- [x]`, then commit as `task <ID>: <brief summary>`.
5. Move to the next unchecked task.

If reality diverges from the plan — a task turns out to be impossible, already
done, or wrongly specified — amend `PLAN.md` explicitly and say so, rather than
silently completing something different. The architect may amend the plan; it
does not need to hand the change back to `head-architect`. Keep the amendment
visible in the run summary so the divergence is not lost.

## Auditing a plan

When verifying a finished plan, confirm that every `- [x]` task has actual
corresponding implementation on disk. A checked box with no implementation is the
specific failure this format exists to catch, so check the code and the diff
rather than trusting the checkbox.
