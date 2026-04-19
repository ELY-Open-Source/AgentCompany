use super::*;

impl AppRoot {
    pub(super) fn render_inbox(&self) -> impl IntoElement + '_ {
        let pending_approvals = self
            .snapshot
            .approvals
            .iter()
            .filter(|item| item.state == "pending")
            .collect::<Vec<_>>();
        let unread_messages = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|item| item.read_at.is_none())
            .collect::<Vec<_>>();
        let review_tasks = self
            .snapshot
            .tasks
            .iter()
            .filter(|task| task.status == "in_review")
            .collect::<Vec<_>>();
        let failed_runs = self
            .snapshot
            .runs
            .iter()
            .filter(|run| {
                matches!(
                    run.status.as_str(),
                    "failed" | "timed_out" | "cancelled" | "interrupted"
                )
            })
            .collect::<Vec<_>>();
        let total_attention = pending_approvals.len()
            + unread_messages.len()
            + review_tasks.len()
            + failed_runs.len();

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .child(
                                div()
                                    .text_xl()
                                    .text_color(theme::text_primary())
                                    .child("Inbox"),
                            )
                            .child(
                                div()
                                    .mt(px(6.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!("{} items need attention", total_attention)),
                            ),
                    ),
            )
            .child(inbox_filters(
                pending_approvals.len(),
                review_tasks.len(),
                failed_runs.len(),
                unread_messages.len(),
            ))
            .when(total_attention == 0, |container| {
                container.child(
                    div()
                        .min_h(px(260.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .rounded_lg()
                        .border_1()
                        .border_color(theme::panel_border())
                        .bg(theme::panel())
                        .child(
                            div()
                                .w(px(420.0))
                                .text_center()
                                .child(
                                    div()
                                        .text_xl()
                                        .text_color(theme::text_primary())
                                        .child("All clear"),
                                )
                                .child(
                                    div()
                                        .mt(px(10.0))
                                        .text_base()
                                        .text_color(theme::text_muted())
                                        .child("No approvals, reviews, failed runs, or unread internal messages need board attention right now."),
                                ),
                        ),
                )
            })
            .when(total_attention > 0, |container| {
                container
                    .when(!pending_approvals.is_empty(), |content| {
                        content.child(inbox_group(
                            "Pending approvals",
                            pending_approvals.into_iter().map(|item| {
                                inbox_row(
                                    item.payload_summary.clone(),
                                    format!("{} · pending", item.approval_type.replace('_', " ")),
                                    theme::accent_orange_soft(),
                                    theme::accent_orange(),
                                )
                            }),
                        ))
                    })
                    .when(!review_tasks.is_empty(), |content| {
                        content.child(inbox_group(
                            "Reviews in progress",
                            review_tasks.into_iter().map(|item| {
                                inbox_row(
                                    item.title.clone(),
                                    format!("{} · awaiting review", item.status),
                                    theme::accent_blue_soft(),
                                    theme::accent_blue(),
                                )
                            }),
                        ))
                    })
                    .when(!failed_runs.is_empty(), |content| {
                        content.child(inbox_group(
                            "Failed runs",
                            failed_runs.into_iter().map(|item| {
                                inbox_row(
                                    inbox_run_title(&self.snapshot, item),
                                    item.error_message.clone().unwrap_or_else(|| item.status.clone()),
                                    theme::danger_bg(),
                                    theme::danger(),
                                )
                            }),
                        ))
                    })
                    .when(!unread_messages.is_empty(), |content| {
                        content.child(inbox_group(
                            "Unread messages",
                            unread_messages.into_iter().map(|item| {
                                inbox_row(
                                    item.subject.clone(),
                                    item.body.clone(),
                                    theme::accent_teal_soft(),
                                    theme::accent_teal(),
                                )
                            }),
                        ))
                    })
            })
    }
}

fn inbox_run_title(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    run.task_id
        .as_ref()
        .and_then(|task_id| snapshot.tasks.iter().find(|task| &task.id == task_id))
        .map(|task| task.title.clone())
        .unwrap_or_else(|| {
            if run.summary.trim().is_empty() {
                format!("Run {}", run.id.get(..8).unwrap_or(run.id.as_str()))
            } else {
                run.summary.clone()
            }
        })
}

fn inbox_filters(
    approvals: usize,
    reviews: usize,
    failed_runs: usize,
    messages: usize,
) -> impl IntoElement {
    div()
        .flex()
        .gap_2()
        .child(filter_chip(
            "All",
            approvals + reviews + failed_runs + messages,
            true,
        ))
        .child(filter_chip("Approvals", approvals, false))
        .child(filter_chip("Reviews", reviews, false))
        .child(filter_chip("Failed", failed_runs, false))
        .child(filter_chip("Messages", messages, false))
}

fn filter_chip(label: &'static str, count: usize, active: bool) -> impl IntoElement {
    div()
        .px_4()
        .py_2()
        .rounded_full()
        .bg(if active {
            theme::primary_action()
        } else {
            theme::panel_muted()
        })
        .text_xs()
        .text_color(if active {
            theme::primary_action_text()
        } else {
            theme::text_secondary()
        })
        .child(format!("{} {}", label, count))
}

fn inbox_group(label: &'static str, rows: impl Iterator<Item = gpui::Div>) -> impl IntoElement {
    div()
        .gap_3()
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .border_1()
                .rounded_lg()
                .border_color(theme::panel_border())
                .bg(theme::panel())
                .children(rows),
        )
}

fn inbox_row(
    title: String,
    subtitle: String,
    tile_bg: gpui::Hsla,
    accent: gpui::Hsla,
) -> gpui::Div {
    div()
        .px_5()
        .py_4()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(
            div()
                .flex()
                .gap_3()
                .items_start()
                .child(div().w(px(14.0)).h(px(14.0)).rounded_full().bg(accent))
                .child(
                    div()
                        .flex_1()
                        .child(
                            div()
                                .text_base()
                                .text_color(theme::text_primary())
                                .child(title),
                        )
                        .child(
                            div()
                                .mt(px(6.0))
                                .text_sm()
                                .text_color(theme::text_muted())
                                .line_clamp(2)
                                .child(subtitle),
                        ),
                )
                .child(div().w(px(20.0)).h(px(20.0)).rounded_full().bg(tile_bg)),
        )
}
