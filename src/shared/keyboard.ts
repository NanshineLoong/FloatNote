/**
 * Whether a keyboard event belongs to an active IME composition.
 *
 * `isComposing` is the standard signal. WebKit has historically reported
 * composition keystrokes as keyCode 229, so retain that fallback for native
 * text inputs whose confirmation handlers must not run mid-composition.
 */
export function isImeComposing(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}
