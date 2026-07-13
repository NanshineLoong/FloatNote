use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

static MANIFEST_TMP_SEQ: AtomicU64 = AtomicU64::new(0);

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

fn write_manifest(
    notes_dir: &Path,
    note_id: &str,
    entries: &[VersionEntry],
) -> std::io::Result<()> {
    use std::io::Write;

    let path = manifest_path(notes_dir, note_id);
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let seq = MANIFEST_TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let temp = dir.join(format!("manifest.{seq}.tmp"));
    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&temp)?;
        file.write_all(serde_json::to_string_pretty(entries).unwrap().as_bytes())?;
        file.sync_all()
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp);
        return Err(error);
    }

    #[cfg(not(windows))]
    {
        if let Err(error) = std::fs::rename(&temp, &path) {
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
    }

    #[cfg(windows)]
    {
        let backup = dir.join(format!("manifest.{seq}.bak"));
        let had_manifest = path.exists();
        if had_manifest {
            std::fs::rename(&path, &backup)?;
        }
        if let Err(error) = std::fs::rename(&temp, &path) {
            if had_manifest {
                let _ = std::fs::rename(&backup, &path);
            }
            let _ = std::fs::remove_file(&temp);
            return Err(error);
        }
        if had_manifest {
            let _ = std::fs::remove_file(backup);
        }
    }

    Ok(())
}

pub fn list(notes_dir: &Path, note_id: &str) -> Vec<VersionEntry> {
    let manifest = manifest_path(notes_dir, note_id);
    match std::fs::read_to_string(&manifest) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => {
            let dir = versions_dir(notes_dir, note_id);
            let backup = std::fs::read_dir(&dir).ok().and_then(|entries| {
                entries
                    .filter_map(Result::ok)
                    .filter_map(|entry| {
                        let name = entry.file_name().to_string_lossy().to_string();
                        let seq = name
                            .strip_prefix("manifest.")?
                            .strip_suffix(".bak")?
                            .parse::<u64>()
                            .ok()?;
                        Some((seq, entry.path()))
                    })
                    .max_by_key(|(seq, _)| *seq)
                    .map(|(_, path)| path)
            });
            let Some(backup) = backup else {
                return Vec::new();
            };
            let Ok(contents) = std::fs::read_to_string(&backup) else {
                return Vec::new();
            };
            let Ok(entries) = serde_json::from_str::<Vec<VersionEntry>>(&contents) else {
                return Vec::new();
            };
            let _ = std::fs::rename(backup, manifest);
            entries
        }
    }
}

pub fn snapshot(
    notes_dir: &Path,
    note_id: &str,
    content: &str,
    source: &str,
) -> std::io::Result<u32> {
    snapshot_named(notes_dir, note_id, content, source, None)
}

fn snapshot_named(
    notes_dir: &Path,
    note_id: &str,
    content: &str,
    source: &str,
    summary: Option<String>,
) -> std::io::Result<u32> {
    // 采集面与其它系统文件（`_inbox` / `_tasks` 等，`_` 前缀约定）不做版本记录；
    // 版本只属于写作层面的成品。返回 0 表示「未快照」。
    if note_id.starts_with('_') {
        return Ok(0);
    }
    let dir = versions_dir(notes_dir, note_id);
    std::fs::create_dir_all(&dir)?;
    let mut entries = list(notes_dir, note_id);
    let next = entries.last().map(|entry| entry.v + 1).unwrap_or(1);
    std::fs::write(dir.join(format!("v{next}.md")), content)?;
    entries.push(VersionEntry {
        v: next,
        ts: Utc::now().to_rfc3339(),
        source: source.to_string(),
        summary,
    });
    write_manifest(notes_dir, note_id, &entries)?;
    Ok(next)
}

pub fn read_version(notes_dir: &Path, note_id: &str, v: u32) -> std::io::Result<String> {
    std::fs::read_to_string(versions_dir(notes_dir, note_id).join(format!("v{v}.md")))
}

pub struct PreparedRestore {
    pub content: String,
    pub backup_v: Option<u32>,
}

pub fn prepare_restore(
    notes_dir: &Path,
    note_id: &str,
    current_content: &str,
    v: u32,
) -> std::io::Result<PreparedRestore> {
    let restored = read_version(notes_dir, note_id, v)?;
    let backup_v = if current_content != restored {
        Some(snapshot_named(
            notes_dir,
            note_id,
            current_content,
            "restore",
            Some("恢复前备份".to_string()),
        )?)
    } else {
        None
    };
    Ok(PreparedRestore {
        content: restored,
        backup_v,
    })
}

pub fn rename_version(notes_dir: &Path, note_id: &str, v: u32, name: &str) -> std::io::Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "version name cannot be empty",
        ));
    }
    let mut entries = list(notes_dir, note_id);
    let entry = entries
        .iter_mut()
        .find(|entry| entry.v == v)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::NotFound, "version not found"))?;
    entry.summary = Some(name.to_string());
    write_manifest(notes_dir, note_id, &entries)
}

