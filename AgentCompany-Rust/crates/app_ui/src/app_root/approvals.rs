use super::*;

impl AppRoot {
    pub(super) fn render_approvals(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected_pending_id = self
            .state
            .selected_approval_id
            .clone()
            .filter(|approval_id| {
                pending_approvals(&self.snapshot).any(|item| &item.id == approval_id)
            });
        let selected_pending = selected_pending_id.as_ref().and_then(|approval_id| {
            self.snapshot
                .approvals
                .iter()
                .find(|item| &item.id == approval_id)
        });

        div()
            .flex()
            .flex_col()
            .gap_10()
            .child(
                approvals_section(
                    "Agent reviews in progress",
                    self.snapshot.tasks.iter().filter(|task| task.status == "in_review"),
                ),
            )
            .child(
                div()
                    .gap_5()
                    .child(
                        div()
                            .text_2xl()
                            .text_color(theme::text_primary())
                            .child("Pending approvals"),
                    )
                    .child(div().h(px(1.0)).bg(theme::panel_border()))
                    .when(self.snapshot.pending_approvals() == 0, |container| {
                        container.child(
                            div()
                                .min_h(px(280.0))
                                .flex()
                                .items_center()
                                .justify_center()
                                .child(
                                    div()
                                        .w(px(520.0))
                                        .text_center()
                                        .child(
                                            div()
                                                .text_xl()
                                                .text_color(theme::text_primary())
                                                .child("No pending approvals"),
                                        )
                                        .child(
                                            div()
                                                .mt(px(10.0))
                                                .text_base()
                                                .text_color(theme::text_muted())
                                                .child(
                                                    "Approval requests from agents will appear here when they need your sign-off.",
                                                ),
                                        ),
                                ),
                        )
                    })
                    .when(self.snapshot.pending_approvals() > 0, |container| {
                        container.child(
                            div()
                                .id("approvals-pending-list")
                                .border_1()
                                .rounded_lg()
                                .border_color(theme::panel_border())
                                .bg(theme::panel())
                                .children(pending_approvals(&self.snapshot).map(|item| {
                                    let active =
                                        selected_pending_id.as_deref() == Some(item.id.as_str());
                                    let approval_id = item.id.clone();
                                    div()
                                        .id(SharedString::from(format!("approval-{}", item.id)))
                                        .px_5()
                                        .py_4()
                                        .border_b_1()
                                        .border_color(theme::panel_border())
                                        .cursor_pointer()
                                        .bg(if active {
                                            theme::selection_fill()
                                        } else {
                                            theme::panel()
                                        })
                                        .hover(|style| style.bg(theme::panel_hover()))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.state.selected_approval_id = Some(approval_id.clone());
                                            cx.notify();
                                        }))
                                        .child(
                                            div()
                                                .text_base()
                                                .text_color(theme::text_primary())
                                                .child(item.payload_summary.clone()),
                                        )
                                        .child(
                                            div()
                                                .mt(px(6.0))
                                                .text_sm()
                                                .text_color(theme::text_muted())
                                                .child(format!(
                                                    "{} · {}",
                                                    item.approval_type.replace('_', " "),
                                                    item.state
                                                )),
                                        )
                                })),
                        )
                    })
                    .when_some(selected_pending, |container, approval| {
                        container.child(
                            div()
                                .mt(px(8.0))
                                .p_5()
                                .rounded_lg()
                                .border_1()
                                .border_color(theme::panel_border())
                                .bg(theme::panel())
                                .child(
                                    div()
                                        .text_xs()
                                        .text_color(theme::text_muted())
                                        .child(approval.approval_type.replace('_', " ")),
                                )
                                .child(
                                    div()
                                        .mt(px(10.0))
                                        .text_lg()
                                        .text_color(theme::text_primary())
                                        .child(approval.payload_summary.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(10.0))
                                        .text_base()
                                        .text_color(theme::text_secondary())
                                        .child(approval.impact_summary.clone()),
                                )
                                .child(
                                    div()
                                        .mt(px(18.0))
                                        .flex()
                                        .gap_3()
                                        .child(primary_button("Approve", cx, |this, cx| {
                                            this.decide_selected_approval(
                                                ApprovalState::Approved,
                                                "Approved from native shell.",
                                                cx,
                                            )
                                        }))
                                        .child(secondary_button("Reject", cx, |this, cx| {
                                            this.decide_selected_approval(
                                                ApprovalState::Rejected,
                                                "Rejected from native shell.",
                                                cx,
                                            )
                                        })),
                                ),
                        )
                    }),
            )
    }
}

fn approvals_section<'a>(
    title: &'static str,
    tasks: impl Iterator<Item = &'a domain::Task>,
) -> impl IntoElement {
    let rows = tasks.collect::<Vec<_>>();
    div()
        .gap_5()
        .child(
            div()
                .text_2xl()
                .text_color(theme::text_primary())
                .child(title),
        )
        .child(div().h(px(1.0)).bg(theme::panel_border()))
        .when(rows.is_empty(), |container| {
            container.child(
                div()
                    .py_8()
                    .text_base()
                    .text_color(theme::text_muted())
                    .child("No agent reviews are currently waiting on a human."),
            )
        })
        .when(!rows.is_empty(), |container| {
            container.child(
                div()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .children(rows.into_iter().map(|task| {
                        div()
                            .px_5()
                            .py_4()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .child(
                                div()
                                    .text_base()
                                    .text_color(theme::text_primary())
                                    .truncate()
                                    .child(task.title.clone()),
                            )
                            .child(
                                div()
                                    .mt(px(6.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!(
                                        "{} · awaiting review",
                                        task.assignee_agent_id
                                            .clone()
                                            .unwrap_or_else(|| "CEO".to_string())
                                    )),
                            )
                    })),
            )
        })
}

fn pending_approvals(
    snapshot: &domain::ProfileSnapshot,
) -> impl Iterator<Item = &domain::Approval> {
    snapshot
        .approvals
        .iter()
        .filter(|item| item.state == "pending" || item.state == "revision_requested")
}
