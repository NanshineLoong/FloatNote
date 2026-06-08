use chrono::NaiveDateTime;
use serde::Serialize;
use std::path::Path;

#[derive(Serialize, Debug, PartialEq)]
pub struct NoteEntry {
    pub name: String,
    pub path: String,
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
