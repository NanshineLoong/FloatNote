import { invoke } from "@tauri-apps/api/core";
import type { SelectionSource } from "./selection-message";

export interface PopupSelectionSnapshot {
  text: string;
  html: string | null;
  source: (SelectionSource & { bundleId?: string | null }) | null;
}

export interface PopupQuestionRequest {
  generationId: number;
  popupRequestId: string;
  question: string;
}

export interface PopupQuestionResult {
  generationId: number;
  popupRequestId: string;
  ok: boolean;
  message?: string;
  sent?: boolean;
}

export function popupSelectionSnapshot(generationId: number): Promise<PopupSelectionSnapshot> {
  return invoke("popup_selection_snapshot", { generationId });
}

export function popupAiSelectionSnapshot(generationId: number): Promise<PopupSelectionSnapshot> {
  return invoke("popup_ai_selection_snapshot", { generationId });
}

export function completePopupQuestion(generationId: number): Promise<void> {
  return invoke("complete_popup_question", { generationId });
}

export function translatePopupSelection(generationId: number, popupRequestId: string): Promise<string> {
  return invoke("translate_popup_selection", { generationId, popupRequestId });
}
