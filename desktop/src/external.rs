//! Deciding what stays in the shell and what belongs in a browser.
//!
//! The shell window is the deck and nothing else. The playlist manager, OBS
//! overlay and Twitch console are full pages that want room and a URL bar, and
//! they drive the deck over the server's `/ws` rather than through the window
//! that opened them — so handing them to the default browser costs nothing.

use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};

/// Keeps the helper from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Opens `url` in whatever the user's default browser is.
pub fn open_in_browser(url: &str) {
    // Only ever hand off http(s). Page content must not be able to talk the
    // shell into launching arbitrary protocol handlers.
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }

    // rundll32 rather than `cmd /c start`, which treats the `&` in a query
    // string as a command separator and would truncate the playlist name.
    let _ = Command::new("rundll32.exe")
        .arg("url.dll,FileProtocolHandler")
        .arg(url)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();
}

/// Splits `scheme://authority/path?query` into its authority and path.
fn authority_and_path(url: &str) -> Option<(&str, &str)> {
    let (_scheme, rest) = url.split_once("://")?;
    let cut = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (authority, tail) = rest.split_at(cut);
    let path = tail.split(['?', '#']).next().unwrap_or("");
    Some((authority, path))
}

/// Whether `url` is the deck itself, and so should load in the shell window.
pub fn is_deck_page(url: &str, deck: &str) -> bool {
    // The splash goes through NavigateToString, which lands on about:blank.
    // blob/data URLs are generated content — M3U exports and the like — and
    // are never a navigation away from the deck.
    if url.starts_with("about:") || url.starts_with("data:") || url.starts_with("blob:") {
        return true;
    }

    match (authority_and_path(url), authority_and_path(deck)) {
        (Some((authority, path)), Some((deck_authority, _))) => {
            authority.eq_ignore_ascii_case(deck_authority)
                && matches!(path, "" | "/" | "/index.html")
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::is_deck_page;

    const DECK: &str = "http://127.0.0.1:3090/";

    #[test]
    fn deck_itself_stays_in_the_shell() {
        assert!(is_deck_page("http://127.0.0.1:3090/", DECK));
        assert!(is_deck_page("http://127.0.0.1:3090", DECK));
        assert!(is_deck_page("http://127.0.0.1:3090/index.html", DECK));
        assert!(is_deck_page("http://127.0.0.1:3090/?resume=1", DECK));
        assert!(is_deck_page("http://127.0.0.1:3090/#deck", DECK));
    }

    #[test]
    fn splash_and_generated_content_stay() {
        assert!(is_deck_page("about:blank", DECK));
        assert!(is_deck_page("blob:http://127.0.0.1:3090/abcd", DECK));
    }

    #[test]
    fn other_server_pages_go_to_the_browser() {
        assert!(!is_deck_page("http://127.0.0.1:3090/playlist", DECK));
        assert!(!is_deck_page(
            "http://127.0.0.1:3090/playlist?name=Soaking&track=2",
            DECK
        ));
        assert!(!is_deck_page("http://127.0.0.1:3090/obs", DECK));
        assert!(!is_deck_page("http://127.0.0.1:3090/twitch", DECK));
    }

    #[test]
    fn anywhere_else_goes_to_the_browser() {
        assert!(!is_deck_page("https://twitch.tv/", DECK));
        // Same host, different port is a different server.
        assert!(!is_deck_page("http://127.0.0.1:4000/", DECK));
    }
}
