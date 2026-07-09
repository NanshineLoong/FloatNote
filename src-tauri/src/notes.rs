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

use base64::Engine as _;

/// Image extensions accepted by the import/drag-drop path.
pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif"];

/// Per the spec: images live in `<note-dir>/_assets/`. This is the canonical
/// subdirectory name and also the safety gate for the custom protocol.
pub const ASSETS_DIR: &str = "_assets";

/// Unique filename for an image: `<stem>.<ext>`, or `<stem>-<n>.<ext>` on conflict.
pub fn unique_image_filename(dir: &Path, stem: &str, ext: &str) -> String {
    let ext = ext.trim_start_matches('.');
    let mut candidate = format!("{stem}.{ext}");
    let mut n = 0;
    while dir.join(ASSETS_DIR).join(&candidate).exists() {
        n += 1;
        candidate = format!("{stem}-{n}.{ext}");
    }
    candidate
}

/// MIME for an image extension (lowercased, no dot). Falls back to octet-stream.
pub fn image_content_type(ext: &str) -> &'static str {
    match ext.trim_start_matches('.').to_ascii_lowercase().as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "bmp" => "image/bmp",
        "avif" => "image/avif",
        _ => "application/octet-stream",
    }
}

/// Decode a base64 image payload and atomically write it into `<dir>/_assets/<filename>`.
/// Returns `(filename, "./_assets/<filename>")`. Creates `_assets/` if missing.
pub fn save_pasted_image(
    dir: &Path,
    suggested_stem: &str,
    data_base64: &str,
    mime: &str,
) -> std::io::Result<(String, String)> {
    let data = base64::engine::general_purpose::STANDARD
        .decode(data_base64)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
    let ext = mime_to_ext(mime).unwrap_or("png");
    let assets = dir.join(ASSETS_DIR);
    std::fs::create_dir_all(&assets)?;
    let filename = unique_image_filename(dir, suggested_stem, ext);
    let path = assets.join(&filename);
    // write_atomic is text-oriented (str); images are bytes, so write directly
    // with fsync, then the file is brand-new (no rename needed).
    {
        use std::io::Write;
        let mut file = std::fs::File::create(&path)?;
        file.write_all(&data)?;
        file.sync_all()?;
    }
    let rel = format!("./{ASSETS_DIR}/{filename}");
    Ok((filename, rel))
}

fn mime_to_ext(mime: &str) -> Option<&'static str> {
    match mime {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        "image/bmp" => Some("bmp"),
        "image/avif" => Some("avif"),
        _ => None,
    }
}

/// Per-source import result: `(source_path, rel_path, error_or_none)`.
pub type ImportResult = (String, String, Option<String>);

/// Copy each source image file into `<dir>/_assets/` (deduped). Non-image
/// extensions and copy failures are recorded per-item, not fatal.
pub fn import_image_files(source_paths: &[String], dir: &Path) -> Vec<ImportResult> {
    let assets = dir.join(ASSETS_DIR);
    let _ = std::fs::create_dir_all(&assets);
    source_paths
        .iter()
        .map(|src| {
            let p = std::path::Path::new(src);
            let ext = p
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
                .unwrap_or_default();
            if !IMAGE_EXTS.contains(&ext.as_str()) {
                return (src.clone(), String::new(), Some("not an image".into()));
            }
            let stem = p
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| "image".into());
            let slug = slugify(&stem);
            let filename = unique_image_filename(dir, &slug, &ext);
            let dest = assets.join(&filename);
            match std::fs::copy(p, &dest) {
                Ok(_) => (src.clone(), format!("./{ASSETS_DIR}/{filename}"), None),
                Err(e) => (src.clone(), String::new(), Some(e.to_string())),
            }
        })
        .collect()
}

