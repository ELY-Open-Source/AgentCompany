use super::*;

impl AppRoot {
    pub(super) fn render_inbox(&self) -> impl IntoElement + '_ {
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Unread messages"))
                    .children(
                        self.snapshot
                            .agent_messages
                            .iter()
                            .filter(|item| item.read_at.is_none())
                            .take(8)
                            .map(|item| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(rgb(0xeee3d7))
                                    .child(format!("{} · {}", item.subject, item.body))
                            }),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Pending approvals"))
                    .children(
                        self.snapshot
                            .approvals
                            .iter()
                            .filter(|item| item.state == "pending")
                            .take(8)
                            .map(|item| {
                                div().py_2().border_b_1().border_color(rgb(0xeee3d7)).child(
                                    format!("{} · {}", item.approval_type, item.payload_summary),
                                )
                            }),
                    ),
            )
    }
}
