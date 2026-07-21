//! Narrow boundary for OS integrations. Domain code depends on these traits so
//! headless tests can provide deterministic fakes instead of touching macOS or
//! Windows services.
//!
//! Only `UrlOpener` is wired into domain code today; the remaining traits are
//! the planned boundary and will be connected as their call sites land. Allow
//! dead code until then.
#![allow(dead_code)]

use std::path::Path;

pub trait UrlOpener: Send + Sync {
    fn open(&self, url: &str) -> Result<(), String>;
}

pub trait FileDialogs: Send + Sync {
    fn choose_files(&self) -> Result<Vec<std::path::PathBuf>, String>;
}

pub trait WindowOps: Send + Sync {
    fn show_and_focus(&self, label: &str) -> Result<(), String>;
    fn hide(&self, label: &str) -> Result<(), String>;
}

pub trait ShortcutOps: Send + Sync {
    fn replace_all(&self, shortcuts: &[String]) -> Result<(), String>;
}

pub trait ClipboardOps: Send + Sync {
    fn read_text(&self) -> Result<String, String>;
    fn write_text(&self, text: &str) -> Result<(), String>;
}

pub trait AccessibilityOps: Send + Sync {
    fn is_trusted(&self) -> bool;
    fn request_trust(&self);
}

pub trait TrashOps: Send + Sync {
    fn move_to_trash(&self, path: &Path) -> std::io::Result<()>;
}

pub trait FileRevealer: Send + Sync {
    fn reveal(&self, path: &Path) -> Result<(), String>;
}

pub struct SystemUrlOpener;

impl UrlOpener for SystemUrlOpener {
    fn open(&self, url: &str) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        let mut command = {
            let mut command = std::process::Command::new("open");
            command.arg(url);
            command
        };
        #[cfg(target_os = "windows")]
        let mut command = {
            let mut command = std::process::Command::new("cmd");
            command.args(["/C", "start", "", url]);
            command
        };
        #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
        let mut command = {
            let mut command = std::process::Command::new("xdg-open");
            command.arg(url);
            command
        };
        command.status().map_err(|error| error.to_string())?;
        Ok(())
    }
}

pub struct SystemFileRevealer;

impl FileRevealer for SystemFileRevealer {
    fn reveal(&self, path: &Path) -> Result<(), String> {
        if !path.exists() {
            return Err("文件或文件夹不存在".into());
        }
        let (program, args) = file_reveal_command(path);
        let status = std::process::Command::new(program)
            .args(args)
            .status()
            .map_err(|error| error.to_string())?;
        if !status.success() {
            return Err("无法在文件管理器中显示该位置".into());
        }
        Ok(())
    }
}

fn file_reveal_command(path: &Path) -> (std::ffi::OsString, Vec<std::ffi::OsString>) {
    #[cfg(target_os = "macos")]
    {
        (
            "open".into(),
            vec!["-R".into(), path.as_os_str().to_owned()],
        )
    }
    #[cfg(target_os = "windows")]
    {
        let mut select_arg = std::ffi::OsString::from("/select,");
        select_arg.push(path.as_os_str());
        ("explorer.exe".into(), vec![select_arg])
    }
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    {
        let target = path.parent().unwrap_or(path);
        ("xdg-open".into(), vec![target.as_os_str().to_owned()])
    }
}

#[cfg(test)]
mod tests {
    use super::file_reveal_command;
    use std::ffi::OsString;
    use std::path::Path;

    #[test]
    #[cfg(target_os = "macos")]
    fn finder_reveal_uses_open_r_with_the_path_as_a_separate_argument() {
        let (program, args) = file_reveal_command(Path::new("/tmp/项目 A/piece.md"));
        assert_eq!(program, OsString::from("open"));
        assert_eq!(
            args,
            vec![OsString::from("-R"), OsString::from("/tmp/项目 A/piece.md")]
        );
    }

    #[test]
    #[cfg(target_os = "windows")]
    fn explorer_reveal_selects_the_path() {
        let (program, args) = file_reveal_command(Path::new(r"C:\Notes\piece.md"));
        assert_eq!(program, OsString::from("explorer.exe"));
        assert_eq!(args, vec![OsString::from(r"/select,C:\Notes\piece.md")]);
    }
}
