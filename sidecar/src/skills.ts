/**
 * Atomic registry for the trusted Skills supplied by the Rust host.
 *
 * A session keeps one SkillSnapshot for both Pi's ResourceLoader and Skill
 * resource reads. Replacing the global registry therefore cannot expose a
 * catalog from one generation with a read allow-list from another.
 */
import { realpathSync, statSync } from "node:fs";
import path from "node:path";
import { loadSkillsFromDir, type Skill } from "@earendil-works/pi-coding-agent";

export interface SkillSummary {
  name: string;
  description: string;
}

export class SkillSnapshot {
  private readonly value: readonly Skill[];

  constructor(value: readonly Skill[]) {
    this.value = value.map((skill) => ({ ...skill }));
  }

  skills(): Skill[] {
    return this.value.map((skill) => ({ ...skill }));
  }

  summaries(): SkillSummary[] {
    return this.value.map(({ name, description }) => ({ name, description }));
  }

  resolveReadableFile(candidate: string): string | null {
    let realCandidate: string;
    try {
      realCandidate = realpathSync(candidate);
      if (!statSync(realCandidate).isFile()) return null;
    } catch {
      return null;
    }

    for (const skill of this.value) {
      let base: string;
      try {
        base = realpathSync(skill.baseDir);
      } catch {
        continue;
      }
      const relative = path.relative(base, realCandidate);
      if (
        relative === ""
        || (!relative.startsWith(`..${path.sep}`)
          && relative !== ".."
          && !path.isAbsolute(relative))
      ) {
        return realCandidate;
      }
    }
    return null;
  }
}

export class SkillRegistry {
  private current = new SkillSnapshot([]);

  replace(paths: string[], disabledNames: string[]): SkillSnapshot {
    const next: Skill[] = [];
    const seen = new Set<string>();
    for (const dir of paths) {
      if (!dir) continue;
      const result = loadSkillsFromDir({ dir, source: "floatnote" });
      for (const skill of result.skills) {
        if (seen.has(skill.name)) {
          console.error(`[skills] duplicate skill name "${skill.name}" in ${dir}; keeping first`);
          continue;
        }
        seen.add(skill.name);
        if (!disabledNames.includes(skill.name)) {
          try {
            next.push({
              ...skill,
              filePath: realpathSync(skill.filePath),
              baseDir: realpathSync(skill.baseDir),
            });
          } catch {
            // Rust supplies trusted paths, but a resource may disappear while reloading.
          }
        }
      }
    }
    this.current = new SkillSnapshot(next);
    return this.current;
  }

  snapshot(): SkillSnapshot {
    return this.current;
  }
}

export class SessionSkillView {
  constructor(private current: SkillSnapshot) {}

  replace(next: SkillSnapshot): void {
    this.current = next;
  }

  skills(): Skill[] {
    return this.current.skills();
  }

  summaries(): SkillSummary[] {
    return this.current.summaries();
  }

  resolveReadableFile(candidate: string): string | null {
    return this.current.resolveReadableFile(candidate);
  }
}
