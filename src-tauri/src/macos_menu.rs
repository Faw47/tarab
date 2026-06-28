#[cfg(target_os = "macos")]
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder, SubmenuBuilder},
    App, Emitter, Runtime,
};

#[cfg(target_os = "macos")]
pub fn build_menu<R: Runtime>(app: &App<R>) -> tauri::Result<()> {
    let pkg_info = app.package_info();
    let app_name = &pkg_info.name;

    let app_menu = SubmenuBuilder::new(app, app_name)
        .about(None)
        .separator()
        .hide()
        .hide_others()
        .separator()
        // TODO: The frontend must listen for the "menu-quit" event and call process.exit() after flushing state.
        .item(
            &MenuItemBuilder::with_id("quit", format!("Quit {}", app_name))
                .accelerator("Cmd+Q")
                .build(app)?,
        )
        .build()?;

    let edit_menu = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize() // Zoom is replaced by Maximize in some 2.0 APIs or we use custom
        .separator()
        .close_window()
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[&app_menu, &edit_menu, &window_menu])
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        if event.id() == "quit" {
            let _ = app.emit("menu-quit", ());
        }
    });

    Ok(())
}