pub fn delete_version(notes_dir: &Path, note_id: &str, v: u32) -> std::io::Result<()> {
    let mut entries = list(notes_dir, note_id);
    let original_entries = entries.clone();
    let previous_len = entries.len();
    entries.retain(|entry| entry.v != v);
    if entries.len() == previous_len {
        return Err(std::io::Error::new(
            std::io::ErrorKind::NotFound,
            "version not found",
        ));
    }
    write_manifest(notes_dir, note_id, &entries)?;
    let version_path = versions_dir(notes_dir, note_id).join(format!("v{v}.md"));
    match std::fs::remove_file(version_path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            let _ = write_manifest(notes_dir, note_id, &original_entries);
            return Err(error);
        }
    }
    Ok(())
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

/// Remove all version history for a note (its `.floatnote/versions/<note_id>` dir).
/// No-op when there is no history. Called when a note file is deleted.
pub fn purge(notes_dir: &Path, note_id: &str) -> std::io::Result<()> {
    let dir = versions_dir(notes_dir, note_id);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)?;
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
    fn system_files_are_not_snapshotted() {
        let dir = tempdir();
        let v = snapshot(dir.path(), "_inbox", "draft", "ai").unwrap();
        assert_eq!(v, 0);
        assert!(list(dir.path(), "_inbox").is_empty());
    }

    #[test]
    fn list_empty_when_no_history() {
        let dir = tempdir();
        assert!(list(dir.path(), "missing").is_empty());
    }

    #[test]
    fn list_recovers_a_manifest_backup_left_by_interrupted_replace() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "one", "manual").unwrap();
        let manifest = manifest_path(dir.path(), "note");
        let backup = versions_dir(dir.path(), "note").join("manifest.99.bak");
        std::fs::rename(&manifest, &backup).unwrap();

        let entries = list(dir.path(), "note");

        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].v, 1);
        assert!(manifest.exists());
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

    #[test]
    fn purge_removes_history_and_is_noop_when_missing() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "x", "manual").unwrap();
        assert_eq!(list(dir.path(), "note").len(), 1);
        purge(dir.path(), "note").unwrap();
        assert!(list(dir.path(), "note").is_empty());
        // No history to begin with — still ok.
        purge(dir.path(), "other").unwrap();
    }

    #[test]
    fn prepare_restore_backups_current_content_with_restore_label() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "old version", "manual").unwrap();

        let restored = prepare_restore(dir.path(), "note", "current draft", 1).unwrap();

        assert_eq!(restored.content, "old version");
        assert_eq!(restored.backup_v, Some(2));
        let entries = list(dir.path(), "note");
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[1].source, "restore");
        assert_eq!(entries[1].summary.as_deref(), Some("恢复前备份"));
        assert_eq!(
            read_version(dir.path(), "note", 2).unwrap(),
            "current draft"
        );
    }

    #[test]
    fn prepare_restore_does_not_backup_identical_content() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "same", "manual").unwrap();

        let restored = prepare_restore(dir.path(), "note", "same", 1).unwrap();

        assert_eq!(restored.content, "same");
        assert_eq!(restored.backup_v, None);
        assert_eq!(list(dir.path(), "note").len(), 1);
    }

    #[test]
    fn rename_version_updates_only_its_display_name() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "draft", "manual").unwrap();

        rename_version(dir.path(), "note", 1, "完成第一稿").unwrap();

        let entries = list(dir.path(), "note");
        assert_eq!(entries[0].summary.as_deref(), Some("完成第一稿"));
        assert_eq!(read_version(dir.path(), "note", 1).unwrap(), "draft");
    }

    #[test]
    fn delete_version_removes_only_the_selected_entry_and_file() {
        let dir = tempdir();
        snapshot(dir.path(), "note", "one", "manual").unwrap();
        snapshot(dir.path(), "note", "two", "manual").unwrap();

        delete_version(dir.path(), "note", 1).unwrap();

        let entries = list(dir.path(), "note");
        assert_eq!(
            entries.iter().map(|entry| entry.v).collect::<Vec<_>>(),
            vec![2]
        );
        assert!(read_version(dir.path(), "note", 1).is_err());
        assert_eq!(read_version(dir.path(), "note", 2).unwrap(), "two");
    }

    #[cfg(unix)]
    #[test]
    fn delete_version_keeps_snapshot_when_manifest_update_fails() {
        use std::os::unix::fs::PermissionsExt;

        let dir = tempdir();
        snapshot(dir.path(), "note", "one", "manual").unwrap();
        let manifest = manifest_path(dir.path(), "note");
        let history_dir = versions_dir(dir.path(), "note");
        std::fs::set_permissions(&manifest, std::fs::Permissions::from_mode(0o400)).unwrap();
        std::fs::set_permissions(&history_dir, std::fs::Permissions::from_mode(0o500)).unwrap();

        let result = delete_version(dir.path(), "note", 1);

        std::fs::set_permissions(&history_dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        std::fs::set_permissions(&manifest, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(result.is_err());
        assert_eq!(read_version(dir.path(), "note", 1).unwrap(), "one");
    }

    use crate::testutil::tempdir;
}
