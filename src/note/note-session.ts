import type { CurrentNote, NoteEntry, ProjectEntry } from "./notes-state";

export type NoteMode = "project" | "document";
export type Surface = "inbox" | "piece";

/**
 * The sole owner of state that describes what the note window is showing.
 * Controllers may request transitions, but should not keep shadow copies.
 */
export class NoteSession {
  currentStartDir = "";
  recentProjects: string[] = [];
  recentDocuments: string[] = [];
  currentProject: ProjectEntry | null = null;
  currentInbox: CurrentNote | null = null;
  currentDocument: NoteEntry | null = null;
  currentPiece: NoteEntry | null = null;
  mode: NoteMode = "project";
  surface: Surface = "inbox";
  actionDesiredOpen = false;

  openProject(project: ProjectEntry, inbox: CurrentNote) {
    this.mode = "project";
    this.currentProject = project;
    this.currentInbox = inbox;
    this.currentDocument = null;
  }

  openDocument(document: NoteEntry) {
    this.mode = "document";
    this.currentDocument = document;
    this.currentInbox = null;
  }

  setCurrentPiece(piece: NoteEntry | null) {
    this.currentPiece = piece;
  }

  activePieceFile(): NoteEntry | null {
    return this.mode === "document" ? this.currentDocument : this.currentPiece;
  }

  resetProject() {
    this.currentProject = null;
    this.currentInbox = null;
    this.currentPiece = null;
  }
}

export function createNoteSession(): NoteSession {
  return new NoteSession();
}
