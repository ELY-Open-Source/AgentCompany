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
            .gap_6()
            .child(section_label("AGENT REVIEWS IN PROGRESS"))
            .child(render_review_groups_panel(&groups))
            .child(section_label("PENDING APPROVALS"))
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
            .rounded(px(0.0))
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
                                .text_sm()
                                .text_color(theme::text_primary())
                                .child(approval.payload_summary.clone()),
                        )
                        .child(
                            div()
                                .mt(px(4.0))
                                .text_xs()
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
            .rounded(px(0.0))
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
                            .rounded(px(0.0))
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
                                .rounded(px(0.0))
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
    kind: ReviewKind,
}

#[derive(Clone, Copy)]
enum ReviewKind {
    Board,
    User,
    Manager,
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

        let row = if pending_approval_task_ids
            .iter()
            .any(|task_id| *task_id == task.id)
        {
            ReviewRow {
                task,
                assignee,
                reviewer: None,
                kind: ReviewKind::Board,
            }
        } else if task.requires_user_review || reviewer.is_none() {
            ReviewRow {
                task,
                assignee,
                reviewer: None,
                kind: ReviewKind::User,
            }
        } else {
            ReviewRow {
                task,
                assignee,
                reviewer,
                kind: ReviewKind::Manager,
            }
        };

        match row.kind {
            ReviewKind::Board => board.push(row),
            ReviewKind::User => user.push(row),
            ReviewKind::Manager => manager.push(row),
        }
    }

    ReviewGroups {
        board,
        user,
        manager,
    }
}

fn render_review_groups_panel(groups: &ReviewGroups<'_>) -> impl IntoElement {
    let has_rows =
        !(groups.board.is_empty() && groups.user.is_empty() && groups.manager.is_empty());
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .when(has_rows, |container| {
            container
                .when(!groups.board.is_empty(), |inner| {
                    inner.child(review_group_section(
                        "Board review",
                        groups.board.as_slice(),
                    ))
                })
                .when(!groups.user.is_empty(), |inner| {
                    inner.child(review_group_section("Human review", groups.user.as_slice()))
                })
                .when(!groups.manager.is_empty(), |inner| {
                    inner.child(review_group_section(
                        "Manager review",
                        groups.manager.as_slice(),
                    ))
                })
        })
        .when(!has_rows, |container| {
            container.child(
                div()
                    .min_h(px(180.0))
                    .flex()
                    .items_center()
                    .justify_center()
                    .text_color(theme::text_muted())
                    .child("No agent reviews are currently waiting on a human."),
            )
        })
}

fn review_group_section<'a>(
    title: &'static str,
    rows: &'a [ReviewRow<'a>],
) -> impl IntoElement + 'a {
    div()
        .child(
            div()
                .px_4()
                .pt_3()
                .pb_1()
                .text_xs()
                .text_color(theme::text_muted())
                .child(title),
        )
        .children(rows.iter().map(|row| {
            div()
                .flex()
                .items_start()
                .gap_3()
                .px_4()
                .py_3()
                .border_b_1()
                .border_color(theme::panel_border())
                .child(
                    div()
                        .w(px(28.0))
                        .h(px(28.0))
                        .rounded(px(0.0))
                        .bg(theme::panel_muted()),
                )
                .child(
                    div()
                        .flex_1()
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
                        ),
                )
        }))
}

fn review_row_subtitle(row: &ReviewRow<'_>) -> String {
    let assignee = row
        .assignee
        .map(|agent| agent.name.clone())
        .unwrap_or_else(|| "Unassigned".to_string());
    match row.kind {
        ReviewKind::Board => format!("{} · awaits board review", assignee),
        ReviewKind::User => format!("{} · awaits human review", assignee),
        ReviewKind::Manager => match row.reviewer {
            Some(reviewer) => format!("{} → reviewed by {}", assignee, reviewer.name),
            None => format!("{} · awaiting manager review", assignee),
        },
    }
}

fn section_label(title: &'static str) -> impl IntoElement {
    div().text_xs().text_color(theme::text_muted()).child(title)
}

fn pending_approvals(
    snapshot: &domain::ProfileSnapshot,
) -> impl Iterator<Item = &domain::Approval> {
    snapshot
        .approvals
        .iter()
        .filter(|item| item.state == "pending" || item.state == "revision_requested")
}
