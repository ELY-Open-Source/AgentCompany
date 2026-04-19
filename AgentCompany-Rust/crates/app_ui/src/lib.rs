mod app_root;
mod theme;
mod widgets;

use app_root::AppRoot;
use domain::ProfileSnapshot;
use gpui::{App, AppContext, Application, Bounds, WindowBounds, WindowOptions, px, size};
use parking_lot::Mutex;
use std::sync::Arc;
use storage::ProfileStore;
use widgets::text_input::bind_text_input_keys;

pub type SharedStore = Arc<Mutex<ProfileStore>>;

pub fn launch(store: SharedStore, snapshot: ProfileSnapshot) {
    Application::new().run(move |cx: &mut App| {
        bind_text_input_keys(cx);
        let store = store.clone();
        let snapshot = snapshot.clone();
        let bounds = Bounds::centered(None, size(px(1380.0), px(920.0)), cx);
        let Ok(window) = cx.open_window(
            WindowOptions {
                window_bounds: Some(WindowBounds::Windowed(bounds)),
                ..Default::default()
            },
            move |_, cx| cx.new(|cx| AppRoot::new(store.clone(), snapshot.clone(), cx)),
        ) else {
            cx.quit();
            return;
        };
        window
            .update(cx, |_, window, cx| {
                cx.activate(true);
                window.activate_window();
            })
            .ok();
    });
}
