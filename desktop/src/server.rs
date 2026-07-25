//! Finds the NEONAMP server and keeps watching it.
//!
//! The shell owns no server process — it just waits for one to answer on the
//! deck's port, and drops back to the splash if that server goes away.

use std::net::{TcpStream, ToSocketAddrs};
use std::thread;
use std::time::Duration;

use tao::event_loop::EventLoopProxy;

use crate::UserEvent;

const DEFAULT_URL: &str = "http://127.0.0.1:3090/";

/// Deck URL, from `neonamp-desktop <url>`, then `NEONAMP_URL`, then the default.
pub fn deck_url() -> String {
    let from_arg = std::env::args().nth(1).filter(|a| !a.starts_with('-'));
    let raw = from_arg
        .or_else(|| std::env::var("NEONAMP_URL").ok())
        .unwrap_or_else(|| DEFAULT_URL.to_string());
    let raw = raw.trim().to_string();

    if raw.contains("://") {
        raw
    } else {
        format!("http://{raw}")
    }
}

/// `host:port` to probe, defaulting the port from the scheme.
pub fn authority(url: &str) -> String {
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or(url);
    let host = rest.split('/').next().unwrap_or(rest);

    if host
        .rsplit(':')
        .next()
        .is_some_and(|p| p.parse::<u16>().is_ok())
    {
        host.to_string()
    } else if url.starts_with("https") {
        format!("{host}:443")
    } else {
        format!("{host}:80")
    }
}

/// True when something is listening. A completed TCP handshake is enough —
/// the deck is the only thing that ever holds this port.
fn is_listening(authority: &str) -> bool {
    let Ok(addrs) = authority.to_socket_addrs() else {
        return false;
    };
    addrs
        .into_iter()
        .any(|addr| TcpStream::connect_timeout(&addr, Duration::from_millis(500)).is_ok())
}

/// Polls `authority` forever, reporting only the transitions.
///
/// Going down needs [`MISSES_BEFORE_DOWN`] consecutive failures so a server
/// restart doesn't flap the window back to the splash for one frame.
pub fn spawn_watcher(authority: String, proxy: EventLoopProxy<UserEvent>) {
    const MISSES_BEFORE_DOWN: u32 = 3;

    thread::spawn(move || {
        let mut up = false;
        let mut misses = 0;

        loop {
            if is_listening(&authority) {
                misses = 0;
                if !up {
                    up = true;
                    if proxy.send_event(UserEvent::ServerUp).is_err() {
                        return; // event loop is gone; so are we
                    }
                }
            } else {
                misses += 1;
                if up && misses >= MISSES_BEFORE_DOWN {
                    up = false;
                    if proxy.send_event(UserEvent::ServerDown).is_err() {
                        return;
                    }
                }
            }

            // Poll eagerly while waiting, lazily once we're connected.
            thread::sleep(Duration::from_millis(if up { 2000 } else { 600 }));
        }
    });
}
