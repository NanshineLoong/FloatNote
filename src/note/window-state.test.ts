import { describe, it, expect } from "vitest";
import { resolveBootstrap, resolveOpenProject } from "./window-state";
import type { NoteEntry, ProjectEntry } from "./notes-state";

const project = (name: string): ProjectEntry => ({
  name,
  path: `/wd/${name}`,
});

const piece = (name: string): NoteEntry => ({
  name,
  path: `/wd/proj/${name}.md`,
});

describe("resolveBootstrap", () => {
  const startDir = "/wd";

  it("opens the most-recent project when MRU is non-empty", () => {
    const recent = [project("alpha"), project("beta")];
    const outcome = resolveBootstrap({ recent, projects: [], startDir });
    expect(outcome).toEqual({ kind: "OPEN", project: project("alpha") });
  });

  it("falls back to the newest on-disk project when MRU is empty", () => {
    const projects = [project("on-disk")];
    const outcome = resolveBootstrap({ recent: [], projects, startDir });
    expect(outcome).toEqual({ kind: "OPEN", project: project("on-disk") });
  });

  it("lands in NO_PROJECT when both MRU and disk are empty", () => {
    const outcome = resolveBootstrap({ recent: [], projects: [], startDir });
    expect(outcome).toEqual({ kind: "NO_PROJECT", startDir });
  });

  it("surfaces PATH_ERROR when the listing call failed", () => {
    const outcome = resolveBootstrap({
      recent: [],
      projects: [],
      startDir,
      error: "read_dir: No such file or directory",
    });
    expect(outcome).toEqual({
      kind: "PATH_ERROR",
      startDir,
      error: "read_dir: No such file or directory",
    });
  });

  it("MRU takes precedence over on-disk scan", () => {
    const outcome = resolveBootstrap({
      recent: [project("from-mru")],
      projects: [project("from-disk")],
      startDir,
    });
    expect(outcome).toEqual({ kind: "OPEN", project: project("from-mru") });
  });

  it("PATH_ERROR takes precedence over a non-empty MRU", () => {
    // If listing threw, we cannot trust the MRU either — surface the error.
    const outcome = resolveBootstrap({
      recent: [project("alpha")],
      projects: [],
      startDir,
      error: "permission denied",
    });
    expect(outcome.kind).toBe("PATH_ERROR");
  });
});

describe("resolveOpenProject", () => {
  it("loads the first piece when the project has pieces", () => {
    const proj = project("alpha");
    const state = resolveOpenProject({
      project: proj,
      pieces: [piece("draft"), piece("older")],
    });
    expect(state).toEqual({
      kind: "LOADED",
      project: proj,
      piece: piece("draft"),
    });
  });

  it("lands in NO_PIECE when the piece list is empty", () => {
    const proj = project("alpha");
    const state = resolveOpenProject({ project: proj, pieces: [] });
    expect(state).toEqual({ kind: "NO_PIECE", project: proj });
  });
});
