use super::*;

impl AppRoot {
    pub(super) fn render_overview(&self) -> impl IntoElement + '_ {
        let company = self.snapshot.current_company();
        let company_name = company
            .map(|item| item.name.clone())
            .unwrap_or_else(|| "No company".to_string());
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(self.metric_card(
                        "Active tasks",
                        self.snapshot.active_tasks().to_string(),
                        "Tasks in todo, review, or execution",
                    ))
                    .child(self.metric_card(
                        "Pending approvals",
                        self.snapshot.pending_approvals().to_string(),
                        "Human review gates",
                    ))
                    .child(self.metric_card(
                        "Unread messages",
                        self.snapshot.unread_messages().to_string(),
                        "Company and direct channels",
                    ))
                    .child(self.metric_card(
                        "Active runs",
                        self.snapshot.active_runs().to_string(),
                        "Queued, running, and waiting runs",
                    )),
            )
            .child(
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
                            .border_color(theme::panel_border())
                            .bg(theme::panel())
                            .child(div().text_lg().child(company_name))
                            .children(self.snapshot.tasks.iter().take(6).map(|task| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(theme::panel_inset_border())
                                    .child(format!("{} · {}", task.status, task.title))
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .gap_2()
                            .border_1()
                            .rounded_md()
                            .border_color(theme::panel_border())
                            .bg(theme::panel())
                            .child(div().text_lg().child("Recent activity"))
                            .children(self.snapshot.activity.iter().take(6).map(|item| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(theme::panel_inset_border())
                                    .child(format!("{} · {}", item.action, item.detail))
                            })),
                    ),
            )
    }
}
