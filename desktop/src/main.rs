//! NEONAMP desktop shell.
//!
//! A frameless native window hosting the deck served by `server.js`, using the
//! WebView2 runtime that ships with Windows — so this is one small .exe with no
//! bundled browser and no Node runtime. The server is a separate process; the
//! shell waits for it, connects, and falls back to a splash if it disappears.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod external;
mod hittest;
mod server;
mod ui;

use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder};
use tao::window::{Icon, WindowBuilder};
use wry::http::Request;
use wry::{NewWindowResponse, ScrollBarStyle, WebViewBuilder, WebViewBuilderExtWindows};

use hittest::{Edge, hit_test};

/// Deck width (476px) plus the stage's side padding.
const DEFAULT_SIZE: (f64, f64) = (520.0, 860.0);
const MIN_SIZE: (f64, f64) = (420.0, 340.0);
/// `--void`, so resizing never flashes white behind the page.
const VOID: (u8, u8, u8, u8) = (0x07, 0x04, 0x0f, 0xff);

/// Raw 64x64 RGBA from `icon/make_icon.py`, for the window and alt-tab.
/// The .ico that Explorer uses is embedded separately by `build.rs`.
const WINDOW_ICON: &[u8] = include_bytes!("../icon/window-icon.rgba");
const WINDOW_ICON_SIZE: u32 = 64;

#[derive(Debug)]
pub enum UserEvent {
    Minimize,
    ToggleMaximize,
    Close,
    /// Free drag, no hit-testing (touch).
    Drag,
    /// Left press at physical `(x, y)`; `on_titlebar` allows it to become a drag.
    Press {
        x: i32,
        y: i32,
        on_titlebar: bool,
    },
    /// Pointer moved near the frame; update the resize cursor.
    Hover {
        x: i32,
        y: i32,
    },
    ServerUp,
    ServerDown,
}

fn main() -> wry::Result<()> {
    let url = server::deck_url();
    let splash = ui::SPLASH.replace("__NEONAMP_URL__", &url);

    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let window = WindowBuilder::new()
        .with_title("NEONAMP")
        .with_window_icon(
            Icon::from_rgba(WINDOW_ICON.to_vec(), WINDOW_ICON_SIZE, WINDOW_ICON_SIZE).ok(),
        )
        .with_decorations(false)
        .with_inner_size(LogicalSize::new(DEFAULT_SIZE.0, DEFAULT_SIZE.1))
        .with_min_inner_size(LogicalSize::new(MIN_SIZE.0, MIN_SIZE.1))
        .build(&event_loop)
        .expect("failed to create window");

    let proxy = event_loop.create_proxy();
    let ipc_proxy = proxy.clone();
    let ipc = move |req: Request<String>| {
        #[cfg(debug_assertions)]
        if !req.body().starts_with("hover") {
            eprintln!("[ipc] {}", req.body());
        }

        // Handled before the split, since a URL is full of ':' and ','.
        if let Some(target) = req.body().strip_prefix("open:") {
            external::open_in_browser(target);
            return;
        }

        let mut parts = req.body().split([':', ',']);
        let event = match parts.next().unwrap_or_default() {
            "minimize" => UserEvent::Minimize,
            "maximize" => UserEvent::ToggleMaximize,
            "close" => UserEvent::Close,
            "drag" => UserEvent::Drag,
            "press" => match read_point(&mut parts) {
                Some((x, y)) => UserEvent::Press {
                    x,
                    y,
                    on_titlebar: parts.next() == Some("1"),
                },
                None => return,
            },
            "hover" => match read_point(&mut parts) {
                Some((x, y)) => UserEvent::Hover { x, y },
                None => return,
            },
            _ => return,
        };
        let _ = ipc_proxy.send_event(event);
    };

    // Belt and braces behind the script's window.open override: catches
    // target="_blank", plain link clicks and any location assignment the page
    // makes, so nothing but the deck can ever take over the shell window.
    let nav_deck = url.clone();
    let webview = WebViewBuilder::new()
        .with_html(&splash)
        .with_initialization_script(ui::INIT_SCRIPT)
        .with_ipc_handler(ipc)
        .with_navigation_handler(move |target| {
            if external::is_deck_page(&target, &nav_deck) {
                return true;
            }
            external::open_in_browser(&target);
            false
        })
        .with_new_window_req_handler(|target, _| {
            external::open_in_browser(&target);
            NewWindowResponse::Deny
        })
        .with_background_color(VOID)
        .with_accept_first_mouse(true)
        .with_devtools(cfg!(debug_assertions))
        // A classic scrollbar gutter reads as "browser"; overlay it instead.
        .with_scroll_bar_style(ScrollBarStyle::FluentOverlay)
        .build(&window)?;

    server::spawn_watcher(server::authority(&url), proxy);

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            }
            | Event::UserEvent(UserEvent::Close) => *control_flow = ControlFlow::Exit,

            Event::UserEvent(UserEvent::Minimize) => window.set_minimized(true),
            Event::UserEvent(UserEvent::ToggleMaximize) => {
                window.set_maximized(!window.is_maximized())
            }
            Event::UserEvent(UserEvent::Drag) => {
                let _ = window.drag_window();
            }

            Event::UserEvent(UserEvent::Press { x, y, on_titlebar }) => {
                // Resizing beats dragging, so the top edge of the titlebar is
                // still a resize handle rather than a dead strip.
                match hit_test(window.inner_size(), x, y, window.scale_factor()) {
                    Edge::None if on_titlebar => {
                        let _ = window.drag_window();
                    }
                    Edge::None => {}
                    edge => edge.begin_resize(&window),
                }
            }

            Event::UserEvent(UserEvent::Hover { x, y }) => {
                hit_test(window.inner_size(), x, y, window.scale_factor()).apply_cursor(&window);
            }

            Event::UserEvent(UserEvent::ServerUp) => {
                let _ = webview.load_url(&url);
            }
            Event::UserEvent(UserEvent::ServerDown) => {
                let _ = webview.load_html(&splash);
            }

            _ => {}
        }
    });
}

fn read_point<'a>(parts: &mut impl Iterator<Item = &'a str>) -> Option<(i32, i32)> {
    let x = parts.next()?.parse().ok()?;
    let y = parts.next()?.parse().ok()?;
    Some((x, y))
}
