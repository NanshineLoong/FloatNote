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

#[cfg(test)]
mod tests {
    use super::*;

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
