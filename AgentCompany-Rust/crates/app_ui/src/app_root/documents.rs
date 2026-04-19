use super::*;

impl AppRoot {
    pub(super) fn render_documents(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_document_id
            .as_ref()
            .and_then(|id| self.snapshot.documents.iter().find(|item| &item.id == id));

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_start()
                    .child(
                        div()
                            .child(
                                div()
                                    .text_2xl()
                                    .text_color(theme::text_primary())
                                    .child("Document Center"),
                            )
                            .child(
                                div()
                                    .mt(px(6.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!("{} items", self.snapshot.documents.len())),
                            ),
                    )
                    .child(primary_button("Save draft", cx, |this, cx| {
                        this.create_document(cx)
                    })),
            )
            .child(div().h(px(1.0)).bg(theme::panel_border()))
            .when(self.snapshot.documents.is_empty(), |container| {
                container.child(
                    div()
                        .py_8()
                        .text_base()
                        .text_color(theme::text_muted())
                        .child("No documents have been created yet."),
                )
            })
            .when(!self.snapshot.documents.is_empty(), |container| {
                container.child(div().id("documents-list").children(
                    self.snapshot.documents.iter().map(|item| {
                        let active =
                            self.state.selected_document_id.as_deref() == Some(item.id.as_str());
                        let document_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("document-{}", item.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_6()
                            .py_5()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::window_bg()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_document_id = Some(document_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex_1()
                                    .child(
                                        div()
                                            .text_base()
                                            .text_color(theme::text_primary())
                                            .truncate()
                                            .child(item.title.clone()),
                                    )
                                    .child(
                                        div()
                                            .mt(px(8.0))
                                            .text_sm()
                                            .text_color(theme::text_muted())
                                            .child(format!(
                                                "{} · v{} · {}",
                                                item.document_type.replace('_', " "),
                                                item.version,
                                                short_date(item.updated_at.as_str())
                                            )),
                                    ),
                            )
                            .child(document_status(item.status.as_str()))
                    }),
                ))
            })
            .child(div().h(px(1.0)).bg(theme::panel_border()))
            .child(
                div()
                    .gap_4()
                    .child(
                        div().text_lg().text_color(theme::text_primary()).child(
                            selected
                                .map(|item| item.title.clone())
                                .unwrap_or_else(|| "Quick draft".to_string()),
                        ),
                    )
                    .child(self.document_title_input.clone())
                    .child(self.document_body_input.clone())
                    .when_some(selected, |container, item| {
                        container.child(
                            div()
                                .p_4()
                                .rounded_lg()
                                .border_1()
                                .border_color(theme::panel_inset_border())
                                .bg(theme::panel_inset())
                                .child(item.content.clone()),
                        )
                    }),
            )
    }
}

fn document_status(status: &str) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap_2()
        .child(
            div()
                .w(px(8.0))
                .h(px(8.0))
                .rounded_full()
                .bg(theme::badge_dark()),
        )
        .child(
            div()
                .text_xs()
                .text_color(theme::text_secondary())
                .child(status.to_uppercase()),
        )
}

fn short_date(value: &str) -> &str {
    value.get(..10).unwrap_or(value)
}
