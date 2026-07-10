import { describe, expect, test } from "vitest";
import { createNoteSession } from "./note-session";

describe("note session", () => {
  test("keeps project and standalone-document state mutually exclusive", () => {
    const session = createNoteSession();
    const project = { name: "Project", path: "/notes/project" };
    const document = { name: "Draft", path: "/notes/draft.md" };

    session.openProject(project, {
      dir: project.path,
      entry: { name: "_inbox", path: "/notes/project/_inbox.md" },
    });
    expect(session.mode).toBe("project");
    expect(session.currentProject).toEqual(project);
    expect(session.currentDocument).toBeNull();

    session.openDocument(document);
    expect(session.mode).toBe("document");
    expect(session.currentDocument).toEqual(document);
    expect(session.currentProject).toEqual(project);
    expect(session.currentInbox).toBeNull();
  });

  test("returns the document in document mode and the piece in project mode", () => {
    const session = createNoteSession();
    const piece = { name: "Piece", path: "/notes/project/piece.md" };
    const document = { name: "Draft", path: "/notes/draft.md" };

    session.setCurrentPiece(piece);
    expect(session.activePieceFile()).toEqual(piece);

    session.openDocument(document);
    expect(session.activePieceFile()).toEqual(document);
  });
});
