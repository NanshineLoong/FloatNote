---
name: plan-actions
description: Use when the user wants to expand their thinking, choose a direction, and turn an unclear goal or note into a concrete action list.
metadata:
  floatnote-display-name: 行动规划
  floatnote-short-description: 从方向探索逐步形成具体、简单的行动清单
---

# Plan Actions

Guide the user from broad possibilities to a concrete, manageable action list through multiple rounds of discussion.

## Workflow

1. Read the relevant inbox material or document and clarify the outcome the user wants.
2. Present a small set of plausible themes or directions for moving forward. Explain their differences briefly and ask the user to choose.
3. Explore the chosen direction. Ask focused questions, surface assumptions, and research only when it materially improves the decision.
4. Narrow the direction into a practical approach, then break it into actions. Each action must be small, clear, and independently understandable.
5. Show the proposed actions and dependencies for review. Revise until the user considers the list usable.
6. First create or update a document that records the reasoning and agreed plan. Then ask whether the user wants the concrete actions added to `_tasks`.
7. Only after approval, append non-duplicate checklist items to `_tasks` with `edit_note` and `target: { kind: "tasks" }`.

Do not erase the source material. Before every write, state what will be written and where, then respect the user's confirmation decision.
