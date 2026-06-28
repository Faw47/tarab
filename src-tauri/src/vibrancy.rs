#![allow(dead_code)]
use tauri::{Runtime, WebviewWindow};

use window_vibrancy::*;

pub fn apply_platform_vibrancy<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        // Detect Windows version at runtime via the registry
        // Windows 11 builds are 22000+
        let build = get_windows_build_number();
        if build >= 22000 {
            // Windows 11: use Mica
            if let Err(e) = apply_mica(window, Some(true)) {
                eprintln!("[vibrancy] Mica failed: {e}. Falling back to acrylic.");
                let _ = apply_acrylic(window, Some((0, 0, 0, 80)));
            }
        } else {
            // Windows 10: use Acrylic with low opacity
            let _ = apply_acrylic(window, Some((0, 0, 0, 80)));
        }
    }

    #[cfg(target_os = "macos")]
    {
        let _ = apply_vibrancy(
            window,
            NSVisualEffectMaterial::UnderWindowBackground,
            None,
            None,
        );
    }
}

#[cfg(target_os = "windows")]
fn get_windows_build_number() -> u32 {
    // Query CurrentBuildNumber from registry via std::process::Command
    let output = std::process::Command::new("reg")
        .args([
            "query",
            "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion",
            "/v",
            "CurrentBuildNumber",
        ])
        .output();

    match output {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout);
            s.lines()
                .find(|l| l.contains("CurrentBuildNumber"))
                .and_then(|l| l.split_whitespace().last())
                .and_then(|n| n.parse().ok())
                .unwrap_or(0)
        }
        Err(_) => 0,
    }
}
