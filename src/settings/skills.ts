import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { escapeHtml } from "../shared/escape";
import type { Config, SaveConfig } from "./types";

export interface SkillSummary {
  name: string;
  description: string;
  displayName?: string;
  displayDescription?: string;
  source: "builtin" | "imported";
  enabled: boolean;
}

export function mountSkills(root: HTMLElement, importButton: HTMLButtonElement, notice: HTMLElement, config: Config, save: SaveConfig): void {
  const load = async () => {
    root.innerHTML = `<span class="settings-muted">正在读取…</span>`;
    try {
      const skills = await invoke<SkillSummary[]>("agent_list_skills");
      renderSkills(root, skills);
      root.querySelectorAll<HTMLInputElement>("[data-skill]").forEach((input) => {
        input.addEventListener("change", async () => {
          const name = input.dataset.skill!;
          const displayName = input.dataset.skillDisplayName ?? name;
          const previous = [...config.disabled_skills];
          input.disabled = true;
          notice.textContent = "";
          config.disabled_skills = input.checked
            ? config.disabled_skills.filter((entry) => entry !== name)
            : [...new Set([...config.disabled_skills, name])];
          try {
            await save();
          } catch (reason) {
            config.disabled_skills = previous;
            input.checked = !input.checked;
            updateSkillLabel(input, displayName);
            notice.textContent = `无法保存 Skill 状态：${String(reason)}`;
            input.disabled = false;
            return;
          }
          try {
            await invoke("agent_reload_skills");
          } catch {
            notice.textContent = "设置已保存，将在 AI 运行时恢复后生效。";
          }
          updateSkillLabel(input, displayName);
          input.disabled = false;
        });
      });
    } catch (reason) {
      root.innerHTML = `<div class="settings-empty-error" role="alert"><strong>无法读取 Skills</strong><span>${escapeHtml(String(reason))}</span><button id="retry-skills" type="button">重试</button></div>`;
      root.querySelector<HTMLButtonElement>("#retry-skills")!.onclick = () => void load();
    }
  };

  importButton.addEventListener("click", async () => {
    notice.textContent = "";
    const chosen = await open({ title: "选择包含 SKILL.md 的 Skill 目录", directory: true, multiple: false });
    if (!chosen || Array.isArray(chosen)) return;
    importButton.disabled = true;
    try {
      await invoke("agent_import_skill", { sourcePath: chosen });
      await load();
      try {
        await invoke("agent_reload_skills");
      } catch {
        notice.textContent = "Skill 已导入，将在 AI 运行时恢复后生效。";
      }
    } catch (reason) {
      notice.textContent = String(reason);
    } finally {
      importButton.disabled = false;
    }
  });
  void load();
}

function updateSkillLabel(input: HTMLInputElement, name: string): void {
  input.setAttribute("aria-label", `${input.checked ? "停用" : "启用"} ${name}`);
}

export function renderSkills(root: HTMLElement, skills: SkillSummary[]): void {
  root.innerHTML = skills.length ? `<div class="settings-card">${skills.map((skill) => {
    const displayName = skill.displayName ?? skill.name;
    const displayDescription = skill.displayDescription ?? skill.description;
    return `<label class="skill-line">
    <span class="skill-copy"><span class="skill-title"><strong>${escapeHtml(displayName)}</strong><span class="skill-source">${skill.source === "builtin" ? "内置" : "已导入"}</span></span><small>${escapeHtml(displayDescription)}</small></span>
    <span class="settings-toggle"><input type="checkbox" data-skill="${escapeHtml(skill.name)}" data-skill-display-name="${escapeHtml(displayName)}" ${skill.enabled ? "checked" : ""} aria-label="${skill.enabled ? "停用" : "启用"} ${escapeHtml(displayName)}"/><span class="settings-toggle-track" aria-hidden="true"></span></span>
  </label>`;
  }).join("")}</div>` : `<span class="settings-muted">暂无可用 Skill</span>`;
}
