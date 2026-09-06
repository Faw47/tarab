use tauri::{Runtime, Window};
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::Shell::{ITaskbarList3, TaskbarList, TBPF_NOPROGRESS, TBPF_NORMAL};

/// Sets the progress bar value and state for the taskbar icon.
///
/// # Safety
/// This function calls Win32 COM APIs and must be called within an initialized COM context.
pub unsafe fn set_taskbar_progress(hwnd_raw: isize, value: u64, total: u64) -> Result<(), String> {
    let hwnd = HWND(hwnd_raw as *mut _);

    // Initialize COM if necessary.
    // Note: Tauri/Wry might already have initialized COM on the main thread,
    // but CoInitializeEx is reference-counted and safe to call multiple times.
    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)
        .map_err(|e| format!("Failed to create ITaskbarList3: {}", e))?;

    taskbar
        .HrInit()
        .map_err(|e| format!("ITaskbarList3::HrInit failed: {}", e))?;

    taskbar
        .SetProgressState(hwnd, TBPF_NORMAL)
        .map_err(|e| format!("ITaskbarList3::SetProgressState failed: {}", e))?;

    taskbar
        .SetProgressValue(hwnd, value, total)
        .map_err(|e| format!("ITaskbarList3::SetProgressValue failed: {}", e))?;

    Ok(())
}

/// Clears the progress bar from the taskbar icon.
///
/// # Safety
/// This function calls Win32 COM APIs.
pub unsafe fn clear_taskbar_progress(hwnd_raw: isize) -> Result<(), String> {
    let hwnd = HWND(hwnd_raw as *mut _);

    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);

    let taskbar: ITaskbarList3 = CoCreateInstance(&TaskbarList, None, CLSCTX_ALL)
        .map_err(|e| format!("Failed to create ITaskbarList3: {}", e))?;

    taskbar
        .HrInit()
        .map_err(|e| format!("ITaskbarList3::HrInit failed: {}", e))?;

    taskbar
        .SetProgressState(hwnd, TBPF_NOPROGRESS)
        .map_err(|e| format!("ITaskbarList3::SetProgressState failed: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn update_progress<R: Runtime>(
    window: Window<R>,
    value: u64,
    total: u64,
) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    unsafe { set_taskbar_progress(hwnd, value, total) }
}

#[tauri::command]
pub fn clear_progress<R: Runtime>(window: Window<R>) -> Result<(), String> {
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    unsafe { clear_taskbar_progress(hwnd) }
}
