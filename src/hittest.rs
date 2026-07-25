//! Edge hit-testing for the undecorated window.
//!
//! With no OS frame there is no resize border, so the page reports pointer
//! positions and we decide whether they land on an edge. Coordinates arrive
//! already scaled to physical pixels by the page script.

use tao::dpi::PhysicalSize;
use tao::window::{CursorIcon, ResizeDirection, Window};

/// Width of the invisible resize band, in physical pixels at 100% scale.
const RESIZE_INSET: f64 = 6.0;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    None,
    Left,
    Right,
    Top,
    Bottom,
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

impl Edge {
    pub fn direction(self) -> Option<ResizeDirection> {
        Some(match self {
            Edge::Left => ResizeDirection::West,
            Edge::Right => ResizeDirection::East,
            Edge::Top => ResizeDirection::North,
            Edge::Bottom => ResizeDirection::South,
            Edge::TopLeft => ResizeDirection::NorthWest,
            Edge::TopRight => ResizeDirection::NorthEast,
            Edge::BottomLeft => ResizeDirection::SouthWest,
            Edge::BottomRight => ResizeDirection::SouthEast,
            Edge::None => return None,
        })
    }

    pub fn cursor(self) -> CursorIcon {
        match self {
            Edge::Left => CursorIcon::WResize,
            Edge::Right => CursorIcon::EResize,
            Edge::Top => CursorIcon::NResize,
            Edge::Bottom => CursorIcon::SResize,
            Edge::TopLeft => CursorIcon::NwResize,
            Edge::TopRight => CursorIcon::NeResize,
            Edge::BottomLeft => CursorIcon::SwResize,
            Edge::BottomRight => CursorIcon::SeResize,
            Edge::None => CursorIcon::Default,
        }
    }

    pub fn begin_resize(self, window: &Window) {
        if let Some(dir) = self.direction() {
            let _ = window.drag_resize_window(dir);
        }
    }

    pub fn apply_cursor(self, window: &Window) {
        window.set_cursor_icon(self.cursor());
    }
}

/// Which edge, if any, `(x, y)` sits on. Physical pixels, window-relative.
pub fn hit_test(size: PhysicalSize<u32>, x: i32, y: i32, scale: f64) -> Edge {
    let inset = (RESIZE_INSET * scale) as i32;
    let (right, bottom) = (size.width as i32, size.height as i32);

    let left_edge = x < inset;
    let right_edge = x >= right - inset;
    let top_edge = y < inset;
    let bottom_edge = y >= bottom - inset;

    match (left_edge, right_edge, top_edge, bottom_edge) {
        (true, _, true, _) => Edge::TopLeft,
        (_, true, true, _) => Edge::TopRight,
        (true, _, _, true) => Edge::BottomLeft,
        (_, true, _, true) => Edge::BottomRight,
        (true, ..) => Edge::Left,
        (_, true, ..) => Edge::Right,
        (_, _, true, _) => Edge::Top,
        (_, _, _, true) => Edge::Bottom,
        _ => Edge::None,
    }
}
