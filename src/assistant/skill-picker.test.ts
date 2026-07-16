// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { mountSkillPicker, renderSkillList, type SkillSummary } from "./skill-picker.js";

const SKILLS: SkillSummary[] = [
  { name: "organize", description: "Organize source material.", displayName: "整理材料", displayDescription: "按主题整理采集内容" },
  { name: "tutor", description: "Question the user.", displayName: "拷问学习", displayDescription: "追问并指出理解缺口" },
  { name: "plan-actions", description: "Create an action plan.", displayName: "行动规划", displayDescription: "逐步形成行动清单" },
  { name: "write", description: "Develop an article.", displayName: "文章写作", displayDescription: "用用户内容形成文章" },
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
    expect(el.querySelectorAll(".assistant-skill-item")).toHaveLength(4);
    expect(el.querySelector(".assistant-skill-name")?.textContent).toBe("整理材料");
    expect(el.querySelector(".assistant-skill-desc")?.textContent).toContain("采集内容");
  });

  it("filters by name substring (case-insensitive)", () => {
    const el = renderSkillList(SKILLS, "ORGANIZE");
    const items = el.querySelectorAll(".assistant-skill-item");
    expect(items).toHaveLength(1);
    expect(items[0].getAttribute("data-skill-name")).toBe("organize");
  });

  it("filters by description substring", () => {
    const el = renderSkillList(SKILLS, "行动");
    expect(el.querySelectorAll(".assistant-skill-item")).toHaveLength(1);
    expect(el.querySelector(".assistant-skill-item")?.getAttribute("data-skill-name")).toBe("plan-actions");
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

    const item = document.querySelector<HTMLButtonElement>('.assistant-skill-item[data-skill-name="organize"]')!;
    item.click();

    expect(input.value).toBe("/skill:organize ");
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
    expect(document.querySelectorAll(".assistant-skill-item")).toHaveLength(4);

    input.value = "/文章";
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
    const item = document.querySelector<HTMLButtonElement>('.assistant-skill-item[data-skill-name="plan-actions"]')!;
    item.click();
    expect(input.value).toBe("/skill:plan-actions ");
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
