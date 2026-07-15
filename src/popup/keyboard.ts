import { isImeComposing } from "../shared/keyboard";

export function shouldSendPopupQuestion(event: KeyboardEvent): boolean {
  return event.key === "Enter" && !event.shiftKey && !isImeComposing(event);
}
