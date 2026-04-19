use crate::theme;
use gpui::{Context, SharedString, Window, div, prelude::*};

pub fn primary_button<V>(
    label: &'static str,
    cx: &mut Context<V>,
    on_click: impl Fn(&mut V, &mut Context<V>) + 'static,
) -> impl IntoElement
where
    V: 'static,
{
    div()
        .id(SharedString::from(format!("primary-button-{label}")))
        .px_3()
        .py_2()
        .rounded_md()
        .cursor_pointer()
        .bg(theme::primary_action())
        .text_color(theme::primary_action_text())
        .hover(|style| style.bg(theme::primary_action_hover()))
        .on_click(
            cx.listener(move |this, _: &gpui::ClickEvent, _: &mut Window, cx| on_click(this, cx)),
        )
        .child(label)
}

pub fn secondary_button<V>(
    label: &'static str,
    cx: &mut Context<V>,
    on_click: impl Fn(&mut V, &mut Context<V>) + 'static,
) -> impl IntoElement
where
    V: 'static,
{
    div()
        .id(SharedString::from(format!("secondary-button-{label}")))
        .px_3()
        .py_2()
        .rounded_md()
        .cursor_pointer()
        .bg(theme::panel())
        .border_1()
        .border_color(theme::panel_border())
        .text_color(theme::text_primary())
        .hover(|style| style.bg(theme::panel_hover()))
        .on_click(
            cx.listener(move |this, _: &gpui::ClickEvent, _: &mut Window, cx| on_click(this, cx)),
        )
        .child(label)
}
