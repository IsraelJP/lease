// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // GTK's keep-above hint is ignored by KWin (and other compositors) when
    // Tauri runs as a native Wayland client. XWayland preserves KWin's
    // always-on-top support, which the optional Pomodoro pin relies on.
    #[cfg(target_os = "linux")]
    {
        let is_wayland = std::env::var("XDG_SESSION_TYPE")
            .map(|session| session.eq_ignore_ascii_case("wayland"))
            .unwrap_or(false);
        let xwayland_available = std::env::var_os("DISPLAY").is_some();
        let prefer_native_wayland = std::env::var("LEASE_NATIVE_WAYLAND")
            .map(|value| value == "1")
            .unwrap_or(false);

        if is_wayland && xwayland_available && !prefer_native_wayland {
            std::env::set_var("GDK_BACKEND", "x11");
        }
    }

    lease_lib::run()
}
