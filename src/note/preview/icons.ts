import { invoke } from "@tauri-apps/api/core";
import { StateEffect } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

// ── App-icon cache ─────────────────────────────────────────────────────────
// `app_icon(bundleId)` is a Tauri command returning a `data:image/png;base64,…`
// string (or null). QuoteCardWidget.toDOM is synchronous, so on a cache miss we
// kick off the fetch and dispatch IconReadyEffect when it resolves; the plugin
// rebuilds and the widget re-paints with the cached data-URI on its next toDOM.
// One process-wide cache keyed by bundle id; icons are stable per installed app.
const iconCache = new Map<string, string | null>();
const iconFailureAt = new Map<string, number>();
const iconPending = new Set<string>();
const iconRetryTimers = new Map<string, number>();
let iconView: EditorView | null = null;
const ICON_RETRY_MS = 30_000;

export function shouldRetryMissingIcon(
  failedAt: number | undefined,
  now: number,
  retryMs = ICON_RETRY_MS,
): boolean {
  return failedAt === undefined || now - failedAt >= retryMs;
}

export function iconCacheStateKey(
  hasCacheEntry: boolean,
  cached: string | null | undefined,
  failedAt: number | undefined,
): string {
  if (cached) return "ready";
  if (hasCacheEntry) return `missing:${failedAt ?? 0}`;
  return "empty";
}

/** Decorator state key for a quote-card's app icon (`"none"` when no bundleId).
 *  Encapsulates the cache lookups so `iconCache`/`iconFailureAt` stay private. */
export function iconStateKeyFor(bundleId: string | null | undefined): string {
  if (!bundleId) return "none";
  const cached = iconCache.get(bundleId);
  return iconCacheStateKey(cached !== undefined, cached, iconFailureAt.get(bundleId));
}

function dispatchIconReady(): void {
  const v = iconView;
  if (v) queueMicrotask(() => v.dispatch({ effects: IconReadyEffect.of(0) }));
}

function scheduleIconRetry(bundleId: string): void {
  if (iconRetryTimers.has(bundleId)) return;
  const timer = window.setTimeout(() => {
    iconRetryTimers.delete(bundleId);
    if (iconCache.get(bundleId) === null) {
      iconCache.delete(bundleId);
      iconFailureAt.delete(bundleId);
      dispatchIconReady();
    }
  }, ICON_RETRY_MS);
  iconRetryTimers.set(bundleId, timer);
}

/** Emitted to self when an icon fetch resolves so the plugin rebuilds. */
export const IconReadyEffect = StateEffect.define<number>();

/** Return the cached icon data-URI for `bundleId`, or null if not yet available
 *  (a fetch is started on a miss). `view` is remembered for the async callback. */
export function ensureIcon(view: EditorView, bundleId: string): string | null {
  iconView = view;
  if (iconCache.has(bundleId)) {
    const cached = iconCache.get(bundleId) ?? null;
    if (cached) return cached;
    if (!shouldRetryMissingIcon(iconFailureAt.get(bundleId), Date.now())) {
      return null;
    }
    iconCache.delete(bundleId);
    iconFailureAt.delete(bundleId);
  }
  if (iconPending.has(bundleId)) return null;
  iconPending.add(bundleId);
  void invoke<string | null>("app_icon", { bundleId })
    .then((dataUri) => {
      iconCache.set(bundleId, dataUri ?? null);
      if (dataUri) {
        iconFailureAt.delete(bundleId);
      } else {
        iconFailureAt.set(bundleId, Date.now());
        scheduleIconRetry(bundleId);
      }
    })
    .catch(() => {
      iconCache.set(bundleId, null);
      iconFailureAt.set(bundleId, Date.now());
      scheduleIconRetry(bundleId);
    })
    .finally(() => {
      iconPending.delete(bundleId);
      // Defer: toDOM runs mid-decoration-build; dispatching synchronously could
      // re-enter the plugin. A microtask lets the current build finish first.
      dispatchIconReady();
    });
  return null;
}
