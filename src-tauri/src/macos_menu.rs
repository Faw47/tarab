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
        .item(
            &MenuItemBuilder::with_id("settings", "Settings…")
                .accelerator("Cmd+,")
                .build(app)?,
        )
        .separator()
        .hide()
        .hide_others()
        .separator()
        .item(
            &MenuItemBuilder::with_id("quit", format!("Quit {}", app_name))
                .accelerator("Cmd+Q")
                .build(app)?,
        )
        .build()?;

    let file_menu = SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id("file.add-folder", "Add Folder…")
                .accelerator("Cmd+Shift+O")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("file.import", "Import Audio Files…")
                .accelerator("Cmd+O")
                .build(app)?,
        )
        .separator()
        .item(
            &MenuItemBuilder::with_id("file.new-playlist", "New Playlist")
                .accelerator("Cmd+N")
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
        .separator()
        .item(
            &MenuItemBuilder::with_id("find", "Find")
                .accelerator("Cmd+F")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("command-palette", "Command Palette")
                .accelerator("Cmd+K")
                .build(app)?,
        )
        .build()?;

    let playback_menu = SubmenuBuilder::new(app, "Playback")
        .item(&MenuItemBuilder::with_id("playback.toggle", "Play or Pause").build(app)?)
        .item(
            &MenuItemBuilder::with_id("playback.previous", "Previous")
                .accelerator("Cmd+Left")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("playback.next", "Next")
                .accelerator("Cmd+Right")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("playback.seek-backward", "Seek Backward 10 Seconds")
                .accelerator("Cmd+Shift+Left")
                .build(app)?,
        )
        .item(
            &MenuItemBuilder::with_id("playback.seek-forward", "Seek Forward 10 Seconds")
                .accelerator("Cmd+Shift+Right")
                .build(app)?,
        )
        .separator()
        .item(&MenuItemBuilder::with_id("playback.shuffle", "Toggle Shuffle").build(app)?)
        .item(&MenuItemBuilder::with_id("playback.repeat", "Cycle Repeat").build(app)?)
        .build()?;

    let view_menu = SubmenuBuilder::new(app, "View")
        .item(&MenuItemBuilder::with_id("view.home", "Home").build(app)?)
        .item(&MenuItemBuilder::with_id("view.library", "Songs").build(app)?)
        .item(&MenuItemBuilder::with_id("view.albums", "Albums").build(app)?)
        .item(&MenuItemBuilder::with_id("view.artists", "Artists").build(app)?)
        .item(&MenuItemBuilder::with_id("view.playlists", "Playlists").build(app)?)
        .item(&MenuItemBuilder::with_id("view.queue", "Queue").build(app)?)
        .separator()
        .item(
            &MenuItemBuilder::with_id("view.full-player", "Full Player")
                .accelerator("Cmd+Shift+F")
                .build(app)?,
        )
        .build()?;

    let window_menu = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize() // Zoom is replaced by Maximize in some 2.0 APIs or we use custom
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(app, "Help")
        .item(&MenuItemBuilder::with_id("help.help", "Tarab Help").build(app)?)
        .item(&MenuItemBuilder::with_id("help.diagnostics", "Diagnostics").build(app)?)
        .build()?;

    let menu = MenuBuilder::new(app)
        .items(&[
            &app_menu,
            &file_menu,
            &edit_menu,
            &playback_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ])
        .build()?;

    app.set_menu(menu)?;

    app.on_menu_event(move |app, event| {
        let id = event.id().as_ref();
        if id == "quit" {
            let _ = app.emit_to("main", "menu-quit", ());
        } else if let Some(action) = id.strip_prefix("playback.") {
            let payload = match action {
                "toggle" => "toggle-play",
                "previous" => "previous",
                "next" => "next",
                "shuffle" => "toggle-shuffle",
                "repeat" => "cycle-repeat",
                _ => {
                    let _ = app.emit_to("main", "native-menu-action", id);
                    return;
                }
            };
            let _ = app.emit_to("main", "desktop-control-action", payload);
        } else {
            let _ = app.emit_to("main", "native-menu-action", id);
        }
    });

    Ok(())
}
