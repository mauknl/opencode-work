---
name: plan-md
description: The PLAN.md format used across this setup — phase and task numbering, the required per-task fields, EASY/HARD difficulty classification, checkbox status conventions, and the rules for advancing and auditing a plan. Load before creating a PLAN.md, before updating task status, and when a plan written by another agent needs to be read or repaired.
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
  - Difficulty: <EASY | HARD>
```

All five fields are mandatory. Their purpose:

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
- **Difficulty** records where the task's risk sits. See below.

## Difficulty

`head-architect` classifies every task when it writes the plan. There is one
developer, so every task goes to it and gets the full review whatever its
Difficulty. The field is kept so the plan records where each task's risk sits.
Classify by where the judgment sits and whether a mistake would be caught,
not by how many files a task touches:

- **EASY** — the plan has already made the decisions: what to change, what must
  stay the same and how to check it. A wrong result would fail the task's own
  checks (tests, a diff or equivalence check, a script, a count). The number of
  files does not matter: a mechanical change across ten files is still `EASY`.
  Typical examples: removing code the plan names, applying an approved design or
  mapping, moving code with an equivalence check, comment-only or documentation
  edits verified by unchanged code, replacing a pattern while keeping every
  message, and small additions that mirror existing code.
- **HARD** — any of:
  - the task itself must make a design or judgment call: choosing an approach,
    deciding what is redundant or safe to remove, setting thresholds, writing a
    design note or inventory;
  - a mistake could pass every listed check: concurrency, locking, transactions,
    security or authentication, data or on-disk format changes, data loss,
    performance-sensitive code;
  - new architecture, a new public interface or dependency, or requirements that
    are still unclear.
- **When unsure,** ask: "could a wrong result still pass this task's checks?" If
  yes, mark `HARD`; if no, mark `EASY`.
- **Make tasks EASY where it keeps the plan clear.** A `HARD` task often becomes
  `EASY` by moving its judgment into a separate design task, or by adding a
  mechanical acceptance check, for example "the code is unchanged apart from
  comments" for a documentation task.

A task with no Difficulty field, such as one in an older plan or a direct task,
is treated as HARD.

An executing architect may upgrade a task from EASY to HARD after inspecting the
code, and records that in the plan. It never downgrades HARD to EASY.

## Status conventions

- `- [ ]` — not started, or started and not yet accepted.
- `- [x]` — accepted. Only an architect writes this, and only after its own final
  audit, not merely because a worker reported success or a reviewer approved.

A task is never marked complete by the developer or the reviewer. Workers do
not edit `PLAN.md` at all unless explicitly instructed.

## Executing a plan

1. Select the single next unchecked task. Never combine task IDs, and never
   assign a whole phase in one delegation.
2. Delegate it, inspect the result, and review it per the workflow in force.
3. Audit independently before acceptance.
4. Mark `- [x]`, then commit as `task <ID>: <brief summary>`.
5. Move to the next unchecked task.

If reality diverges from the plan — a task turns out to be impossible, already
done, or wrongly specified — amend `PLAN.md` explicitly and say so, rather than
silently completing something different. An executing architect may amend the
plan; it does not need to hand the change back to `head-architect`. Keep the
amendment visible in the run summary so the divergence is not lost.

## Auditing a plan

When verifying a finished plan, confirm that every `- [x]` task has actual
corresponding implementation on disk. A checked box with no implementation is the
specific failure this format exists to catch, so check the code and the diff
rather than trusting the checkbox.
