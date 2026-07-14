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
