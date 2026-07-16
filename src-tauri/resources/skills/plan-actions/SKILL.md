---
name: plan-actions
description: Use when the user needs to clarify an uncertain direction or decide a small set of near-term actions for a goal.
metadata:
  floatnote-display-name: 下一步
  floatnote-short-description: 理清方向，定下眼前真正能做的事
---

# Plan Actions

## Overview

Clarify the direction that matters now and form a small batch of executable actions. Adapt the discussion to the uncertainty; do not create a complete project backlog.

## Start With Context

1. Read `_tasks` with `read_note` and `target: { kind: "tasks" }` for current work and duplicates.
2. Read an Inbox, prior plan, or piece only when the user names it; do not guess or scan every note.
3. State this session's observable result and main uncertainty. If the subject is unclear, ask one focused question.

## Adaptive Workflow

1. If direction is unclear, present 2–4 materially different options with each option's main benefit, cost, and fit. Ask the user to choose, combine, or refine them.
2. If direction is already chosen, reflect it and its key assumptions without reopening broad exploration.
3. Ask one decision-changing question at a time.
4. When current external facts could change the choice or actions, form a specific research question and research it directly. Stop when evidence supports the present decision. Keep source URLs; separate facts, inference, and uncertainty. Leave preferences, values, and risk tolerance to the user.
5. Move to actions once the result and direction are clear and each major unknown is resolved or becomes a verification action.

Return to an earlier step when a key assumption fails. A request for “the next step” may compress discussion, but never authorizes a materially different commitment.

## Action Contract

Propose one ordered batch:

- Aim for 3–7 actions; use 1–2 when sufficient and never add filler.
- Give each one result, an explicit verb, needed context, and an observable completion condition.
- Fit each action into one focused work session under the user's constraints.
- Turn “research,” “handle,” or “improve” into a concrete output.
- A short dependency chain is valid when its prerequisite is earlier in the same batch and the next action can start as soon as that prerequisite finishes. Exclude actions gated by an extended waiting period or a later planning cycle.
- Create only the current batch.

Show the complete plan and batch in chat; wait for revision or confirmation before writing.

## Plan Document and Tasks

After confirmation, create an independently named piece with `create_note`. Use `edit_note` or `write_note` only when the user selects an existing piece. On a name collision, ask for another name or explicit permission to update the existing piece.

Use this minimal document shape:

```markdown
# <Goal> Action Plan

## Outcome
<Observable result>

## Current Direction
<Approach and up to two reasons>

## Key Milestones
<Only when needed>

## Near-term Actions
<Confirmed ordered actions>

## Decision Basis
<Only reusable conclusions and source URLs>
```

Require Outcome, Current Direction, and Near-term Actions. Include Key Milestones only for a multi-stage path and Decision Basis only when useful later. Use an ordered list; `_tasks` is the only checklist and status source. After a successful plan write, ask whether to append the actions to `_tasks`.

If the user explicitly skips the plan document, write confirmed actions directly to `_tasks`. Re-read it and remove semantic duplicates. For a non-empty file, call `edit_note` with `target: { kind: "tasks" }`, its exact current text as `old_string`, and that text plus confirmed checkboxes as `new_string`; use `write_note` only to initialize an empty `_tasks`. Preserve existing text and order.

## Research and Boundaries

- Before each write, state what and where. Report rejection or failure; never bypass it.
- Keep source material unchanged; cleanup is a separate request.
- If research is unavailable or conflicting, state the limit and make indispensable verification an action.
- End by reporting saved content and added tasks. Do not track or generate another batch until the skill is explicitly invoked again.
