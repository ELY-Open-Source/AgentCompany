use super::*;

impl AppRoot {
    pub(super) fn render_documents(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_document_id
            .as_ref()
            .and_then(|id| self.snapshot.documents.iter().find(|item| &item.id == id));
        let work_products = self.snapshot.artifacts.iter().take(12).collect::<Vec<_>>();
        let total_count = self.snapshot.documents.len() + work_products.len();

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(render_document_header(total_count, cx))
            .child(
                div()
                    .grid()
                    .grid_cols(2)
                    .gap_4()
                    .child(
                        div()
                            .gap_4()
                            .child(document_section_label("DOCUMENTS PROSE"))
                            .child(self.render_document_prose_list(cx, selected))
                            .when(!work_products.is_empty(), |container| {
                                container
                                    .child(document_section_label("WORK PRODUCTS"))
                                    .child(render_work_products(work_products.as_slice()))
                            }),
                    )
                    .child(self.render_document_editor_surface(selected)),
            )
    }

    fn render_document_prose_list(
        &self,
        cx: &mut Context<Self>,
        selected: Option<&domain::Document>,
    ) -> impl IntoElement + '_ {
        div()
            .rounded(px(0.0))
            .border_1()
            .border_color(theme::panel_border())
            .bg(theme::panel())
            .when(self.snapshot.documents.is_empty(), |container| {
                container.child(
                    div()
                        .min_h(px(180.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme::text_muted())
                        .child("No documents yet. Create the first company document to start the knowledge base."),
                )
            })
            .when(!self.snapshot.documents.is_empty(), |container| {
                container.children(self.snapshot.documents.iter().map(|document| {
                    let active =
                        selected.map(|item| item.id.as_str()) == Some(document.id.as_str());
                    let document_id = document.id.clone();
                    div()
                        .id(SharedString::from(format!("document-{}", document.id)))
                        .cursor_pointer()
                        .hover(|style| style.bg(theme::panel_hover()))
                        .bg(if active {
                            theme::selection_fill()
                        } else {
                            theme::panel()
                        })
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.state.selected_document_id = Some(document_id.clone());
                            cx.notify();
                        }))
                        .px_5()
                        .py_4()
                        .border_b_1()
                        .border_color(theme::panel_border())
                        .child(
                            div()
                                .flex()
                                .justify_between()
                                .items_center()
                                .gap_3()
                                .child(
                                    div()
                                        .flex_1()
                                        .child(
                                            div()
                                                .text_sm()
                                                .text_color(theme::text_primary())
                                                .child(document.title.clone()),
                                        )
                                        .child(
                                            div()
                                                .mt(px(4.0))
                                                .text_xs()
                                                .text_color(theme::text_muted())
                                                .child(format!(
                                                    "{} · v{} · {}",
                                                    document.document_type.replace('_', " "),
                                                    document.version,
                                                    short_date(document.updated_at.as_str())
                                                )),
                                        ),
                                )
                                .child(document_status(document.status.as_str())),
                        )
                }))
            })
    }

    fn render_document_editor_surface(
        &self,
        selected: Option<&domain::Document>,
    ) -> impl IntoElement + '_ {
        div()
            .rounded(px(0.0))
            .border_1()
            .border_color(theme::panel_border())
            .bg(theme::panel())
            .p_5()
            .child(
                div().text_lg().text_color(theme::text_primary()).child(
                    selected
                        .map(|item| item.title.clone())
                        .unwrap_or_else(|| "New document".to_string()),
                ),
            )
            .when_some(selected, |container, document| {
                container
                    .child(
                        div()
                            .mt(px(8.0))
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} · v{} · {}",
                                document.document_type.replace('_', " "),
                                document.version,
                                document.status
                            )),
                    )
                    .child(
                        div()
                            .mt(px(16.0))
                            .rounded(px(0.0))
                            .border_1()
                            .border_color(theme::panel_inset_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child(document.content.clone()),
                    )
            })
            .child(
                div()
                    .mt(px(20.0))
                    .text_xs()
                    .text_color(theme::text_muted())
                    .child("DRAFT EDITOR"),
            )
            .child(div().mt(px(10.0)).child(self.document_title_input.clone()))
            .child(div().mt(px(12.0)).child(self.document_body_input.clone()))
            .child(
                div().mt(px(14.0)).flex().justify_end().child(
                    div()
                        .text_xs()
                        .text_color(theme::text_muted())
                        .child("Use the draft editor to create the next document revision."),
                ),
            )
    }
}

fn render_document_header(total_count: usize, cx: &mut Context<AppRoot>) -> impl IntoElement {
    div()
        .flex()
        .justify_between()
        .items_center()
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
                        .child(format!("{} items", total_count)),
                ),
        )
        .child(primary_button("Save draft", cx, |this, cx| {
            this.create_document(cx)
        }))
}

fn document_section_label(label: &'static str) -> impl IntoElement {
    div().text_xs().text_color(theme::text_muted()).child(label)
}

fn render_work_products<'a>(products: &'a [&'a domain::ArtifactRecord]) -> impl IntoElement + 'a {
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .children(products.iter().map(|artifact| {
            div()
                .px_5()
                .py_4()
                .border_b_1()
                .border_color(theme::panel_border())
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .items_center()
                        .gap_3()
                        .child(
                            div()
                                .flex_1()
                                .child(
                                    div()
                                        .text_sm()
                                        .text_color(theme::text_primary())
                                        .child(artifact.title.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(4.0))
                                        .text_xs()
                                        .text_color(theme::text_muted())
                                        .child(format!(
                                            "{} · {} · {}",
                                            artifact.provider,
                                            artifact.external_id,
                                            short_date(artifact.created_at.as_str())
                                        )),
                                ),
                        )
                        .child(
                            div()
                                .px_3()
                                .py_2()
                                .rounded_full()
                                .bg(theme::accent_blue_soft())
                                .text_xs()
                                .text_color(theme::accent_blue())
                                .child("ARTIFACT"),
                        ),
                )
        }))
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
