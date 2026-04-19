use super::*;

impl AppRoot {
    pub(super) fn render_documents(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_document_id
            .as_ref()
            .and_then(|id| self.snapshot.documents.iter().find(|item| &item.id == id));
        let document_title = selected
            .map(|item| item.title.clone())
            .unwrap_or_else(|| "Select a document".to_string());
        let document_content = selected
            .map(|item| item.content.clone())
            .unwrap_or_else(|| "No document selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("documents-list")
                    .w(px(340.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Document center"))
                    .children(self.snapshot.documents.iter().map(|item| {
                        let active =
                            self.state.selected_document_id.as_deref() == Some(item.id.as_str());
                        let document_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("document-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_document_id = Some(document_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.status, item.title))
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Quick draft"))
                    .child(self.document_title_input.clone())
                    .child(self.document_body_input.clone())
                    .child(primary_button("Save draft", cx, |this, cx| {
                        this.create_document(cx)
                    }))
                    .child(div().h(px(1.0)).bg(rgb(0xeee3d7)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(document_title),
                    )
                    .child(
                        div()
                            .min_h(px(200.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(document_content),
                    ),
            )
    }
}
