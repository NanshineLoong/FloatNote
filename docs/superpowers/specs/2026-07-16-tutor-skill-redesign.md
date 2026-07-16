# Tutor Skill Redesign

- Date: 2026-07-16
- Status: confirmed design, pending written-spec review
- Scope: `src-tauri/resources/skills/tutor/SKILL.md`

## Goal

Update the built-in `tutor` skill so it helps users genuinely understand chosen
material through adaptive one-question-at-a-time dialogue. Questioning and
interview-style pressure are diagnostic techniques: the purpose is to find and
repair gaps in understanding, not to score the user, complete a fixed question
set, or create pressure for its own sake.

The localized skill metadata becomes:

- Display name: `问到真懂`
- Short description: `在一问一答中发现盲点、理清概念`

## Learning Subjects and Entry

The skill supports four kinds of learning subject:

- the current project's Inbox;
- one or more notes in the current project;
- material supplied directly in the conversation;
- a topic chosen by the user.

FloatNote cannot read arbitrary local files outside the current project. If the
user refers to an inaccessible external document, ask them to paste the relevant
content or place it in the current project rather than acting as if it was read.

When the subject and scope are clear, read the named material and begin. Ask one
brief clarifying question only when the topic is too broad, the source is
ambiguous, or the intended learning goal would materially change the questions.

When source material may be factually wrong, distinguish what the material
claims from whether the claim is true. Use external research only when factual
verification materially affects the core understanding. Identify the supporting
source and any remaining uncertainty rather than treating model memory as the
answer key.

## Learning Loop

Ask one focused question at a time. Choose questions that expose the most
important gap in the user's understanding, with attention to:

- accurate explanation of key concepts;
- relationships, causes, mechanisms, and reasoning chains;
- conditions, limits, and scope of conclusions;
- gaps, ambiguity, contradictions, and unsupported claims in the material;
- transfer to examples, variations, counterexamples, or applications.

After each answer, identify what is sound, then state the specific omission,
error, confusion, or contradiction. Make the next step clear without forcing a
rigid response template or relying on generic encouragement.

If an answer exposes an important unresolved gap, continue on that gap or split
the question into a smaller step. Move to another concept only after the current
gap is repaired or further pursuit has little learning value.

When the user is stuck, increase help gradually:

1. Narrow the question or point out the relevant tension.
2. Give a directional cue.
3. Supply a partial scaffold.
4. Explain directly when the user requests the answer or further hints no longer
   promote useful thinking.

After a direct explanation, check understanding through restatement, an example,
or a small application rather than assuming that exposure equals mastery.

## Challenges, Transitions, and Ending

For definitions, formulas, and verifiable facts, test accuracy, conditions, and
application without inventing controversy. For judgments, causal accounts,
design choices, or value positions, use meaningful counterexamples, boundary
cases, or the strongest relevant opposing view. Address the user's actual claim;
do not use a straw man or argue merely to sound demanding.

Continue while the current gap remains valuable to explore. When a concept is
clear, move to the next important one. When the current learning goal is largely
met, briefly ask whether the user wants to go deeper, change focus, or finish.
Stop when the user asks to stop and do not append another test question.

Keep the default interaction one question and one answer at a time so each next
question can respond to the user's reasoning. Present a batch of questions only
when the user explicitly requests a full mock interview or batch self-test.

## Session Report

At the end, briefly close the learning session and offer to create a learning
diagnostic note. Without the user's agreement, finish in chat and do not invoke
a write tool.

The default report is concise and contains:

- the topic and source material;
- key concepts the user's answers demonstrated they understand;
- remaining unclear, missing, or incorrect points;
- necessary factual corrections and their basis;
- suggested review or self-test questions.

Base the report on evidence from the actual interaction. Do not treat a concept
as mastered merely because it was discussed, reproduce the conversation as a
transcript, or assign a score unless the user asks. When the source material and
external verification disagree, distinguish them explicitly.

After agreement, create a new piece in the current project. Before invoking
`create_note`, state what report will be created and what it will contain. If no
writable project is active, explain the limitation and provide the report in the
conversation instead.

## Skill Shape

Keep the skill self-contained and concise. Its body should use a compact loop
rather than a fixed sequence of rounds, with these sections:

1. `Overview`
2. `Prepare`
3. `Learning Loop`
4. `Challenges and Ending`
5. `Session Report`

The frontmatter description should contain triggering situations rather than a
workflow summary. Keep the stable Skill ID and directory name as `tutor`. No
scripts, references, assets, or additional skill files are needed.

## Validation

Use realistic before-and-after scenarios to verify the revised skill:

1. A broad topic should receive only the clarification needed to establish a
   useful scope; a named note should be read and questioned without setup
   ceremony.
2. A partially correct answer should receive an explicit diagnosis and a
   targeted follow-up on the same core gap rather than an unrelated new question.
3. A stuck user should receive progressively stronger help, with direct
   explanation followed by a check for understanding when hints stop helping.
4. A questionable source claim should be separated from verified fact, with
   research used only when the distinction matters to the core concept.
5. A debatable claim should receive a strong relevant counterargument, while a
   factual definition should not receive manufactured opposition.
6. The default interaction should remain one-question-at-a-time and continue
   according to learning value rather than a fixed round checkpoint.
7. A stop request should end questioning and offer, but not automatically write,
   a report.
8. An agreed report should reflect demonstrated understanding and unresolved
   gaps, avoid default scoring and transcripts, and request permission to create
   a new piece.

Run baseline scenarios against the current skill before editing it, then repeat
the same scenarios against the revision. Validate the skill frontmatter and run
the relevant repository tests after the behavioral checks.
