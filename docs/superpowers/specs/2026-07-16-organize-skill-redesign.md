# Organize Skill Redesign

- Date: 2026-07-16
- Status: confirmed design, pending written-spec review
- Scope: `src-tauri/resources/skills/organize/SKILL.md`

## Goal

Update the built-in `organize` skill so it helps users turn collected material
into clearer, theme-based documents without over-summarizing or silently
discarding source information. The workflow stays conversational: intermediate
outlines appear only in chat, and the final organized note is the sole persisted
artifact.

The localized skill metadata becomes:

- Display name: `梳理材料`
- Short description: `理清主题和脉络`

## Core Principle

Optimize for information coverage rather than verbatim copying. The agent may
reorder material, clarify wording, and merge genuine repetition, but must retain
all substantive information and every unique detail.

## Interaction Workflow

1. Read the complete Inbox and any other notes explicitly named by the user.
   Base all later decisions on the source material rather than an early summary.
2. Identify themes. Treat material as separate themes only when it serves a
   different central question or purpose and can stand as a meaningful document.
   Keep subtopics of one central question as sections of one document.
3. If several independent themes exist, list each theme's name, scope, main
   material, overlaps, and suggested document name, then ask which themes to
   organize. If the user selects several, finish and save one before starting
   the next.
4. Give a simple base outline in chat and wait for approval or revisions. The
   outline only needs to let the user judge the proposed structure; it is not a
   formal intermediate document and needs no required title, objective, or
   source-mapping fields.
5. Expand the approved outline with concise points showing what each part will
   contain. Short outlines may be expanded at once. For long or complex material,
   expand one section at a time and wait for approval or revision before moving
   on, following the incremental presentation style of `brainstorming`.
6. After the complete expanded outline is approved, compose the full organized
   content and directly invoke the appropriate write tool. The tool's permission
   surface is the final confirmation; do not add a separate full-draft approval
   stage. If the user explicitly asks to skip or combine outline stages, follow
   that instruction.

## Fidelity Rules

- Preserve all substantive information, including names, numbers, dates,
  examples, evidence, links, qualifications, objections, and uncertainty.
- Reorder, group, and clarify without introducing new facts, positions, or
  conclusions.
- Merge true duplicates only when every unique detail remains represented.
- Preserve conflicting statements and identify the conflict instead of choosing
  a side for the user.
- Mark unclear or incomplete material as needing confirmation.
- Keep material unrelated to the selected theme out of its document. Before
  writing, briefly report any excluded, conflicting, or unresolved material and,
  where possible, indicate the theme it belongs to.
- Perform an internal source-coverage check before writing. This is a quality
  requirement, not a separate interaction stage.

## Write Boundaries

- Produce one document per selected theme.
- Create a new piece by default. Edit or replace an existing piece only when the
  user explicitly requests that destination.
- Briefly state the destination and any coverage exceptions, then invoke
  `create_note`, `edit_note`, or `write_note` as appropriate.
- Never modify, delete, clear, or mark the original Inbox material. Any later
  Inbox cleanup is a separate operation requiring its own explanation and
  confirmation.
- If the user rejects a write or requests changes, revise the outline or content
  and request write permission again; never bypass the confirmation.

## Skill Shape

Keep the skill self-contained and concise, with four body sections:

1. `Overview`
2. `Workflow`
3. `Fidelity Rules`
4. `Before Writing`

The frontmatter description should describe the triggering situation rather
than summarize the workflow. No scripts, references, assets, or extra skill
files are needed.

## Validation

Use the same realistic scenarios before and after the edit:

1. Mixed independent themes must trigger theme selection rather than automatic
   organization of everything.
2. A single theme must receive a base outline and a wait point before expansion.
3. A long multi-section theme must support section-by-section expansion and
   review.
4. An explicit request to organize directly must be allowed to skip intermediate
   gates.
5. Repetition, conflicts, numbers, links, qualifications, and unresolved items
   must survive organization correctly.
6. Multiple selected themes must be completed and saved sequentially.
7. The final step must directly request document-write permission while leaving
   the Inbox unchanged.

Run baseline scenarios against the current skill before editing it, then repeat
the scenarios against the revised skill. Validate the skill frontmatter and run
the relevant repository tests after the behavioral checks.
