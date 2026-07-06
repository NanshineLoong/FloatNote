//! Best-effort source attribution at capture time. Always yields the frontmost
//! app name (via NSWorkspace — no permission needed); for known browsers also
//! fetches the active tab's URL+title via `osascript` (first use may trigger
//! macOS Automation consent; on denial/timeout/unknown bundle we fall back to
//! app-name-only). Never returns None when the frontmost app can be identified.

use std::process::Command;
use std::time::Duration;

/// Distinguishes a browser-tab source (has URL) from a plain app source.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "lowercase")]
pub enum SourceKind {
    Web,
    App,
}

/// One attributed source. Serializes to `{ kind, title, url, bundleId }`
/// (camelCase via field names). `bundle_id` is the stable app identity used both
/// for same-source merge detection and for fetching the app icon; it is null for
/// legacy/unknown sources. Chip dedup is custom frontend logic, so PartialEq is
/// not derived.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub kind: SourceKind,
    pub title: String,
    pub url: Option<String>,
    pub bundle_id: Option<String>,
}

/// Payload emitted on the `quote-captured` event. `source` is null only if even
/// the frontmost app name could not be obtained. `html` is the clipboard's
/// `text/html` flavor when the source app wrote one (lets the frontend preserve
/// list/table/bold formatting); null for plain-text-only sources.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QuotePayload {
    pub text: String,
    pub html: Option<String>,
    pub source: Option<Source>,
}

/// Capture the source of the current selection. `app` is used only to emit the
/// `automation-needed` hint when the frontmost app is a known browser but the
/// tab-URL osascript fails (macOS Automation not granted / denied / timed out);
/// the frontend then nudges the user to grant it, parallel to the accessibility
/// toast. The bundle id is threaded through to the frontend for same-source
/// merge detection and icon fetch.
#[cfg(target_os = "macos")]
pub fn capture_source(app: &tauri::AppHandle) -> Option<Source> {
    use tauri::Emitter;
    let (app_name, bundle_id) = frontmost_app()?;
    let app_name = app_name.unwrap_or_else(|| "unknown".to_string());
    let bundle_id = bundle_id.unwrap_or_default();

    if browser_script(&bundle_id).is_some() {
        if let Some((url, title)) = browser_tab(&bundle_id) {
            return Some(Source {
                kind: SourceKind::Web,
                title,
                url: Some(url),
                bundle_id: Some(bundle_id),
            });
        }
        // Known browser but the tab script failed: most likely Automation
        // permission. Nudge once; fall through to an app-name-only source so the
        // quote still lands with the browser's name + icon.
        let _ = app.emit_to("main", "automation-needed", ());
    }
    Some(Source {
        kind: SourceKind::App,
        title: app_name,
        url: None,
        bundle_id: Some(bundle_id).filter(|b| !b.is_empty()),
    })
}

#[cfg(not(target_os = "macos"))]
pub fn capture_source(_app: &tauri::AppHandle) -> Option<Source> {
    None
}

/// Return the colored app icon for `bundle_id` as a `data:image/png;base64,…`
/// string, ready to drop into an `<img src>`. None when the bundle isn't
/// installed, the icon can't be rasterised, or PNG encoding fails. macOS-only;
/// non-macOS returns None. The result is cached on the frontend by `bundle_id`,
/// so this runs ~once per app per session.
#[cfg(target_os = "macos")]
#[tauri::command]
pub fn app_icon(bundle_id: String) -> Option<String> {
    use objc2_app_kit::NSWorkspace;
    use objc2_foundation::NSString;

    // SAFETY: read-only AppKit accessors — bundle-id lookup, file-icon, TIFF
    // rasterisation. All inputs are valid bundle ids / file paths returned by
    // NSURL. None of these mutate shared state. Bytes are copied out of the
    // NSData before it drops, so the returned Vec owns its data.
    let tiff_bytes: Vec<u8> = unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let bid = NSString::from_str(&bundle_id);
        // Resolve bundle id → .app URL (nil for an unknown/missing bundle), then
        // ask NSWorkspace for that file's icon (the colorful app icon).
        let url = workspace.URLForApplicationWithBundleIdentifier(&bid)?;
        let path = url.path()?;
        let icon = workspace.iconForFile(&path);
        let tiff = icon.TIFFRepresentation()?;
        tiff.bytes().to_vec()
    };

    // Decode the TIFF, fit into 32×32 (icons are square so aspect is preserved),
    // and encode PNG. The data URI is small enough to cache in-memory upstream.
    let img = image::load_from_memory(&tiff_bytes).ok()?;
    let fitted = img.resize_to_fill(32, 32, image::imageops::FilterType::Lanczos3);
    let rgba = fitted.to_rgba8();
    let mut png = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut png);
    use image::ImageEncoder;
    encoder
        .write_image(rgba.as_raw(), 32, 32, image::ExtendedColorType::Rgba8)
        .ok()?;
    use base64::Engine;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&png);
    Some(format!("data:image/png;base64,{b64}"))
}

#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub fn app_icon(_bundle_id: String) -> Option<String> {
    None
}

