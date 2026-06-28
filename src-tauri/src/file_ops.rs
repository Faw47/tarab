use parking_lot::RwLock;
use std::ffi::OsString;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use tauri::async_runtime::spawn_blocking;

use crate::database::SharedDatabase;

#[derive(Default)]
pub struct LibraryRootsState {
    pub roots: Vec<PathBuf>,
}

pub type SharedLibraryRoots = Arc<RwLock<LibraryRootsState>>;

pub fn create_library_roots_state() -> SharedLibraryRoots {
    Arc::new(RwLock::new(LibraryRootsState::default()))
}

fn ensure_filename_with_extension(base: &str, source: &Path) -> String {
    if base.contains('.') {
        base.to_string()
    } else if let Some(ext) = source.extension().and_then(|e| e.to_str()) {
        format!("{}.{}", base, ext)
    } else {
        base.to_string()
    }
}

pub(crate) fn canonicalize_existing_path(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|e| format!("Failed to resolve path {}: {}", path.display(), e))
}

pub(crate) fn canonicalize_target_path(path: &Path) -> Result<PathBuf, String> {
    if path.exists() {
        return canonicalize_existing_path(path);
    }

    let mut missing_components: Vec<OsString> = Vec::new();
    let mut cursor = path;

    while !cursor.exists() {
        let file_name = cursor
            .file_name()
            .ok_or_else(|| format!("Target path has no existing parent: {}", path.display()))?;

        if !matches!(
            Path::new(file_name).components().next(),
            Some(Component::Normal(_))
        ) {
            return Err(format!(
                "Target path contains an invalid component: {}",
                path.display()
            ));
        }

        missing_components.push(file_name.to_os_string());
        cursor = cursor
            .parent()
            .ok_or_else(|| format!("Target path has no existing parent: {}", path.display()))?;
    }

    let mut canonical = fs::canonicalize(cursor).map_err(|e| {
        format!(
            "Failed to resolve target ancestor {}: {}",
            cursor.display(),
            e
        )
    })?;

    for component in missing_components.iter().rev() {
        canonical.push(component);
    }

    Ok(canonical)
}

pub(crate) fn is_path_allowed(path: &Path, roots: &[PathBuf]) -> bool {
    roots
        .iter()
        .any(|root| path == root || path.starts_with(root))
}

pub(crate) fn ensure_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<(), String> {
    if roots.is_empty() {
        return Err(
            "File operations are blocked: no library roots configured. Add a library folder first."
                .to_string(),
        );
    }
    if is_path_allowed(path, roots) {
        Ok(())
    } else {
        Err(format!(
            "Blocked {} outside configured library roots: {}",
            action,
            path.display()
        ))
    }
}

pub(crate) fn ensure_existing_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_existing_path(path)?;
    ensure_path_allowed(&canonical, roots, action)?;
    Ok(canonical)
}

pub(crate) fn ensure_target_path_allowed(
    path: &Path,
    roots: &[PathBuf],
    action: &str,
) -> Result<PathBuf, String> {
    let canonical = canonicalize_target_path(path)?;
    ensure_path_allowed(&canonical, roots, action)?;
    Ok(canonical)
}

pub(crate) fn collect_deletable_paths(
    file_paths: &[String],
    roots: &[PathBuf],
) -> Result<Vec<(String, PathBuf)>, String> {
    let mut deletable_paths = Vec::new();
    for path in file_paths {
        let p = Path::new(path);
        if p.exists() {
            let canonical = ensure_existing_path_allowed(p, roots, "delete file")?;
            deletable_paths.push((path.clone(), canonical));
        }
    }
    Ok(deletable_paths)
}

