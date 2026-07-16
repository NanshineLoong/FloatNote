// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderSkills, type SkillSummary } from "./skills";

function skill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    name: "organize",
    description: "Organize source material.",
    source: "builtin",
    enabled: true,
    ...overrides,
  };
}

describe("Skill settings list", () => {
  it("显示中文元数据但用英文 ID 控制启停", () => {
    const root = document.createElement("div");

    renderSkills(root, [skill({
      displayName: "整理材料",
      displayDescription: "按主题整理采集内容",
    })]);

    expect(root.querySelector("strong")?.textContent).toBe("整理材料");
    expect(root.querySelector("small")?.textContent).toBe("按主题整理采集内容");
    const input = root.querySelector<HTMLInputElement>("[data-skill]")!;
    expect(input.dataset.skill).toBe("organize");
    expect(input.getAttribute("aria-label")).toBe("停用 整理材料");
  });

  it("外部 Skill 缺少展示元数据时回退到标准字段", () => {
    const root = document.createElement("div");

    renderSkills(root, [skill({ source: "imported" })]);

    expect(root.querySelector("strong")?.textContent).toBe("organize");
    expect(root.querySelector("small")?.textContent).toBe("Organize source material.");
    expect(root.querySelector(".skill-source")?.textContent).toBe("已导入");
  });
});
