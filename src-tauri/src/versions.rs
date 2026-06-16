use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct VersionEntry {
    pub v: u32,
    pub ts: String,     // RFC3339 时间戳
    pub source: String, // "ai" | "manual"
    pub summary: Option<String>,
}

fn versions_dir(notes_dir: &Path, note_id: &str) -> PathBuf {
    notes_dir.join(".floatnote").join("versions").join(note_id)
}

fn manifest_path(notes_dir: &Path, note_id: &str) -> PathBuf {
    versions_dir(notes_dir, note_id).join("manifest.json")
}

pub fn list(notes_dir: &Path, note_id: &str) -> Vec<VersionEntry> {
    match std::fs::read_to_string(manifest_path(notes_dir, note_id)) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn snapshot(
    notes_dir: &Path,
    note_id: &str,
    content: &str,
    source: &str,
) -> std::io::Result<u32> {
    let dir = versions_dir(notes_dir, note_id);
    std::fs::create_dir_all(&dir)?;
    let mut entries = list(notes_dir, note_id);
    let next = entries.last().map(|entry| entry.v + 1).unwrap_or(1);
    std::fs::write(dir.join(format!("v{next}.md")), content)?;
    entries.push(VersionEntry {
        v: next,
        ts: Utc::now().to_rfc3339(),
        source: source.to_string(),
        summary: None,
    });
    std::fs::write(
        manifest_path(notes_dir, note_id),
        serde_json::to_string_pretty(&entries).unwrap(),
    )?;
    Ok(next)
}

pub fn read_version(notes_dir: &Path, note_id: &str, v: u32) -> std::io::Result<String> {
    std::fs::read_to_string(versions_dir(notes_dir, note_id).join(format!("v{v}.md")))
}

pub fn rename(notes_dir: &Path, old_id: &str, new_id: &str) -> std::io::Result<()> {
    let old = versions_dir(notes_dir, old_id);
    if old.exists() {
        let new = versions_dir(notes_dir, new_id);
        if let Some(parent) = new.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::rename(old, new)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn first_snapshot_is_v1_and_listed() {
        let dir = tempdir();
        let v = snapshot(dir.path(), "note", "hello", "manual").unwrap();
        assert_eq!(v, 1);
        let entries = list(dir.path(), "note");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].v, 1);
        assert_eq!(entries[0].source, "manual");
    }

    #[test]
    fn snapshots_increment_and_store_content() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "one", "manual").unwrap();
        let v2 = snapshot(dir.path(), "note", "two", "ai").unwrap();
        assert_eq!(v2, 2);
        assert_eq!(read_version(dir.path(), "note", 1).unwrap(), "one");
        assert_eq!(read_version(dir.path(), "note", 2).unwrap(), "two");
        assert_eq!(list(dir.path(), "note").len(), 2);
    }

    #[test]
    fn list_empty_when_no_history() {
        let dir = tempdir();
        assert!(list(dir.path(), "missing").is_empty());
    }

    #[test]
    fn rename_moves_history() {
        let dir = tempdir();
        snapshot(dir.path(), "old", "x", "manual").unwrap();
        rename(dir.path(), "old", "new").unwrap();
        assert!(list(dir.path(), "old").is_empty());
        assert_eq!(list(dir.path(), "new").len(), 1);
        assert_eq!(read_version(dir.path(), "new", 1).unwrap(), "x");
    }

    #[test]
    fn rename_noop_when_no_history() {
        let dir = tempdir();
        assert!(rename(dir.path(), "old", "new").is_ok());
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-ver-{}-{}-{}",
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
