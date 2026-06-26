use serde::Serialize;
use std::path::{Path, PathBuf};

use crate::notes::NoteEntry;

pub const INBOX_FILE: &str = "_inbox.md";
pub const TASKS_FILE: &str = "_tasks.md";
pub const DEFAULT_PIECE: &str = "piece.md";

#[derive(Serialize, Debug, PartialEq)]
pub struct ProjectEntry {
    /// Folder name (display label).
    pub name: String,
    /// Absolute folder path.
    pub path: String,
}

/// A directory counts as a project space when it holds an `_inbox.md`.
pub fn is_project_dir(dir: &Path) -> bool {
    dir.join(INBOX_FILE).is_file()
}

/// List the project-space subfolders of `root` (those containing `_inbox.md`),
/// newest-modified first. Loose files and non-project folders are skipped.
pub fn list_projects(root: &Path) -> std::io::Result<Vec<ProjectEntry>> {
    let mut entries: Vec<(std::time::SystemTime, ProjectEntry)> = Vec::new();
    for entry in std::fs::read_dir(root)? {
        let entry = entry?;
        let path = entry.path();
        if !path.is_dir() || !is_project_dir(&path) {
            continue;
        }
        let modified = entry.metadata()?.modified()?;
        let name = path.file_name().unwrap().to_string_lossy().to_string();
        entries.push((
            modified,
            ProjectEntry {
                name,
                path: path.to_string_lossy().to_string(),
            },
        ));
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

/// Pick a folder name under `root` that does not collide, appending " 2", " 3", …
fn unique_dir(root: &Path, base: &str) -> PathBuf {
    let mut candidate = root.join(base);
    let mut n = 2;
    while candidate.exists() {
        candidate = root.join(format!("{base} {n}"));
        n += 1;
    }
    candidate
}

/// Create a new project-space folder under `root`, scaffolding `_inbox.md`,
/// `_tasks.md`, and a default `piece.md` (all empty). Returns the created folder.
pub fn create_project(root: &Path, name: &str) -> std::io::Result<ProjectEntry> {
    let base = sanitize_folder_name(name);
    let dir = unique_dir(root, &base);
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join(INBOX_FILE), "")?;
    std::fs::write(dir.join(TASKS_FILE), "")?;
    std::fs::write(dir.join(DEFAULT_PIECE), "")?;
    Ok(ProjectEntry {
        name: dir.file_name().unwrap().to_string_lossy().to_string(),
        path: dir.to_string_lossy().to_string(),
    })
}

/// Turn a user-supplied project name into a safe, cross-platform folder name.
/// Path separators and characters illegal on Windows become `-`; surrounding
/// whitespace and dots are trimmed; an empty result falls back to "未命名".
pub fn sanitize_folder_name(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    if trimmed.is_empty() {
        "未命名".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn creates_project_with_scaffold_and_unique_name() {
        let root = tempdir();
        let entry = create_project(root.path(), "阅读笔记").unwrap();
        assert_eq!(entry.name, "阅读笔记");
        let dir = root.path().join("阅读笔记");
        assert!(is_project_dir(&dir));
        assert!(dir.join(TASKS_FILE).is_file());
        assert!(dir.join(DEFAULT_PIECE).is_file());

        // A second project with the same name gets a numeric suffix.
        let entry2 = create_project(root.path(), "阅读笔记").unwrap();
        assert_eq!(entry2.name, "阅读笔记 2");
        assert!(root.path().join("阅读笔记 2").join(INBOX_FILE).is_file());
    }

    #[test]
    fn sanitizes_folder_names() {
        assert_eq!(sanitize_folder_name("阅读笔记"), "阅读笔记");
        assert_eq!(sanitize_folder_name("a/b\\c"), "a-b-c");
        assert_eq!(sanitize_folder_name("a:b*c?"), "a-b-c-");
        assert_eq!(sanitize_folder_name("  trimmed  "), "trimmed");
        assert_eq!(sanitize_folder_name("..."), "未命名");
        assert_eq!(sanitize_folder_name("   "), "未命名");
    }

    #[test]
    fn lists_only_project_folders_newest_first() {
        let root = tempdir();
        // A project folder.
        let a = root.path().join("alpha");
        std::fs::create_dir_all(&a).unwrap();
        std::fs::write(a.join(INBOX_FILE), "").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        // A newer project folder.
        let b = root.path().join("beta");
        std::fs::create_dir_all(&b).unwrap();
        std::fs::write(b.join(INBOX_FILE), "").unwrap();
        // A plain folder without _inbox.md (ignored).
        std::fs::create_dir_all(root.path().join("plain")).unwrap();
        // A loose markdown file at the root (ignored — not a directory).
        std::fs::write(root.path().join("legacy.md"), "x").unwrap();

        let names: Vec<String> = list_projects(root.path())
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["beta".to_string(), "alpha".to_string()]);
    }

    #[test]
    fn detects_project_by_inbox_file() {
        let dir = tempdir();
        assert!(!is_project_dir(dir.path()));
        std::fs::write(dir.path().join(INBOX_FILE), "").unwrap();
        assert!(is_project_dir(dir.path()));
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-project-test-{}-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos(),
            NEXT_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
        ));
        std::fs::create_dir_all(&path).unwrap();
        TempDir(path)
    }

    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn path(&self) -> &std::path::Path {
            &self.0
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }
}
