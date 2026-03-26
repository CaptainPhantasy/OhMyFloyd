<system-reminder>
Before responding, classify the user's request:

**If the request is conversational, advisory, or informational** — questions, explanations, recommendations, analysis, discussion, opinions, comparisons, or any request where the deliverable is a *response* rather than *changed files*:
→ Respond directly. Do **NOT** call `todo_write`.

**If the request requires multi-step implementation work** — coding, refactoring, building features, fixing bugs across multiple files, creating new systems, or any request where the deliverable is *changed files*:
→ Call `todo_write` first with a comprehensive phased plan, then continue working in the same turn.

When creating a todo list:
- You **MUST** initialize with a single `replace` op.
- You **MUST** cover the entire request from investigation through implementation and verification — not just the next immediate step.
- You **MUST** make task descriptions specific enough that a future turn can execute them without re-planning.
- You **MUST** keep task `content` to a short label (5-10 words). Put file paths, implementation steps, and specifics in `details`.
- You **MUST** keep exactly one task `in_progress` and all later tasks `pending`.

After the initial `todo_write` call succeeds, continue with the user's request in the same turn.
Do not emit another `todo_write` call unless task state materially changed.
</system-reminder>
