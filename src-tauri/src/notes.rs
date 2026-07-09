use chrono::NaiveDateTime;
use serde::Serialize;
use std::io::Write;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::UNIX_EPOCH;

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteEntry {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NoteContent {
    pub content: String,
    pub mtime: Option<u64>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WriteOutcome {
    pub conflict: bool,
    pub mtime: Option<u64>,
}

pub fn timestamp_stem(now: NaiveDateTime) -> String {
    now.format("%Y-%m-%d %H-%M").to_string()
}

pub fn unique_filename(dir: &Path, stem: &str) -> String {
    let mut candidate = format!("{stem}.md");
    let mut n = 2;
    while dir.join(&candidate).exists() {
        candidate = format!("{stem} {n}.md");
        n += 1;
    }
    candidate
}

pub fn list_markdown(dir: &Path) -> std::io::Result<Vec<NoteEntry>> {
    let mut entries: Vec<(std::time::SystemTime, NoteEntry)> = Vec::new();
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|extension| extension.to_str()) == Some("md") {
            let modified = entry.metadata()?.modified()?;
            let name = path.file_stem().unwrap().to_string_lossy().to_string();
            entries.push((
                modified,
                NoteEntry {
                    name,
                    path: path.to_string_lossy().to_string(),
                },
            ));
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(entries.into_iter().map(|(_, entry)| entry).collect())
}

pub fn rename_note(dir: &Path, old_name: &str, new_stem: &str) -> std::io::Result<String> {
    let target = dir.join(format!("{new_stem}.md"));
    if target.exists() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::AlreadyExists,
            "target exists",
        ));
    }
    std::fs::rename(dir.join(format!("{old_name}.md")), &target)?;
    Ok(target.to_string_lossy().to_string())
}

/// Move a note file (a piece or a standalone document) to the OS trash.
/// No-op if the file is already gone — keeps the UI forgiving when the file
/// vanished externally. Version-history cleanup is the caller's responsibility;
/// this function only touches the `.md` file itself.
pub fn delete_note(path: &Path) -> std::io::Result<()> {
    if !path.exists() {
        return Ok(());
    }
    trash::delete(path).map_err(|error| std::io::Error::other(error.to_string()))
}

/// 进程级临时文件序号，保证并发写不撞名。
static TMP_SEQ: AtomicU64 = AtomicU64::new(0);

/// 原子写入：先写同目录临时文件（`.tmp` 后缀，watcher 与 list 均忽略）→
/// `sync_all` fsync → `rename` 原子替换目标。任一步失败都清理临时文件并返回错误，
/// 原文件不被破坏（rename 是同盘原子操作）。
pub fn write_atomic(path: &Path, content: &str) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    let file_name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "note.md".to_string());
    let n = TMP_SEQ.fetch_add(1, Ordering::Relaxed);
    let tmp = dir.join(format!("{file_name}.{n}.tmp"));

    let write_result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(content.as_bytes())?;
        file.sync_all()?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }

    if let Err(error) = std::fs::rename(&tmp, path) {
        let _ = std::fs::remove_file(&tmp);
        return Err(error);
    }
    Ok(())
}

/// 取文件 `modified()` 的 UNIX_EPOCH 毫秒；文件不存在或不可读返回 None。
pub fn mtime_millis(path: &Path) -> Option<u64> {
    std::fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::NaiveDate;

    #[test]
    fn stem_format() {
        let dt = NaiveDate::from_ymd_opt(2026, 6, 8)
            .unwrap()
            .and_hms_opt(14, 30, 0)
            .unwrap();
        assert_eq!(timestamp_stem(dt), "2026-06-08 14-30");
    }

    #[test]
    fn unique_when_no_conflict() {
        let dir = tempdir();
        assert_eq!(unique_filename(dir.path(), "note"), "note.md");
    }

    #[test]
    fn unique_appends_suffix_on_conflict() {
        let dir = tempdir();
        std::fs::write(dir.path().join("note.md"), "x").unwrap();
        assert_eq!(unique_filename(dir.path(), "note"), "note 2.md");
        std::fs::write(dir.path().join("note 2.md"), "x").unwrap();
        assert_eq!(unique_filename(dir.path(), "note"), "note 3.md");
    }

    #[test]
    fn lists_only_markdown_sorted_newest_first() {
        let dir = tempdir();
        std::fs::write(dir.path().join("a.md"), "1").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        std::fs::write(dir.path().join("b.md"), "2").unwrap();
        std::fs::write(dir.path().join("ignore.txt"), "x").unwrap();
        let names: Vec<String> = list_markdown(dir.path())
            .unwrap()
            .into_iter()
            .map(|entry| entry.name)
            .collect();
        assert_eq!(names, vec!["b".to_string(), "a".to_string()]);
    }

    #[test]
    fn rename_succeeds_and_errors_on_conflict() {
        let dir = tempdir();
        std::fs::write(dir.path().join("old.md"), "x").unwrap();
        rename_note(dir.path(), "old", "new").unwrap();
        assert!(dir.path().join("new.md").exists());
        std::fs::write(dir.path().join("a.md"), "x").unwrap();
        assert!(rename_note(dir.path(), "a", "new").is_err());
    }

    #[test]
    fn delete_removes_file_and_is_noop_when_missing() {
        let dir = tempdir();
        std::fs::write(dir.path().join("doomed.md"), "x").unwrap();
        delete_note(&dir.path().join("doomed.md")).unwrap();
        assert!(!dir.path().join("doomed.md").exists());
        // Already gone — no error.
        delete_note(&dir.path().join("doomed.md")).unwrap();
    }

    #[test]
    fn write_atomic_replaces_content_and_leaves_no_tmp() {
        let dir = tempdir();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "old").unwrap();
        write_atomic(&path, "new").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "new");
        let leftovers: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok())
            .map(|e| e.file_name().to_string_lossy().to_string())
            .filter(|n| n.ends_with(".tmp"))
            .collect();
        assert!(leftovers.is_empty(), "tmp leftovers: {leftovers:?}");
    }

    #[test]
    fn write_atomic_creates_new_file() {
        let dir = tempdir();
        let path = dir.path().join("fresh.md");
        write_atomic(&path, "first").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "first");
    }

    #[test]
    fn write_atomic_errors_when_parent_missing() {
        let path = std::path::Path::new("/nonexistent-dir-xyz-aaa/note.md");
        assert!(write_atomic(path, "x").is_err());
    }

    #[test]
    fn mtime_millis_none_for_missing_file() {
        assert_eq!(mtime_millis(std::path::Path::new("/no/such/file.md")), None);
    }

    #[test]
    fn mtime_millis_returns_some_for_existing_file() {
        let dir = tempdir();
        let path = dir.path().join("note.md");
        std::fs::write(&path, "x").unwrap();
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        let m = mtime_millis(&path).expect("existing file has mtime");
        // 文件刚创建，mtime 应在 now 附近（容忍文件系统时间戳精度与调度延迟）。
        assert!(m <= now + 60_000, "mtime {m} far in the future");
        assert!(m > now - 60_000, "mtime {m} far in the past");
    }

    fn tempdir() -> TempDir {
        static NEXT_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
        let mut path = std::env::temp_dir();
        path.push(format!(
            "floatnote-test-{}-{}-{}",
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