#[tauri::command]
pub fn set_library_roots(
    roots: Vec<String>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let mut canonical_roots: Vec<PathBuf> = Vec::new();
    for root in roots {
        let root_path = PathBuf::from(&root);
        if !root_path.exists() || !root_path.is_dir() {
            continue;
        }
        let canonical = fs::canonicalize(&root_path).map_err(|e| {
            format!(
                "Failed to canonicalize library root {}: {}",
                root_path.display(),
                e
            )
        })?;
        canonical_roots.push(canonical);
    }
    canonical_roots.sort();
    canonical_roots.dedup();
    roots_state.write().roots = canonical_roots;
    Ok(())
}

#[tauri::command]
pub async fn rename_file(
    old_path: String,
    new_name: String,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots = roots_state.read().roots.clone();
        let _source_canonical = ensure_existing_path_allowed(&source, &roots, "rename source file")?;
        let parent = source
            .parent()
            .ok_or_else(|| "Source has no parent directory".to_string())?;
        let final_name = ensure_filename_with_extension(&new_name, &source);
        let target = parent.join(final_name);
        if source == target {
            return Ok(target.to_string_lossy().to_string());
        }
        if target.exists() {
            return Err("Target file already exists".into());
        }
        let _target_canonical =
            ensure_target_path_allowed(&target, &roots, "rename destination file")?;
        fs::rename(&source, &target).map_err(|e| format!("Failed to rename: {}", e))?;
        let target_str = target.to_string_lossy().to_string();
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            // Try to restore original file path if DB update fails.
            let rollback_result = fs::rename(&target, &source);
            return match rollback_result {
                Ok(()) => Err(format!(
                    "Failed to update database after rename, operation rolled back: {}",
                    err
                )),
                Err(rollback_err) => Err(format!(
                    "Failed to update database after rename and rollback failed (manual rescan needed). DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn move_file(
    old_path: String,
    new_path: String,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<String, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let source = PathBuf::from(&old_path);
        if !source.exists() {
            return Err(format!("File does not exist: {}", old_path));
        }
        let roots = roots_state.read().roots.clone();
        let _source_canonical = ensure_existing_path_allowed(&source, &roots, "move source file")?;
        let mut target = PathBuf::from(&new_path);
        if target.is_dir() || new_path.ends_with(std::path::MAIN_SEPARATOR) {
            let file_name = source
                .file_name()
                .ok_or_else(|| "Could not determine file name".to_string())?;
            target = target.join(file_name);
        }
        if target.exists() {
            return Err("Target file already exists".into());
        }
        let _target_canonical = ensure_target_path_allowed(&target, &roots, "move destination file")?;
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).ok();
        }
        fs::rename(&source, &target).map_err(|e| format!("Failed to move file: {}", e))?;
        let target_str = target.to_string_lossy().to_string();
        if let Err(err) = db.rename_track_path(&old_path, &target_str) {
            // Try to restore original file path if DB update fails.
            let rollback_result = fs::rename(&target, &source);
            return match rollback_result {
                Ok(()) => Err(format!(
                    "Failed to update database after move, operation rolled back: {}",
                    err
                )),
                Err(rollback_err) => Err(format!(
                    "Failed to update database after move and rollback failed (manual rescan needed). DB error: {}. Rollback error: {}",
                    err, rollback_err
                )),
            };
        }
        Ok(target_str)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn delete_files(
    file_paths: Vec<String>,
    db: tauri::State<'_, SharedDatabase>,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<usize, String> {
    let db = db.inner().clone();
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let mut deleted = 0usize;
        let roots = roots_state.read().roots.clone();
        let deletable_paths = collect_deletable_paths(&file_paths, &roots)?;

        let mut deleted_paths: Vec<String> = Vec::new();
        for (original_path, canonical_path) in deletable_paths {
            fs::remove_file(&canonical_path)
                .map_err(|e| format!("Failed to delete {}: {}", original_path, e))?;
            deleted += 1;
            deleted_paths.push(original_path);
        }

        if !deleted_paths.is_empty() {
            db.delete_tracks(&deleted_paths).map_err(|e| {
                format!(
                    "Database sync failed after deleting {} of {} requested files from disk. Please rescan the library. Details: {}",
                    deleted,
                    file_paths.len(),
                    e
                )
            })?;
        }
        Ok(deleted)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("tarab-file-ops-{}-{}", name, nonce));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn delete_prevalidation_rejects_mixed_outside_root_before_delete() {
        let allowed_root = temp_dir("allowed");
        let outside_root = temp_dir("outside");
        let allowed_file = allowed_root.join("track.mp3");
        let outside_file = outside_root.join("escape.mp3");
        fs::write(&allowed_file, b"allowed").expect("write allowed");
        fs::write(&outside_file, b"outside").expect("write outside");

        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let paths = vec![
            allowed_file.to_string_lossy().to_string(),
            outside_file.to_string_lossy().to_string(),
        ];

        let result = collect_deletable_paths(&paths, &roots);

        assert!(result.is_err());
        assert!(allowed_file.exists());
        assert!(outside_file.exists());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }

    #[test]
    fn delete_prevalidation_collects_multiple_allowed_files() {
        let allowed_root = temp_dir("multi");
        let first = allowed_root.join("a.mp3");
        let second = allowed_root.join("b.flac");
        fs::write(&first, b"a").expect("write first");
        fs::write(&second, b"b").expect("write second");

        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let paths = vec![
            first.to_string_lossy().to_string(),
            second.to_string_lossy().to_string(),
        ];

        let result = collect_deletable_paths(&paths, &roots).expect("collect allowed");
        assert_eq!(result.len(), 2);

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn target_validation_allows_new_subdirectories_inside_root() {
        let allowed_root = temp_dir("new-subdir");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let target = allowed_root.join("nested").join("album").join("song.mp3");

        let canonical = ensure_target_path_allowed(&target, &roots, "move destination file")
            .expect("target under library root");

        assert_eq!(
            canonical,
            fs::canonicalize(&allowed_root)
                .expect("canonical root")
                .join("nested")
                .join("album")
                .join("song.mp3")
        );

        let _ = fs::remove_dir_all(allowed_root);
    }

    #[test]
    fn target_validation_rejects_parent_dir_traversal() {
        let allowed_root = temp_dir("traversal-allowed");
        let outside_root = temp_dir("traversal-outside");
        let roots = vec![fs::canonicalize(&allowed_root).expect("canonical root")];
        let target = allowed_root
            .join("nested")
            .join("..")
            .join("..")
            .join(outside_root.file_name().expect("outside name"))
            .join("song.mp3");

        let result = ensure_target_path_allowed(&target, &roots, "move destination file");

        assert!(result.is_err());

        let _ = fs::remove_dir_all(allowed_root);
        let _ = fs::remove_dir_all(outside_root);
    }
}

#[tauri::command]
pub async fn reveal_in_file_manager(
    path: String,
    roots_state: tauri::State<'_, SharedLibraryRoots>,
) -> Result<(), String> {
    let roots_state = roots_state.inner().clone();
    spawn_blocking(move || {
        let p = PathBuf::from(&path);
        if !p.exists() {
            return Err("Path does not exist".to_string());
        }
        let roots = roots_state.read().roots.clone();
        let canonical = canonicalize_existing_path(&p)?;
        ensure_path_allowed(&canonical, &roots, "reveal file path")?;
        #[cfg(target_os = "macos")]
        {
            std::process::Command::new("open")
                .arg("-R")
                .arg(&p)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "windows")]
        {
            std::process::Command::new("explorer")
                .arg("/select,")
                .arg(&p)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        #[cfg(target_os = "linux")]
        {
            let dir = p
                .parent()
                .ok_or_else(|| "No parent directory".to_string())?;
            std::process::Command::new("xdg-open")
                .arg(dir)
                .status()
                .map_err(|e| format!("Failed to reveal: {}", e))?;
        }
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}
