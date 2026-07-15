import assert from "node:assert/strict";

interface InputChrome {
  backgroundColor: string;
  borderRadius: string;
  borderStyle: string;
  boxShadow: string;
  height: number;
  opacity: string;
  width: number;
}

async function inputChrome(): Promise<InputChrome> {
  return browser.execute(() => {
    const editor = document.querySelector<HTMLElement>(".fn-assistant-input");
    if (!editor) throw new Error("assistant editor is missing");
    const style = getComputedStyle(editor);
    const rect = editor.getBoundingClientRect();
    return {
      backgroundColor: style.backgroundColor,
      borderRadius: style.borderRadius,
      borderStyle: style.borderTopStyle,
      boxShadow: style.boxShadow,
      height: rect.height,
      opacity: style.opacity,
      width: rect.width,
    };
  });
}

function assertVisibleChrome(chrome: InputChrome) {
  assert.equal(chrome.borderStyle, "solid");
  assert.equal(chrome.borderRadius, "18px");
  assert.notEqual(chrome.backgroundColor, "rgba(0, 0, 0, 0)");
  assert.equal(chrome.opacity, "1");
  assert.ok(chrome.width >= 180, `input width is only ${chrome.width}px`);
  assert.ok(chrome.height >= 36, `input height is only ${chrome.height}px`);
}

describe("assistant input browser review", () => {
  before(async () => {
    const stage = await $("#review-stage");
    await stage.waitForExist();
  });

  it("keeps rounded chrome across focus, blur, close and reopen", async () => {
    const bot = await $(".assistant-bot");
    const wrap = await $(".assistant-input-wrap");
    const editor = await $(".fn-assistant-input");
    const content = await $(".fn-assistant-input .cm-content");

    await bot.click();
    await browser.waitUntil(() => wrap.getAttribute("class").then((value) => value.includes("open")));
    assertVisibleChrome(await inputChrome());

    await content.click();
    await browser.waitUntil(() => editor.getAttribute("class").then((value) => value.includes("cm-focused")));
    const focused = await inputChrome();
    assertVisibleChrome(focused);
    assert.notEqual(focused.boxShadow, "none");

    await $("#review-stage").click({ x: 4, y: 4 });
    await browser.waitUntil(() => editor.getAttribute("class").then((value) => !value.includes("cm-focused")));
    assertVisibleChrome(await inputChrome());

    await bot.click();
    await browser.waitUntil(() => wrap.getAttribute("class").then((value) => !value.includes("open")));
    await bot.click();
    await browser.waitUntil(() => wrap.getAttribute("class").then((value) => value.includes("open")));
    assertVisibleChrome(await inputChrome());
  });
});

describe("permission review responsiveness", () => {
  it("uses unified rows in a narrow paper and two columns in a wide paper", async () => {
    await browser.setWindowSize(620, 600);
    await browser.execute(() => {
      const open = (window as typeof window & { openPermissionReview?: () => void }).openPermissionReview;
      if (!open) throw new Error("permission review fixture is missing");
      open();
    });
    await $(".perm-dialog:not([hidden])").waitForDisplayed();

    const narrow = await browser.execute(() => {
      const dialog = document.querySelector<HTMLElement>(".perm-dialog:not([hidden])")!;
      const unified = dialog.querySelector<HTMLElement>(".perm-diff-unified")!;
      const wide = dialog.querySelector<HTMLElement>(".perm-diff-wide")!;
      const scroll = dialog.querySelector<HTMLElement>(".perm-diff-scroll")!;
      return {
        unified: getComputedStyle(unified).display,
        wide: getComputedStyle(wide).display,
        fits: scroll.scrollWidth <= scroll.clientWidth + 1,
      };
    });
    assert.deepEqual(narrow, { unified: "block", wide: "none", fits: true });

    await browser.setWindowSize(900, 600);
    await browser.waitUntil(async () => {
      const displays = await browser.execute(() => {
        const dialog = document.querySelector<HTMLElement>(".perm-dialog:not([hidden])")!;
        return {
          unified: getComputedStyle(dialog.querySelector<HTMLElement>(".perm-diff-unified")!).display,
          wide: getComputedStyle(dialog.querySelector<HTMLElement>(".perm-diff-wide")!).display,
        };
      });
      return displays.unified === "none" && displays.wide === "grid";
    });
  });
});
