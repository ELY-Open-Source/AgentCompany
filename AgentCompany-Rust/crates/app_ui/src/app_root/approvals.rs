use super::*;

impl AppRoot {
    pub(super) fn render_approvals(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let groups = review_groups(&self.snapshot);
        let selected_pending = self
            .state
            .selected_approval_id
            .as_ref()
            .and_then(|approval_id| {
                self.snapshot
                    .approvals
                    .iter()
                    .find(|item| &item.id == approval_id)
            });

        div()
            .flex()
            .flex_col()
            .gap_8()
            .child(section_title("Agent reviews in progress"))
            .child(
                div()
                    .grid()
                    .grid_cols(3)
                    .gap_3()
                    .when(!groups.board.is_empty(), |container| {
                        container.child(review_group_card("Board review", groups.board.as_slice()))
                    })
                    .when(!groups.user.is_empty(), |container| {
                        container.child(review_group_card("Human review", groups.user.as_slice()))
                    })
                    .when(!groups.manager.is_empty(), |container| {
                        container.child(review_group_card(
                            "Manager review",
                            groups.manager.as_slice(),
                        ))
                    })
                    .when(
                        groups.board.is_empty()
                            && groups.user.is_empty()
                            && groups.manager.is_empty(),
                        |container| {
                            container.child(empty_group_card(
                                "No agent reviews are currently waiting on a human.",
                            ))
                        },
                    ),
            )
            .child(section_title("Pending approvals"))
            .child(
                div()
                    .grid()
                    .grid_cols(2)
                    .gap_4()
                    .child(self.render_pending_approval_list(cx))
                    .child(self.render_pending_approval_detail(selected_pending, cx)),
            )
    }

    fn render_pending_approval_list(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let pending = pending_approvals(&self.snapshot).collect::<Vec<_>>();
        div()
            .rounded_lg()
            .border_1()
            .border_color(theme::panel_border())
            .bg(theme::panel())
            .when(pending.is_empty(), |container| {
                container.child(
                    div()
                        .min_h(px(280.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .child(
                            div()
                                .w(px(320.0))
                                .text_center()
                                .text_color(theme::text_muted())
                                .child("No pending approvals"),
                        ),
                )
            })
            .when(!pending.is_empty(), |container| {
                container.children(pending.into_iter().map(|approval| {
                    let active =
                        self.state.selected_approval_id.as_deref() == Some(approval.id.as_str());
                    let approval_id = approval.id.clone();
                    div()
                        .id(SharedString::from(format!("approval-{}", approval.id)))
                        .cursor_pointer()
                        .hover(|style| style.bg(theme::panel_hover()))
                        .bg(if active {
                            theme::selection_fill()
                        } else {
                            theme::panel()
                        })
                        .on_click(cx.listener(move |this, _, _, cx| {
                            this.state.selected_approval_id = Some(approval_id.clone());
                            cx.notify();
                        }))
                        .px_5()
                        .py_4()
                        .border_b_1()
                        .border_color(theme::panel_border())
                        .child(
                            div()
                                .text_base()
                                .text_color(theme::text_primary())
                                .child(approval.payload_summary.clone()),
                        )
                        .child(
                            div()
                                .mt(px(4.0))
                                .text_sm()
                                .text_color(theme::text_muted())
                                .child(format!(
                                    "{} · {}",
                                    approval.approval_type.replace('_', " "),
                                    approval.state
                                )),
                        )
                }))
            })
    }

    fn render_pending_approval_detail(
        &self,
        approval: Option<&domain::Approval>,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + '_ {
        div()
            .rounded_lg()
            .border_1()
            .border_color(theme::panel_border())
            .bg(theme::panel())
            .p_5()
            .when_some(approval, |container, approval| {
                container
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
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_inset_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child(approval.impact_summary.clone()),
                    )
                    .when_some(approval.payload_json.clone(), |inner, payload| {
                        inner.child(
                            div()
                                .mt(px(12.0))
                                .rounded_lg()
                                .border_1()
                                .border_color(theme::panel_border())
                                .bg(theme::panel())
                                .p_4()
                                .text_xs()
                                .line_height(px(20.0))
                                .text_color(theme::text_muted())
                                .child(payload),
                        )
                    })
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
                    )
            })
            .when(approval.is_none(), |container| {
                container.child(
                    div()
                        .min_h(px(320.0))
                        .flex()
                        .items_center()
                        .justify_center()
                        .text_color(theme::text_muted())
                        .child("Select an approval to inspect its impact and decision surface."),
                )
            })
    }
}

