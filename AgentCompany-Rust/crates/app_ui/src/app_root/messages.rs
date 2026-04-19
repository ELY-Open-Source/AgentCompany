use super::*;

impl AppRoot {
    pub(super) fn render_messages(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self.state.selected_message_id.as_ref().and_then(|id| {
            self.snapshot
                .agent_messages
                .iter()
                .find(|item| &item.id == id)
        });
        let selected_subject = selected
            .map(|item| item.subject.clone())
            .unwrap_or_else(|| "Select a thread".to_string());
        let selected_body = selected
            .map(|item| item.body.clone())
            .unwrap_or_else(|| "No message selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("messages-list")
                    .w(px(320.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Channels"))
                    .children(self.snapshot.agent_messages.iter().map(|item| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(item.id.as_str());
                        let message_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.subject, item.priority))
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
                    .child(div().text_lg().child("Conversation"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(selected_subject),
                    )
                    .child(
                        div()
                            .min_h(px(220.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(selected_body),
                    )
                    .child(self.message_input.clone())
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(primary_button("Send update", cx, |this, cx| {
                                this.send_message(cx)
                            }))
                            .child(secondary_button("Mark read", cx, |this, cx| {
                                this.mark_selected_message_read(cx)
                            })),
                    ),
            )
    }
}
