/**
 * Single source of truth for Skills (同源原则).
 *
 * The skill *descriptions* injected into the system prompt (via
 * `formatSkillsForPrompt`) and the skill *full text* returned by the
 * `read_skill` tool both come from the same in-memory `Skill[]` / body map
 * built here — so a skill advertised in the prompt is always retrievable.
 *
 * Skill directories are resolved by the Rust host (bundled + user-global) and
 * delivered via the `set_skill_paths` protocol message. We load once into
 * memory at delivery time; runtime `readSkillBody` does zero filesystem access.
 */
import { existsSync, readFileSync } from "node:fs";
import {
  formatSkillsForPrompt,
  loadSkillsFromDir,
  type Skill,
} from "@earendil-works/pi-coding-agent";

export interface SkillSummary {
  name: string;
  description: string;
}

let skills: Skill[] = [];
const bodies = new Map<string, string>();

/**
 * Load skills from the given directories, replacing any previous set.
 * Missing/empty directories contribute no skills and never throw. Skills with
 * duplicate names keep the first occurrence (mirrors Pi's collision behavior).
 */
export function loadSkillPaths(paths: string[], disabledSkillNames: string[] = []): void {
  const aggregated: Skill[] = [];
  const seen = new Set<string>();
  for (const dir of paths) {
    if (!dir) continue;
    const result = loadSkillsFromDir({ dir, source: "floatnote" });
    for (const skill of result.skills) {
      if (seen.has(skill.name)) {
        // duplicate name — keep first, warn to stderr
        console.error(`[skills] duplicate skill name "${skill.name}" in ${dir}; keeping first`);
        continue;
      }
      seen.add(skill.name);
      aggregated.push(skill);
    }
  }

  const enabled = aggregated.filter((skill) => !disabledSkillNames.includes(skill.name));
  // Read each skill's full SKILL.md text into memory once (zero FS at runtime).
  bodies.clear();
  for (const skill of enabled) {
    try {
      if (existsSync(skill.filePath)) {
        bodies.set(skill.name, readFileSync(skill.filePath, "utf8"));
      }
    } catch {
      // unreadable file — leave body absent; read_skill will report unknown
    }
  }
  skills = enabled;
}

/** Enumerate loaded skills as {name, description}. */
export function listSkills(): SkillSummary[] {
  return skills.map((s) => ({ name: s.name, description: s.description }));
}

/**
 * Return the full SKILL.md text for a loaded skill, or null if the name is not
 * known. Accepts a skill *name* only — never a path — so it cannot be used to
 * traverse the filesystem.
 */
export function readSkillBody(name: string): string | null {
  return bodies.get(name) ?? null;
}

/** Format the loaded skills' descriptions for the system prompt (XML block). */
export function formatSkillsForSystemPrompt(): string {
  return formatSkillsForPrompt(skills);
}
