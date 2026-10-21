const MACOS_MEDIA: &str = include_str!("../vendor/tauri-plugin-media/src/platform/macos.rs");

fn method_body<'a>(source: &'a str, name: &str) -> &'a str {
    let signature = format!("    fn {name}(");
    let start = source.find(&signature).expect("method signature");
    let method = &source[start..];
    let next_method = method.find("\n    fn ").filter(|offset| *offset > 0);
    let next_unsafe_method = method.find("\n    unsafe fn ").filter(|offset| *offset > 0);
    let end = match (next_method, next_unsafe_method) {
        (Some(left), Some(right)) => left.min(right),
        (Some(offset), None) | (None, Some(offset)) => offset,
        (None, None) => method.len(),
    };
    &method[..end]
}

#[test]
fn every_objective_c_entry_point_drains_a_scoped_autorelease_pool() {
    for name in [
        "setup_command_handlers",
        "set_metadata",
        "set_playback_info",
        "set_playback_status",
        "set_position",
        "clear_metadata",
        "get_metadata",
    ] {
        assert!(
            method_body(MACOS_MEDIA, name).contains("AutoreleasePoolGuard::new()"),
            "{name} must drain autoreleased Foundation objects before returning"
        );
    }
}

#[test]
fn owned_objective_c_allocations_use_raii_and_mutable_copies_are_released() {
    assert_eq!(
        MACOS_MEDIA.matches("NSString::alloc(nil).init_str(").count(),
        1,
        "alloc/init must be centralized in the ownership helper"
    );
    let string_helper = MACOS_MEDIA
        .find("unsafe fn autoreleased_nsstring(")
        .map(|start| &MACOS_MEDIA[start..])
        .expect("autoreleased NSString helper");
    assert!(
        string_helper.contains("StrongPtr::new")
            && string_helper.contains(".autorelease()"),
        "the +1 NSString allocation must transfer to the current autorelease pool"
    );
    assert_eq!(
        MACOS_MEDIA.matches("mutableCopy").count(),
        1,
        "mutable copies must be centralized so each +1 result has an owner"
    );
    let copy_helper = MACOS_MEDIA
        .find("unsafe fn mutable_copy(")
        .map(|start| &MACOS_MEDIA[start..])
        .expect("mutable-copy helper");
    assert!(
        copy_helper.contains("StrongPtr::new(copy)"),
        "mutableCopy's +1 result must be released by StrongPtr"
    );
}
