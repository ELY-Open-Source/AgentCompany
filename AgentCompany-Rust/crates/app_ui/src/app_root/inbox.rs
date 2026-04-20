use super::*;
use app_models::InboxFilter;
use gpui::{Animation, AnimationExt, SharedString, pulsating_between};
use std::time::Duration;

impl AppRoot {
    pub(super) fn render_inbox(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
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

        let rows = inbox_rows(
            &self.snapshot,
            self.state.inbox_filter,
            pending_approvals.as_slice(),
            review_tasks.as_slice(),
            failed_runs.as_slice(),
            unread_messages.as_slice(),
        );
        let mut row_elements = Vec::with_capacity(rows.len());
        for (index, row) in rows.into_iter().enumerate() {
            row_elements.push(row.render(index, cx).into_any_element());
        }

        div()
            .flex()
            .flex_col()
            .gap_4()
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
            )
            .child(inbox_filters(
                self.state.inbox_filter,
                pending_approvals.len(),
                review_tasks.len(),
                failed_runs.len(),
                unread_messages.len(),
                cx,
            ))
            .child(
                div()
                    .rounded_md()
                    .border_1()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .when(total_attention == 0, |container| {
                        container.child(
                            div()
                                .min_h(px(260.0))
                                .flex()
                                .items_center()
                                .justify_center()
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
                    .when(!row_elements.is_empty(), |container| container.children(row_elements)),
            )
    }
}

#[derive(Clone)]
struct InboxRow {
    title: String,
    subtitle: String,
    accent: gpui::Hsla,
    tile_bg: gpui::Hsla,
    action: InboxAction,
}

#[derive(Clone)]
enum InboxAction {
    Approval(String),
    ReviewTask(String),
    FailedRun(String),
    Message(String),
}

impl InboxRow {
    fn render(self, index: usize, cx: &mut Context<AppRoot>) -> impl IntoElement {
        let action = self.action.clone();
        let title = self.title.clone();
        let subtitle = self.subtitle.clone();
        let accent = self.accent;
        let tile_bg = self.tile_bg;
        div()
            .id(SharedString::from(format!("inbox-row-{index}")))
            .cursor_pointer()
            .hover(|style| style.bg(theme::panel_hover()))
            .on_click(cx.listener(move |this, _, _, cx| {
                match &action {
                    InboxAction::Approval(approval_id) => {
                        this.state.section = SectionId::Approvals;
                        this.state.selected_approval_id = Some(approval_id.clone());
                    }
                    InboxAction::ReviewTask(task_id) => {
                        if let Some(run_id) = this
                            .snapshot
                            .tasks
                            .iter()
                            .find(|task| task.id == *task_id)
                            .and_then(|task| task.active_run_id.clone())
                        {
                            this.state.section = SectionId::Runs;
                            this.state.selected_run_id = Some(run_id);
                        } else {
                            this.state.section = SectionId::Approvals;
                        }
                    }
                    InboxAction::FailedRun(run_id) => {
                        this.state.section = SectionId::Runs;
                        this.state.selected_run_id = Some(run_id.clone());
                    }
                    InboxAction::Message(message_id) => {
                        this.state.section = SectionId::Messages;
                        this.state.selected_message_id = Some(message_id.clone());
                    }
                }
                cx.notify();
            }))
            .px_4()
            .py_3()
            .border_b_1()
            .border_color(theme::panel_border())
            .child(
                div()
                    .flex()
                    .gap_3()
                    .items_center()
                    .child(div().w(px(36.0)).h(px(36.0)).rounded(px(0.0)).bg(tile_bg))
                    .child(
                        div()
                            .flex_1()
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme::text_primary())
                                    .child(title),
                            )
                            .child(
                                div()
                                    .mt(px(4.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .line_clamp(2)
                                    .child(subtitle),
                            ),
                    )
                    .child(active_filter_dot(accent, index)),
            )
    }
}

fn inbox_rows(
    snapshot: &domain::ProfileSnapshot,
    filter: InboxFilter,
    pending_approvals: &[&domain::Approval],
    review_tasks: &[&domain::Task],
    failed_runs: &[&domain::Run],
    unread_messages: &[&domain::AgentMessage],
) -> Vec<InboxRow> {
    let mut rows = Vec::new();
    if matches!(filter, InboxFilter::All | InboxFilter::Approvals) {
        rows.extend(pending_approvals.iter().map(|approval| InboxRow {
            title: approval.payload_summary.clone(),
            subtitle: format!("{} · pending", approval.approval_type.replace('_', " ")),
            accent: theme::accent_orange(),
            tile_bg: theme::accent_orange_soft(),
            action: InboxAction::Approval(approval.id.clone()),
        }));
    }
    if matches!(filter, InboxFilter::All | InboxFilter::Reviews) {
        rows.extend(review_tasks.iter().map(|task| InboxRow {
            title: task.title.clone(),
            subtitle: format!("{} · awaiting review", task.status),
            accent: theme::accent_blue(),
            tile_bg: theme::accent_blue_soft(),
            action: InboxAction::ReviewTask(task.id.clone()),
        }));
    }
    if matches!(filter, InboxFilter::All | InboxFilter::Failed) {
        rows.extend(failed_runs.iter().map(|run| {
            InboxRow {
                title: inbox_run_title(snapshot, run),
                subtitle: run
                    .error_message
                    .clone()
                    .unwrap_or_else(|| run.status.clone()),
                accent: theme::danger(),
                tile_bg: theme::danger_bg(),
                action: InboxAction::FailedRun(run.id.clone()),
            }
        }));
    }
    if matches!(filter, InboxFilter::All | InboxFilter::Messages) {
        rows.extend(unread_messages.iter().map(|message| InboxRow {
            title: message.subject.clone(),
            subtitle: message.body.clone(),
            accent: theme::accent_teal(),
            tile_bg: theme::accent_teal_soft(),
            action: InboxAction::Message(message.id.clone()),
        }));
    }
    rows
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
    active: InboxFilter,
    approvals: usize,
    reviews: usize,
    failed_runs: usize,
    messages: usize,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    div()
        .flex()
        .gap_2()
        .child(filter_chip(
            "All",
            approvals + reviews + failed_runs + messages,
            active == InboxFilter::All,
            InboxFilter::All,
            cx,
        ))
        .child(filter_chip(
            "Approvals",
            approvals,
            active == InboxFilter::Approvals,
            InboxFilter::Approvals,
            cx,
        ))
        .child(filter_chip(
            "Reviews",
            reviews,
            active == InboxFilter::Reviews,
            InboxFilter::Reviews,
            cx,
        ))
        .child(filter_chip(
            "Failed",
            failed_runs,
            active == InboxFilter::Failed,
            InboxFilter::Failed,
            cx,
        ))
        .child(filter_chip(
            "Messages",
            messages,
            active == InboxFilter::Messages,
            InboxFilter::Messages,
            cx,
        ))
}

fn filter_chip(
    label: &'static str,
    count: usize,
    active: bool,
    next: InboxFilter,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    let chip = div()
        .id(SharedString::from(format!("inbox-filter-{label}")))
        .px_4()
        .py_2()
        .rounded_full()
        .cursor_pointer()
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
        .hover(|style| {
            style.bg(if active {
                theme::primary_action_hover()
            } else {
                theme::panel_hover()
            })
        })
        .on_click(cx.listener(move |this, _, _, cx| {
            this.state.inbox_filter = next;
            cx.notify();
        }))
        .child(format!("{} {}", label, count));
    if active {
        chip.with_animation(
            ("inbox-filter", label.len()),
            Animation::new(Duration::from_secs(2))
                .repeat()
                .with_easing(pulsating_between(0.82, 1.0)),
            |element, delta| element.opacity(delta),
        )
        .into_any_element()
    } else {
        chip.into_any_element()
    }
}

fn active_filter_dot(accent: gpui::Hsla, index: usize) -> impl IntoElement {
    div()
        .w(px(10.0))
        .h(px(10.0))
        .rounded_full()
        .bg(accent)
        .with_animation(
            ("inbox-row-dot", index),
            Animation::new(Duration::from_secs(2))
                .repeat()
                .with_easing(pulsating_between(0.8, 1.0)),
            |element, delta| element.opacity(delta),
        )
}
