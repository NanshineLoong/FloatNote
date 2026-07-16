---
name: organize
description: Use when organizing collected notes or inbox material into structured documents while preserving the original information.
metadata:
  floatnote-display-name: 整理材料
  floatnote-short-description: 按主题整理采集内容，尽量保留原始信息
---

# Organize Material

Turn collected material into clearer, structured notes without compressing away useful source information.

## Workflow

1. Read all relevant material. Use `read_note` with `target: { kind: "inbox" }` for the collection area, and read any documents named by the user.
2. Identify distinct themes. If the material contains multiple clearly different themes, list them and ask which themes to organize. Create a separate document for each selected theme.
3. For each selected theme, propose a structured framework and wait for the user's review. When several themes are selected, handle them in order.
4. Expand the approved framework into a concise outline that shows the main points and where the source material will go. Ask the user to review it.
5. After approval, write the complete document with `create_note`, `edit_note`, or `write_note` as appropriate.

## Principles

- Preserve names, examples, qualifications, evidence, links, and other original details whenever they remain relevant.
- Reorder, group, and clarify; do not invent facts or silently resolve ambiguities.
- Prefer inclusion over aggressive summarization. Mark uncertain or conflicting source statements instead of deleting them.
- Do not remove or rewrite the original inbox material.
- Before any write tool, briefly state what will be written and where. Respect the user's confirmation decision.
