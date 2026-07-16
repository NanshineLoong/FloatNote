---
name: organize
description: Use when organizing collected Inbox material or existing notes into structured documents without losing source details.
metadata:
  floatnote-display-name: 梳理材料
  floatnote-short-description: 理清主题和脉络
---

# Organize Material

## Overview

Turn collected material into clearer, theme-based documents. Organize for information coverage rather than aggressive summarization or new writing.

## Workflow

1. Read the complete collection area with `read_note` and `target: { kind: "inbox" }`, plus every note the user names. Base later decisions on the source material, not an early summary.
2. Identify distinct themes. Split themes only when they serve different central questions or purposes and can stand as meaningful documents; keep subtopics of one central question as sections.
3. If several themes exist, list each theme's name, scope, main material, overlaps, and suggested document name, then ask which themes to organize. If the user selects several, finish and save one theme before starting the next.
4. Give a base outline in chat and wait for approval or revisions. Make it a short, ordered list of proposed sections, with at most a brief phrase describing each section. It is a conversational preview, not an intermediate document.
5. Expand the approved outline with concise points showing what each section will contain. For short material, show all sections together. For long or complex material, show one section at a time and wait for approval or revision before continuing.
6. After the expanded outline is approved, compose the full document. In the same turn, first state what will be written and where, then immediately invoke the appropriate write tool. The tool permission is the final confirmation; do not add a separate full-draft approval stage. If the user explicitly asks to skip or combine outline stages, follow that instruction.

## Fidelity Rules

- Preserve every substantive source detail, including names, numbers, dates, examples, evidence, links, qualifications, objections, and uncertainty.
- Reorder, group, and clarify without introducing new facts, positions, or conclusions.
- Merge genuine repetition only when every unique detail remains represented.
- Keep conflicting statements and identify the conflict instead of deciding it for the user.
- Mark unclear or incomplete material as needing confirmation.
- Keep material unrelated to the selected theme out of its document. Briefly report excluded material and, when clear, the theme where it belongs.
- Before writing, check that each substantive source item is represented in the selected document or reported as an exception. This coverage check is internal, not a separate interaction stage.
- Never modify, delete, clear, or mark the original Inbox material. Inbox cleanup is a separate operation requiring its own explanation and confirmation.

## Before Writing

- Produce one document per selected theme.
- Use `create_note` for a new document by default. Use `edit_note` or `write_note` for an existing document only when the user explicitly chooses that destination.
- Include any excluded, conflicting, or unresolved material in the write-intent statement.
- If the user rejects the write or requests changes, revise the outline or content and request permission again; never bypass confirmation.
