// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mountInputOverlay } from "./overlay";

class ResizeObserverStub {
  static instances: ResizeObserverStub[] = [];
  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  private readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    ResizeObserverStub.instances.push(this);
  }

  notify(): void {
    this.callback([], this as unknown as ResizeObserver);
  }
}

describe("input overlay", () => {
  let dock: HTMLElement;
  let before: HTMLElement;
  let host: HTMLElement;
  let after: HTMLElement;
  let view: { requestMeasure: () => void; focus: () => void };
  let collapsed: boolean;
  let overlay: ReturnType<typeof mountInputOverlay>;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    ResizeObserverStub.instances = [];
    dock = document.createElement("div");
    dock.className = "assistant-dock";
    before = document.createElement("div");
    host = document.createElement("div");
    host.className = "assistant-input-wrap";
    after = document.createElement("div");
    dock.append(before, host, after);
    document.body.appendChild(dock);
    view = { requestMeasure: vi.fn(), focus: vi.fn() };
    collapsed = false;
    overlay = mountInputOverlay({
      host,
      getDockHost: () => dock,
      getView: () => view,
      onCollapse: () => (collapsed = true),
    });
  });

  afterEach(() => {
    overlay.destroy();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it("creates a body-level modal layer and moves the same host into its paper", () => {
    overlay.expand();

    const layer = document.querySelector<HTMLElement>(".fn-input-overlay")!;
    const paper = layer.querySelector<HTMLElement>(".fn-input-paper")!;
    expect(layer.parentElement).toBe(document.body);
    expect(layer.getAttribute("role")).toBe("dialog");
    expect(layer.getAttribute("aria-modal")).toBe("true");
    expect(layer.getAttribute("aria-label")).toBe("AI 助手输入");
    expect(layer.hidden).toBe(false);
    expect(paper.firstElementChild).toBe(host);
    expect(host.classList.contains("fn-input-large")).toBe(true);
    expect(dock.hasAttribute("inert")).toBe(true);
  });

  it("collapse restores the host to its exact sibling position and interactive state", () => {
    overlay.expand();
    overlay.collapse();

    expect([...dock.children]).toEqual([before, host, after]);
    expect(host.classList.contains("fn-input-large")).toBe(false);
    expect(document.querySelector<HTMLElement>(".fn-input-overlay")!.hidden).toBe(true);
    expect(dock.hasAttribute("inert")).toBe(false);
    expect(collapsed).toBe(true);
    expect(overlay.isLarge()).toBe(false);
  });

  it("falls back to the current dock when the original parent disappears", () => {
    overlay.expand();
    const replacementDock = document.createElement("div");
    document.body.appendChild(replacementDock);
    dock.remove();
    dock = replacementDock;

    overlay.collapse();

    expect(host.parentElement).toBe(replacementDock);
  });

  it("does not collapse when the backdrop is clicked", () => {
    overlay.expand();
    document.querySelector<HTMLElement>(".fn-input-overlay-backdrop")!
      .dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));

    expect(overlay.isLarge()).toBe(true);
    expect(collapsed).toBe(false);
  });

  it("keeps the caret candidate popover interactive above the modal layer", () => {
    const popover = document.createElement("div");
    popover.className = "fn-ref-popover";
    document.body.appendChild(popover);

    overlay.expand();

    expect(popover.hasAttribute("inert")).toBe(false);
  });

  it("collapses on Escape when the event was not consumed by the editor", () => {
    overlay.expand();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    expect(overlay.isLarge()).toBe(false);
    expect(collapsed).toBe(true);
  });

  it("leaves the paper open when an inner popover consumes Escape", () => {
    overlay.expand();
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    host.addEventListener("keydown", (innerEvent) => innerEvent.preventDefault(), { once: true });
    host.dispatchEvent(event);

    expect(overlay.isLarge()).toBe(true);
  });

  it("requests editor measurement after expand, resize, and collapse", async () => {
    overlay.expand();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(view.requestMeasure).toHaveBeenCalledTimes(1);
    expect(view.focus).toHaveBeenCalledTimes(1);

    ResizeObserverStub.instances[0].notify();
    expect(view.requestMeasure).toHaveBeenCalledTimes(2);

    overlay.collapse();
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(view.requestMeasure).toHaveBeenCalledTimes(3);
    expect(view.focus).toHaveBeenCalledTimes(2);
  });

  it("destroy restores the host, disconnects observation, and removes the layer", () => {
    overlay.expand();
    overlay.destroy();

    expect([...dock.children]).toEqual([before, host, after]);
    expect(host.classList.contains("fn-input-large")).toBe(false);
    expect(document.querySelector(".fn-input-overlay")).toBeNull();
    expect(ResizeObserverStub.instances[0].disconnect).toHaveBeenCalledOnce();
  });
});
