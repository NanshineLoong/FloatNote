// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mountSkillPicker, renderSkillList, type SkillSummary } from "./skill-picker.js";

const SKILLS: SkillSummary[] = [
  { name: "socratic-review", description: "逐点苏格拉底式追问" },
  { name: "inbox-to-actions", description: "提炼行动项写入 _tasks" },
  { name: "structure-piece", description: "组织 piece 结构" },
];

function setup(skills: SkillSummary[] = SKILLS) {
  document.body.innerHTML = "";
  const inputWrap = document.createElement("div");
  inputWrap.className = "assistant-input-wrap";
  const input = document.createElement("textarea");
  input.className = "assistant-input";
  const bot = document.createElement("button");
  bot.className = "assistant-bot";
  inputWrap.appendChild(input);
  document.body.appendChild(inputWrap);
  document.body.appendChild(bot);
  const listSkills = vi.fn(async () => skills);
  const openInput = vi.fn();
  const picker = mountSkillPicker({ bot, input, inputWrap, listSkills, openInput });
  return { bot, input, inputWrap, listSkills, openInput, picker };
}

describe("renderSkillList", () => {
  it("lists all skills with name + description when query is empty", () => {
    const el = renderSkillList(SKILLS, "");
    expect(el.querySelectorAll(".assistant-skill-item")).toHaveLength(3);
    expect(el.querySelector(".assistant-skill-name")?.textContent).toBe("socratic-review");
    expect(el.querySelector(".assistant-skill-desc")?.textContent).toContain("苏格拉底");
  });

  it("filters by name substring (case-insensitive)", () => {
    const el = renderSkillList(SKILLS, "INBOX");
    const items = el.querySelectorAll(".assistant-skill-item");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("data-skill-name")).toBe("inbox-to-actions");
  });

  it("filters by description substring", () => {
    const el = renderSkillList(SKILLS, "结构");
    expect(el.querySelectorAll(".assistant-skill-item")).toHaveLength(1);
    expect(el.querySelector(".assistant-skill-item")?.getAttribute("data-skill-name")).toBe("structure-piece");
  });

  it("shows empty state when nothing matches", () => {
    const el = renderSkillList(SKILLS, "zzz");
    expect(el.querySelectorAll(".assistant-skill-item")).toHaveLength(0);
    expect(el.querySelector(".assistant-skill-empty")?.textContent).toContain("没有匹配");
  });
});

describe("mountSkillPicker right-click menu", () => {
  it("opens a skill menu on contextmenu and inserts /skill:<name> on click", async () => {
    const { bot, input, openInput, picker } = setup();
    bot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    // listSkills is async; let it resolve
    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-skill-menu")).not.toBeNull();
    });

    const item = document.querySelector<HTMLButtonElement>('.assistant-skill-item[data-skill-name="socratic-review"]')!;
    item.click();

    expect(input.value).toBe("/skill:socratic-review ");
    expect(picker.isOpen()).toBe(false);
    // 收起态选中技能后立即展开输入框
    expect(openInput).toHaveBeenCalled();
    picker.destroy();
  });

  it("does not open a menu when there are no skills", async () => {
    const { bot } = setup([]);
    bot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 10, clientY: 10 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".assistant-skill-menu")).toBeNull();
  });
});

describe("mountSkillPicker / autocomplete", () => {
  it("opens dropdown on leading / and filters while typing", async () => {
    const { input, picker } = setup();
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-skill-dropdown")?.hasAttribute("hidden")).toBe(false);
    });
    expect(document.querySelectorAll(".assistant-skill-item")).toHaveLength(3);

    input.value = "/str";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".assistant-skill-item")).toHaveLength(1);
    });
    picker.destroy();
  });

  it("inserts /skill:<name> on item click and closes", async () => {
    const { input, picker } = setup();
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".assistant-skill-item").length).toBeGreaterThan(0);
    });
    const item = document.querySelector<HTMLButtonElement>('.assistant-skill-item[data-skill-name="inbox-to-actions"]')!;
    item.click();
    expect(input.value).toBe("/skill:inbox-to-actions ");
    expect(picker.isOpen()).toBe(false);
    picker.destroy();
  });

  it("closes dropdown when value no longer starts with /", async () => {
    const { input, picker } = setup();
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-skill-dropdown")?.hasAttribute("hidden")).toBe(false);
    });
    input.value = "hello";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-skill-dropdown")?.hasAttribute("hidden")).toBe(true);
    });
    picker.destroy();
  });
});

describe("mountSkillPicker outside click + destroy", () => {
  it("closes the dropdown on outside pointerdown", async () => {
    const { input, picker } = setup();
    input.value = "/";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await vi.waitFor(() => {
      expect(document.querySelector(".assistant-skill-dropdown")?.hasAttribute("hidden")).toBe(false);
    });
    // click somewhere outside input + dropdown
    const elsewhere = document.createElement("div");
    document.body.appendChild(elsewhere);
    elsewhere.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(document.querySelector(".assistant-skill-dropdown")?.hasAttribute("hidden")).toBe(true);
    picker.destroy();
  });

  it("destroy removes the contextmenu listener", async () => {
    const { bot, picker } = setup();
    picker.destroy();
    bot.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 5 }));
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".assistant-skill-menu")).toBeNull();
  });
});