struct ReviewGroups<'a> {
    board: Vec<ReviewRow<'a>>,
    user: Vec<ReviewRow<'a>>,
    manager: Vec<ReviewRow<'a>>,
}

struct ReviewRow<'a> {
    task: &'a domain::Task,
    assignee: Option<&'a domain::Agent>,
    reviewer: Option<&'a domain::Agent>,
}

fn review_groups(snapshot: &domain::ProfileSnapshot) -> ReviewGroups<'_> {
    let pending_approval_task_ids = snapshot
        .approvals
        .iter()
        .filter(|approval| approval.state == "pending" || approval.state == "revision_requested")
        .filter_map(|approval| approval.related_task_id.as_deref())
        .collect::<Vec<_>>();

    let mut board = Vec::new();
    let mut user = Vec::new();
    let mut manager = Vec::new();

    for task in snapshot
        .tasks
        .iter()
        .filter(|task| task.status == "in_review")
    {
        let assignee = task
            .assignee_agent_id
            .as_ref()
            .and_then(|agent_id| snapshot.agents.iter().find(|agent| &agent.id == agent_id));
        let reviewer = assignee
            .and_then(|assignee| assignee.reports_to.as_ref())
            .and_then(|manager_id| snapshot.agents.iter().find(|agent| &agent.id == manager_id));
        let row = ReviewRow {
            task,
            assignee,
            reviewer,
        };
        if pending_approval_task_ids
            .iter()
            .any(|task_id| *task_id == task.id)
        {
            board.push(row);
        } else if task.requires_user_review || reviewer.is_none() {
            user.push(row);
        } else {
            manager.push(row);
        }
    }

    ReviewGroups {
        board,
        user,
        manager,
    }
}

fn review_group_card(title: &'static str, rows: &[ReviewRow<'_>]) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .child(
            div()
                .px_4()
                .pt_4()
                .pb_2()
                .text_xs()
                .text_color(theme::text_muted())
                .child(title),
        )
        .children(rows.iter().map(|row| {
            div()
                .px_4()
                .py_3()
                .border_b_1()
                .border_color(theme::panel_border())
                .child(
                    div()
                        .text_sm()
                        .text_color(theme::text_primary())
                        .child(row.task.title.clone()),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_xs()
                        .text_color(theme::text_muted())
                        .child(review_row_subtitle(row)),
                )
        }))
}

fn review_row_subtitle(row: &ReviewRow<'_>) -> String {
    let assignee = row
        .assignee
        .map(|agent| agent.name.clone())
        .unwrap_or_else(|| "Unassigned".to_string());
    match row.reviewer {
        Some(reviewer) => format!("{} → reviewed by {}", assignee, reviewer.name),
        None => format!("{} · awaiting human review", assignee),
    }
}

fn empty_group_card(message: &'static str) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .min_h(px(180.0))
        .flex()
        .items_center()
        .justify_center()
        .text_color(theme::text_muted())
        .child(message)
}

fn section_title(title: &'static str) -> impl IntoElement {
    div()
        .text_2xl()
        .text_color(theme::text_primary())
        .child(title)
}

fn pending_approvals(
    snapshot: &domain::ProfileSnapshot,
) -> impl Iterator<Item = &domain::Approval> {
    snapshot
        .approvals
        .iter()
        .filter(|item| item.state == "pending" || item.state == "revision_requested")
}
