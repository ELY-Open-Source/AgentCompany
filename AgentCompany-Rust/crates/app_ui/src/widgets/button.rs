use gpui::{Context, SharedString, Window, div, prelude::*, rgb};

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
        .bg(rgb(0x9e3d2d))
        .text_color(rgb(0xfff7f0))
        .hover(|style| style.bg(rgb(0xb24f3e)))
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
        .bg(rgb(0xfffbf5))
        .border_1()
        .border_color(rgb(0xd9cdbf))
        .text_color(rgb(0x171411))
        .hover(|style| style.bg(rgb(0xf4ede4)))
        .on_click(
            cx.listener(move |this, _: &gpui::ClickEvent, _: &mut Window, cx| on_click(this, cx)),
        )
        .child(label)
}
