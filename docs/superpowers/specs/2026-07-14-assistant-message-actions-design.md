# Assistant message actions design

## Goal

Make active generation interruptible from the composer, remove retry from AI
responses, and let a user retry or edit-and-resend an existing user turn
without leaving its position in the conversation.

## Interaction model

### Composer primary action

The composer’s right-side primary icon reflects the current state:

- While an assistant request is streaming, it is a stop icon with the accessible
  name and tooltip `停止生成`. Clicking it cancels the active request through the
  existing `agent_cancel` boundary.
- When no request is streaming, the existing behaviour remains: show send when
  the composer has sendable content, otherwise show the conversation-history
  icon.

Stopping is idempotent at the UI boundary: the active request id is cleared when
the request reaches its terminal event, and repeated clicks must not issue
additional cancellation work for an already-finished request.

### Assistant messages

Every completed text block in an assistant response exposes a copy icon. The
copy action copies the block’s original Markdown source. Assistant responses do
not expose retry controls. A streaming block keeps its copy action unavailable
until it is final, avoiding a partial-response affordance.

### User messages

Each user message exposes two icon actions below its bubble:

- `重试` immediately sends that turn’s text again to the active conversation.
- `编辑` replaces that bubble in place with a same-styled editor seeded with
  the original text. The editor offers `取消` and `发送` beneath it. `取消`
  restores the unchanged display bubble. `发送` replaces the local message
  contents with the edited text and sends that text as the next request.

For both actions, the original message’s references are retained when present.
The edit UI does not reuse or move the global composer; it is a local textarea
within the message node, preserving the main composer’s current draft.

## State and data flow

The chat state keeps stable user-message ids and exposes an explicit local
message-update event so an edited message can be replaced immutably before its
new request is sent. The existing `user` and `pending` events continue to add
the visible request turn and placeholder assistant response.

`assistant.ts` owns request initiation. It will route user-bubble retry and
edit-send events through one shared resend function that updates the title when
needed, dispatches the user/pending state events, sends the prompt, and records
the returned request id. The user-bubble controls are disabled whenever any
assistant response is streaming, which prevents overlapping requests and
ambiguous retries.

The message renderer emits explicit custom events for retry, edit start, edit
cancel, and edit send. It owns only temporary DOM editing state; it does not
send requests directly. Incremental reconciliation preserves non-edited bubbles
and re-renders the edited message node when its message text changes.

## Error handling

If sending a retry or edited message fails before a request id is returned, the
local edited text remains visible and the temporary editor stays open so the
user can correct or retry it. The existing toast/error mechanism reports the
failure. Cancellation relies on the existing backend lifecycle and does not
create a synthetic error bubble.

## Tests

- Reducer tests cover replacing an existing user message by id without changing
  its references or unrelated messages.
- Renderer tests cover completed assistant copy-only actions, user retry/edit
  controls, and cancel restoring the user bubble.
- Assistant integration tests cover streaming primary-action mode, cancellation,
  user-message retry, and edited resend payloads.

## Scope

This change is frontend-only. It neither changes the Tauri command contracts nor
the persisted chat-history format, and therefore requires no architecture or
cross-platform documentation update.
