export interface VersionPreviewState {
  readonly active: boolean;
  begin(currentContent: string): void;
  contentForRestore(fallback: string): string;
  exit(): string | null;
  completeRestore(): void;
}

export function createVersionPreviewState(): VersionPreviewState {
  let originalContent: string | null = null;
  return {
    get active() {
      return originalContent !== null;
    },
    begin(currentContent) {
      originalContent ??= currentContent;
    },
    contentForRestore(fallback) {
      return originalContent ?? fallback;
    },
    exit() {
      const original = originalContent;
      originalContent = null;
      return original;
    },
    completeRestore() {
      originalContent = null;
    },
  };
}