/// (localizedName, bundleIdentifier) of NSWorkspace.shared.frontmostApplication.
#[cfg(target_os = "macos")]
fn frontmost_app() -> Option<(Option<String>, Option<String>)> {
    use objc2_app_kit::NSWorkspace;

    // objc2-app-kit 0.2 marks these as `unsafe` (a newer line makes them safe);
    // the calls are sound here: `sharedWorkspace` is a non-mutating class method,
    // and the property getters on a valid `NSRunningApplication` are read-only.
    let (name, bid) = unsafe {
        let workspace = NSWorkspace::sharedWorkspace();
        let app = workspace.frontmostApplication()?;
        let name = app.localizedName();
        let bid = app.bundleIdentifier();
        (name, bid)
    };
    Some((name.map(|s| s.to_string()), bid.map(|s| s.to_string())))
}

/// Build a per-family osascript that returns `URL\nTitle` of the active tab,
/// or None if the bundle is not a supported browser. Uses `tell application id`
/// so localization of the app name cannot break the script.
fn browser_script(bundle_id: &str) -> Option<String> {
    let chromium = [
        "com.google.chrome",
        "com.brave.browser",
        "com.microsoft.edgemacos",
        "com.vivaldi.vivaldi",
    ];
    let body = if chromium.contains(&bundle_id) {
        // Chromium-family tabs expose `title` (not `name`).
        "set t to active tab of front window\n  return (URL of t) & linefeed & (title of t)"
    } else if bundle_id == "com.apple.safari" {
        // Safari documents expose `name`.
        "return (URL of front document) & linefeed & (name of front document)"
    } else {
        return None;
    };
    Some(format!(
        "tell application id \"{bundle_id}\"\n  {body}\nend tell"
    ))
}

/// Run the browser-tab osascript for `bundle_id`. Returns (url, title) on success.
fn browser_tab(bundle_id: &str) -> Option<(String, String)> {
    let script = browser_script(bundle_id)?;
    let out = run_osascript(script, Duration::from_secs(2))?;
    let (url, title) = out.split_once('\n')?;
    let url = url.trim();
    let title = title.trim();
    if url.is_empty() {
        return None;
    }
    Some((url.to_string(), title.to_string()))
}

/// Run `osascript -e <script>` with a hard timeout. Returns trimmed stdout on
/// success. Spawns a thread + channel so a hung script cannot freeze capture;
/// on timeout the osascript child is left to the OS (rare, best-effort).
fn run_osascript(script: String, timeout: Duration) -> Option<String> {
    use std::sync::mpsc;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let out = Command::new("osascript").args(["-e", &script]).output();
        let _ = tx.send(out);
    });
    let output = rx.recv_timeout(timeout).ok()?.ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn browser_script_chromium() {
        let s = browser_script("com.google.chrome").unwrap();
        assert!(s.contains("active tab of front window"));
        assert!(s.contains("title of t"));
        assert!(s.contains("tell application id \"com.google.chrome\""));
    }

    #[test]
    fn browser_script_safari() {
        let s = browser_script("com.apple.safari").unwrap();
        assert!(s.contains("front document"));
        assert!(s.contains("name of front document"));
    }

    #[test]
    fn browser_script_unknown_is_none() {
        assert!(browser_script("org.mozilla.firefox").is_none());
    }

    #[test]
    fn payload_serializes_camel_case() {
        let p = QuotePayload {
            text: "hi".into(),
            html: None,
            source: Some(Source {
                kind: SourceKind::Web,
                title: "GitHub".into(),
                url: Some("https://github.com".into()),
                bundle_id: Some("com.google.chrome".into()),
            }),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            "{\"text\":\"hi\",\"html\":null,\"source\":{\"kind\":\"web\",\"title\":\"GitHub\",\"url\":\"https://github.com\",\"bundleId\":\"com.google.chrome\"}}"
        );
    }

    #[test]
    fn payload_app_source_serializes_null_url_and_bundle() {
        let p = QuotePayload {
            text: "hi".into(),
            html: None,
            source: Some(Source {
                kind: SourceKind::App,
                title: "终端".into(),
                url: None,
                bundle_id: Some("com.apple.terminal".into()),
            }),
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            "{\"text\":\"hi\",\"html\":null,\"source\":{\"kind\":\"app\",\"title\":\"终端\",\"url\":null,\"bundleId\":\"com.apple.terminal\"}}"
        );
    }

    #[test]
    fn payload_null_source_serializes_null() {
        let p = QuotePayload {
            text: "hi".into(),
            html: None,
            source: None,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(json, "{\"text\":\"hi\",\"html\":null,\"source\":null}");
    }

    #[test]
    fn payload_with_html_serializes_html() {
        let p = QuotePayload {
            text: "hi".into(),
            html: Some("<ul><li>x</li></ul>".into()),
            source: None,
        };
        let json = serde_json::to_string(&p).unwrap();
        assert_eq!(
            json,
            "{\"text\":\"hi\",\"html\":\"<ul><li>x</li></ul>\",\"source\":null}"
        );
    }
}