/// Replace path separators and spaces with `-`; preserve Unicode letters.
fn slugify(s: &str) -> String {
    s.chars()
        .map(|c| {
            if c.is_whitespace() || c == '/' || c == '\\' || c == ':' {
                '-'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string()
}

/// Safety gate for the `floatnote-img://` protocol: the canonicalized path's
/// immediate parent must be `_assets` and its extension must be an image type.
/// Rejects `../` traversal and arbitrary-file reads.
pub fn is_safe_image_path(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase())
        .unwrap_or_default();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return false;
    }
    let Ok(canonical) = path.canonicalize() else {
        return false;
    };
    match canonical
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
    {
        Some(name) => name == ASSETS_DIR,
        None => false,
    }
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
    fn unique_image_filename_no_conflict() {
        let dir = tempdir();
        assert_eq!(unique_image_filename(dir.path(), "arch", "png"), "arch.png");
    }

    #[test]
    fn unique_image_filename_appends_on_conflict() {
        let dir = tempdir();
        let assets = dir.path().join("_assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(assets.join("arch.png"), b"x").unwrap();
        assert_eq!(
            unique_image_filename(dir.path(), "arch", "png"),
            "arch-1.png"
        );
        std::fs::write(assets.join("arch-1.png"), b"x").unwrap();
        assert_eq!(
            unique_image_filename(dir.path(), "arch", "png"),
            "arch-2.png"
        );
    }

    #[test]
    fn save_pasted_image_decodes_and_writes_to_assets() {
        let dir = tempdir();
        // 1x1 transparent PNG
        let png = base64::engine::general_purpose::STANDARD
            .decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=")
            .unwrap();
        let (filename, rel) = save_pasted_image(
            dir.path(),
            "paste-1",
            &base64::engine::general_purpose::STANDARD.encode(&png),
            "image/png",
        )
        .unwrap();
        assert_eq!(filename, "paste-1.png");
        assert_eq!(rel, "./_assets/paste-1.png");
        let written = std::fs::read(dir.path().join("_assets").join("paste-1.png")).unwrap();
        assert_eq!(written, png);
    }

    #[test]
    fn import_image_files_copies_and_dedups() {
        let dir = tempdir();
        let src = dir.path().join("_src.png");
        std::fs::write(&src, b"img").unwrap();
        let target = dir.path().to_path_buf(); // _assets created inside
        let results = import_image_files(&[src.to_string_lossy().to_string()], &target);
        assert_eq!(results.len(), 1);
        let (_, rel, err) = &results[0];
        assert!(err.is_none(), "unexpected error: {err:?}");
        assert_eq!(rel, "./_assets/_src.png");
        assert_eq!(
            std::fs::read(dir.path().join("_assets").join("_src.png")).unwrap(),
            b"img"
        );
        // Second import of same path dedups to -1.
        let results2 = import_image_files(&[src.to_string_lossy().to_string()], &target);
        let (_, rel2, _) = &results2[0];
        assert_eq!(rel2, "./_assets/_src-1.png");
    }

    #[test]
    fn import_image_files_rejects_non_image_ext() {
        let dir = tempdir();
        let src = dir.path().join("notes.txt");
        std::fs::write(&src, b"nope").unwrap();
        let results = import_image_files(&[src.to_string_lossy().to_string()], &dir.path());
        let (_, _, err) = &results[0];
        assert!(err.is_some());
    }

    #[test]
    fn is_safe_image_path_accepts_assets_inside() {
        let dir = tempdir();
        let p = dir.path().join("_assets").join("x.png");
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, b"x").unwrap();
        assert!(is_safe_image_path(&p));
    }

    #[test]
    fn is_safe_image_path_rejects_outside_assets() {
        let dir = tempdir();
        let p = dir.path().join("secret.md");
        std::fs::write(&p, b"x").unwrap();
        assert!(!is_safe_image_path(&p));
    }

    #[test]
    fn is_safe_image_path_rejects_traversal() {
        // /tmp/floatnote-.../_assets/../secret.png canonicalizes outside _assets
        let dir = tempdir();
        let assets = dir.path().join("_assets");
        std::fs::create_dir_all(&assets).unwrap();
        std::fs::write(dir.path().join("secret.png"), b"x").unwrap();
        let p = assets.join("..").join("secret.png");
        assert!(!is_safe_image_path(&p));
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
