mod capture;
mod i18n;
mod input;
mod menu;
mod permissions;

use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use capture::Display;
use input::Input;
use menu::Status;
use permissions::Permissions;
use tauri::ipc::Response;
use tauri::tray::TrayIconBuilder;
use tauri::{Emitter, Manager, State, WindowEvent};
use tauri_plugin_opener::OpenerExt;

const TRAY_ID: &str = "remote";
const ISSUES_URL: &str = "https://github.com/RUNNERS-IM/remote/issues";
const STATUS_EVERY: Duration = Duration::from_secs(2);
// Why: the window asks for a picture about every 200 ms, so a gap longer than this means nobody is looking any more.
const VIEWING_GAP: Duration = Duration::from_millis(1500);

/// This computer's name as the user set it in System Settings, e.g. "RUNNERS Mac Studio".
struct ComputerName(String);

/// When the last picture was taken, for the "viewing" status line.
#[derive(Default)]
struct LastCapture(Mutex<Option<Instant>>);

/// The "Send clicks (test)" switch in the window. Off at launch, and every click or key is refused while it is off.
#[derive(Default)]
struct InputTest(AtomicBool);

fn computer_name() -> String {
    #[cfg(target_os = "macos")]
    if let Some(name) = Command::new("scutil")
        .args(["--get", "ComputerName"])
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
        .filter(|name| !name.is_empty())
    {
        return name;
    }
    Command::new("hostname")
        .output()
        .ok()
        .map(|out| String::from_utf8_lossy(&out.stdout).trim().trim_end_matches(".local").to_owned())
        .unwrap_or_default()
}

#[tauri::command]
fn computer(name: State<'_, ComputerName>) -> String {
    name.0.clone()
}

/// Runs on the main thread (a plain, non-async command), which AppKit needs to read display names.
#[tauri::command]
fn displays() -> Vec<Display> {
    capture::displays()
}

/// One JPEG picture of a display, sent to the page as raw bytes rather than a JSON number list.
#[tauri::command]
async fn capture(display: u32, last: State<'_, LastCapture>) -> Result<Response, String> {
    let jpeg = tauri::async_runtime::spawn_blocking(move || capture::capture_jpeg(display))
        .await
        .map_err(|e| e.to_string())??;
    *last.0.lock().unwrap() = Some(Instant::now());
    Ok(Response::new(jpeg))
}

#[tauri::command]
fn permissions() -> Permissions {
    permissions::current()
}

/// Shows the system prompt for a permission, and opens its System Settings page when the prompt no longer appears.
#[tauri::command]
fn request_permission(app: tauri::AppHandle, kind: String) -> Result<bool, String> {
    let (granted, page) = match kind.as_str() {
        "screenRecording" => (permissions::request_screen_recording(), permissions::SCREEN_RECORDING_SETTINGS),
        "accessibility" => (permissions::request_accessibility(), permissions::ACCESSIBILITY_SETTINGS),
        _ => return Err(format!("unknown permission {kind}")),
    };
    if !granted {
        // Why: macOS shows each prompt only once per app; after that the switch is only in System Settings.
        app.opener().open_url(page, None::<&str>).map_err(|e| e.to_string())?;
    }
    Ok(granted)
}

#[tauri::command]
fn set_input_test(on: bool, test: State<'_, InputTest>) {
    test.0.store(on, Ordering::SeqCst);
}

/// Posts a click or key into this Mac. Refused unless the window's test switch is on and Accessibility is allowed.
#[tauri::command]
fn send_input(input: Input, test: State<'_, InputTest>) -> Result<(), String> {
    if !test.0.load(Ordering::SeqCst) {
        return Err("off".into());
    }
    if !permissions::current().accessibility {
        return Err("accessibility".into());
    }
    input::send(&input)
}

fn open_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    menu::activate();
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
    let _ = window.emit("window-shown", ());
}

fn status(app: &tauri::AppHandle) -> Status {
    if !permissions::current().screen_recording {
        return Status::Off;
    }
    let last = *app.state::<LastCapture>().0.lock().unwrap();
    if last.is_some_and(|at| at.elapsed() < VIEWING_GAP) { Status::Viewing } else { Status::Waiting }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(LastCapture::default())
        .manage(InputTest::default())
        .invoke_handler(tauri::generate_handler![
            computer,
            displays,
            capture,
            permissions,
            request_permission,
            set_input_test,
            send_input
        ])
        .setup(|app| {
            // Why: Remote lives in the menu bar, so it should not take a Dock slot on macOS.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let name = computer_name();
            app.manage(ComputerName(name.clone()));

            let menu = menu::build(app, &name)?;
            let tray = TrayIconBuilder::with_id(TRAY_ID);
            #[cfg(target_os = "macos")]
            let tray = tray.icon(tauri::include_image!("icons/tray.png")).icon_as_template(true);
            #[cfg(not(target_os = "macos"))]
            let tray = tray.icon(app.default_window_icon().unwrap().clone());
            tray.tooltip("Remote")
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => open_window(app),
                    #[cfg(target_os = "macos")]
                    "about" => menu::show_about(app),
                    "help" => {
                        let _ = app.opener().open_url(ISSUES_URL, None::<&str>);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                menu::show_status(&handle, &name, status(&handle));
                // Why: a backup for the ThemeChanged event, which a hidden window may not get on every OS.
                menu::follow_theme(&handle);
                std::thread::sleep(STATUS_EVERY);
            });
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::ThemeChanged(_) => menu::follow_theme(window.app_handle()),
            // Why: closing the window only hides it; Remote keeps running in the menu bar until Quit.
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
                let _ = window.emit("window-hidden", ());
                // Why: a hidden window must never keep clicking, so the test switch turns off with it.
                window.state::<InputTest>().0.store(false, Ordering::SeqCst);
            }
            _ => {}
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
