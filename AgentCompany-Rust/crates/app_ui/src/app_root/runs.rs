use super::*;
use gpui::{Animation, AnimationExt, pulsating_between};
use std::time::Duration;

impl AppRoot {
    pub(super) fn render_runs(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let search_query = self.run_search_input.read(cx).value().to_lowercase();
        let filtered_runs = self
            .snapshot
            .runs
            .iter()
            .filter(|item| run_matches_filter(&self.snapshot, item, self.state.run_filter))
            .filter(|item| run_matches_query(&self.snapshot, item, search_query.as_str()))
            .collect::<Vec<_>>();
        let selected = self
            .state
            .selected_run_id
            .as_ref()
            .and_then(|id| self.snapshot.runs.iter().find(|item| &item.id == id))
            .or_else(|| filtered_runs.first().copied());

        if self.snapshot.runs.is_empty() {
            return runs_empty_state().into_any_element();
        }

        div()
            .flex()
            .gap_8()
            .child(render_run_queue_panel(
                &self.snapshot,
                filtered_runs.as_slice(),
                self.state.selected_run_id.as_deref(),
                self.state.run_filter,
                self.run_search_input.clone(),
                cx,
            ))
            .child(render_run_detail_column(self, selected, cx))
            .into_any_element()
    }
}

fn render_run_queue_panel(
    snapshot: &domain::ProfileSnapshot,
    runs: &[&domain::Run],
    selected_run_id: Option<&str>,
    run_filter: RunFilter,
    run_search_input: Entity<TextInput>,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    div().w(px(420.0)).gap_5().child(
        div()
            .rounded(px(0.0))
            .border_1()
            .border_color(theme::panel_border())
            .bg(theme::panel())
            .p_5()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_center()
                    .child(
                        div()
                            .child(
                                div()
                                    .text_lg()
                                    .text_color(theme::text_primary())
                                    .child("Run queue"),
                            )
                            .child(
                                div()
                                    .mt(px(4.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!("{} visible runs", runs.len())),
                            ),
                    )
                    .child(run_filter_controls(run_filter, cx)),
            )
            .child(div().mt(px(16.0)).child(run_search_input))
            .child(div().mt(px(16.0)).gap_2().children(runs.iter().map(|run| {
                run_queue_row(snapshot, run, selected_run_id == Some(run.id.as_str()), cx)
                    .into_any_element()
            })))
            .when(runs.is_empty(), |container| {
                container.child(
                    div()
                        .mt(px(16.0))
                        .rounded(px(0.0))
                        .border_1()
                        .border_color(theme::panel_border())
                        .bg(theme::panel_muted())
                        .px_4()
                        .py_6()
                        .text_center()
                        .child(
                            div()
                                .text_sm()
                                .text_color(theme::text_muted())
                                .child("No runs match this filter."),
                        ),
                )
            }),
    )
}

fn run_queue_row(
    snapshot: &domain::ProfileSnapshot,
    run: &domain::Run,
    active: bool,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    let run_id = run.id.clone();
    let title = run_task_title(snapshot, run);
    let subtitle = run_subtitle(snapshot, run);
    let supporting_text = if let Some(error_message) = run.error_message.clone() {
        if error_message.trim().is_empty() {
            run.summary.clone()
        } else {
            error_message
        }
    } else if run.summary.trim().is_empty() {
        "No summary yet".to_string()
    } else {
        run.summary.clone()
    };

    div()
        .id(SharedString::from(format!("run-row-{}", run.id)))
        .rounded(px(0.0))
        .border_1()
        .border_color(if active {
            theme::selection_border()
        } else {
            theme::panel_border()
        })
        .bg(if active {
            theme::selection_fill()
        } else {
            theme::panel()
        })
        .cursor_pointer()
        .hover(|style| style.bg(theme::panel_hover()))
        .on_click(cx.listener(move |this, _, _, cx| {
            this.state.selected_run_id = Some(run_id.clone());
            cx.notify();
        }))
        .px_4()
        .py_3()
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
                                    .text_size(px(13.0))
                                    .font_weight(gpui::FontWeight::SEMIBOLD)
                                    .text_color(theme::text_primary())
                                    .truncate()
                                    .child(title),
                            )
                            .child(
                                div()
                                    .mt(px(2.0))
                                    .text_size(px(11.0))
                                    .text_color(theme::text_muted())
                                    .truncate()
                                    .child(subtitle),
                            ),
                )
                .child(run_status_badge(run.status.as_str())),
        )
        .child(
            div()
                .mt(px(6.0))
                .flex()
                .justify_between()
                .gap_3()
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme::text_muted())
                        .line_clamp(1)
                        .child(supporting_text),
                )
                .child(
                    div()
                        .text_size(px(11.0))
                        .text_color(theme::text_muted())
                        .child(short_date(run.updated_at.as_str()).to_string()),
                ),
        )
}

fn render_run_detail_column<'a>(
    root: &'a AppRoot,
    selected: Option<&'a domain::Run>,
    cx: &'a mut Context<AppRoot>,
) -> impl IntoElement + 'a {
    div().flex_1().gap_6().when_some(selected, |container, run| {
        container
            .child(run_detail_panel(&root.snapshot, run))
            .child(run_trace_panel(&root.snapshot, run))
            .child(secondary_data_panel(
                "Runtime events",
                run_events_panel(&root.snapshot, run.id.as_str()).into_any_element(),
            ))
            .child(secondary_data_panel(
                "Artifacts",
                run_artifacts_panel(&root.snapshot, run.id.as_str()).into_any_element(),
            ))
            .child(run_live_controls_panel(root, cx))
    })
    .when(selected.is_none(), |container| {
        container.child(
            div()
                .min_h(px(320.0))
                .flex()
                .items_center()
                .justify_center()
                .rounded(px(0.0))
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
                                .child("Select a run"),
                        )
                        .child(
                            div()
                                .mt(px(10.0))
                                .text_base()
                                .text_color(theme::text_muted())
                                .child("Choose a run from the queue to inspect details, trace, artifacts, and operator actions."),
                        ),
                ),
        )
    })
}

fn runs_empty_state() -> impl IntoElement {
    div()
        .min_h(px(320.0))
        .flex()
        .items_center()
        .justify_center()
        .rounded(px(0.0))
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
                        .child("No runs yet"),
                )
                .child(
                    div()
                        .mt(px(10.0))
                        .text_base()
                        .text_color(theme::text_muted())
                        .child("Runs will appear here once your company starts executing work."),
                ),
        )
}

fn run_detail_panel(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> impl IntoElement {
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_xl()
                .text_color(theme::text_primary())
                .child(run_task_title(snapshot, run)),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_sm()
                .text_color(theme::text_muted())
                .child(run_subtitle(snapshot, run)),
        )
        .child(
            div()
                .mt(px(20.0))
                .child(detail_row(
                    "Status",
                    run_status_badge(run.status.as_str()).into_any_element(),
                ))
                .child(detail_row(
                    "Agent",
                    text_value(run_agent_name(snapshot, run)).into_any_element(),
                ))
                .child(detail_row(
                    "Connector",
                    text_value(run.connector_id.clone()).into_any_element(),
                ))
                .when_some(run.model.clone(), |container, model| {
                    container.child(detail_row("Model", text_value(model).into_any_element()))
                })
                .child(detail_row(
                    "Created",
                    text_value(short_date(run.created_at.as_str()).to_string()).into_any_element(),
                ))
                .child(detail_row(
                    "Started",
                    text_value(
                        run.started_at
                            .as_deref()
                            .map(short_date)
                            .unwrap_or("Pending")
                            .to_string(),
                    )
                    .into_any_element(),
                ))
                .when_some(run.finished_at.as_deref(), |container, finished_at| {
                    container.child(detail_row(
                        "Finished",
                        text_value(short_date(finished_at).to_string()).into_any_element(),
                    ))
                })
                .child(detail_row(
                    "Cost",
                    text_value(
                        run.cost_usd
                            .map(|value| format!("${value:.2}"))
                            .unwrap_or_else(|| "$0.00".to_string()),
                    )
                    .into_any_element(),
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
                .text_color(theme::text_secondary())
                .child(if run.summary.trim().is_empty() {
                    "No summary yet.".to_string()
                } else {
                    run.summary.clone()
                }),
        )
        .when_some(run.error_message.clone(), |content, error| {
            if error.trim().is_empty() {
                content
            } else {
                content.child(
                    div()
                        .mt(px(16.0))
                        .rounded(px(0.0))
                        .border_1()
                        .border_color(theme::danger())
                        .bg(theme::danger_bg())
                        .px_4()
                        .py_3()
                        .text_sm()
                        .text_color(theme::danger())
                        .child(error),
                )
            }
        })
}

fn run_trace_panel(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> impl IntoElement {
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_lg()
                .text_color(theme::text_primary())
                .child("Execution trace"),
        )
        .child(run_timeline(snapshot, run))
}

fn secondary_data_panel(title: &'static str, body: gpui::AnyElement) -> impl IntoElement {
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_lg()
                .text_color(theme::text_primary())
                .child(title),
        )
        .child(body)
}

fn detail_row(label: &'static str, value: gpui::AnyElement) -> impl IntoElement {
    div()
        .flex()
        .justify_between()
        .items_center()
        .py_2()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(value)
}

fn text_value(value: String) -> impl IntoElement {
    div()
        .text_sm()
        .text_color(theme::text_primary())
        .child(value)
}

fn run_task_title(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    run.task_id
        .as_ref()
        .and_then(|task_id| snapshot.tasks.iter().find(|task| &task.id == task_id))
        .map(|task| task.title.clone())
        .unwrap_or_else(|| {
            if run.summary.trim().is_empty() {
                format!("Run {}", short_id(run.id.as_str()))
            } else {
                run.summary.clone()
            }
        })
}

fn run_subtitle(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    format!(
        "{} via {}{}",
        run_agent_name(snapshot, run),
        run.connector_id,
        run.workspace_id
            .as_ref()
            .map(|_| format!(" · {}", run_workspace_name(snapshot, run)))
            .unwrap_or_default()
    )
}

fn run_agent_name(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    snapshot
        .agents
        .iter()
        .find(|agent| agent.id == run.agent_id)
        .map(|agent| agent.name.clone())
        .unwrap_or_else(|| run.agent_id.clone())
}

fn run_workspace_name(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    run.workspace_id
        .as_ref()
        .and_then(|workspace_id| {
            snapshot
                .workspaces
                .iter()
                .find(|workspace| &workspace.id == workspace_id)
        })
        .map(|workspace| workspace.name.clone())
        .unwrap_or_else(|| "Workspace pending".to_string())
}

fn run_status_badge(status: &str) -> impl IntoElement {
    let badge = div()
        .px_3()
        .py_2()
        .rounded_full()
        .bg(match status {
            "running" => theme::accent_teal_soft(),
            "failed" | "timed_out" | "cancelled" | "interrupted" => theme::danger_bg(),
            _ => theme::panel_muted(),
        })
        .text_xs()
        .text_color(match status {
            "running" => theme::accent_teal(),
            "failed" | "timed_out" | "cancelled" | "interrupted" => theme::danger(),
            _ => theme::text_secondary(),
        })
        .child(status.to_uppercase());
    if status == "running" {
        badge
            .with_animation(
                ("run-badge", 1usize),
                Animation::new(Duration::from_secs(2))
                    .repeat()
                    .with_easing(pulsating_between(0.8, 1.0)),
                |element, delta| element.opacity(delta),
            )
            .into_any_element()
    } else {
        badge.into_any_element()
    }
}

fn run_timeline(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> impl IntoElement {
    div()
        .mt(px(16.0))
        .gap_3()
        .child(timeline_row(
            "Created",
            short_date(run.created_at.as_str()).to_string(),
        ))
        .child(timeline_row(
            "Started",
            run.started_at
                .as_deref()
                .map(short_date)
                .unwrap_or("Pending")
                .to_string(),
        ))
        .child(timeline_row(
            "Task",
            run.task_id
                .as_ref()
                .and_then(|task_id| snapshot.tasks.iter().find(|task| &task.id == task_id))
                .map(|task| task.status.clone())
                .unwrap_or_else(|| "Unlinked".to_string()),
        ))
        .child(timeline_row(
            "Updated",
            short_date(run.updated_at.as_str()).to_string(),
        ))
}

fn run_events_panel(snapshot: &domain::ProfileSnapshot, run_id: &str) -> impl IntoElement {
    let events = snapshot
        .run_events
        .iter()
        .filter(|event| event.run_id == run_id)
        .take(8)
        .collect::<Vec<_>>();
    if events.is_empty() {
        div()
            .mt(px(16.0))
            .text_sm()
            .text_color(theme::text_muted())
            .child("No runtime events recorded yet.")
            .into_any_element()
    } else {
        div()
            .mt(px(16.0))
            .gap_3()
            .children(events.into_iter().map(|event| {
                div()
                    .py_3()
                    .border_b_1()
                    .border_color(theme::panel_border())
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::text_primary())
                            .child(event.title.clone()),
                    )
                    .child(
                        div()
                            .mt(px(6.0))
                            .text_xs()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} · {}",
                                event.event_kind,
                                short_date(event.created_at.as_str())
                            )),
                    )
                    .child(
                        div()
                            .mt(px(6.0))
                            .text_sm()
                            .text_color(theme::text_secondary())
                            .child(event.detail.clone()),
                    )
            }))
            .into_any_element()
    }
}

fn run_artifacts_panel(snapshot: &domain::ProfileSnapshot, run_id: &str) -> impl IntoElement {
    let artifacts = snapshot
        .artifacts
        .iter()
        .filter(|artifact| artifact.run_id == run_id)
        .take(8)
        .collect::<Vec<_>>();
    if artifacts.is_empty() {
        div()
            .mt(px(16.0))
            .text_sm()
            .text_color(theme::text_muted())
            .child("No artifacts recorded yet.")
            .into_any_element()
    } else {
        div()
            .mt(px(16.0))
            .gap_3()
            .children(artifacts.into_iter().map(|artifact| {
                div()
                    .py_3()
                    .border_b_1()
                    .border_color(theme::panel_border())
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::text_primary())
                            .child(artifact.title.clone()),
                    )
                    .child(
                        div()
                            .mt(px(6.0))
                            .text_xs()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} · {}",
                                artifact.provider,
                                short_date(artifact.created_at.as_str())
                            )),
                    )
                    .child(
                        div()
                            .mt(px(6.0))
                            .text_sm()
                            .text_color(theme::text_secondary())
                            .child(artifact.external_id.clone()),
                    )
            }))
            .into_any_element()
    }
}

fn run_live_controls_panel<'a>(
    root: &'a AppRoot,
    cx: &'a mut Context<AppRoot>,
) -> impl IntoElement + 'a {
    div()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_lg()
                .text_color(theme::text_primary())
                .child("Operator actions"),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_sm()
                .text_color(theme::text_muted())
                .child("Secondary runtime controls live here so the main queue/detail hierarchy stays aligned with the source product."),
        )
        .child(
            div()
                .mt(px(16.0))
                .flex()
                .gap_3()
                .child(primary_button("Launch native runtime", cx, |this, cx| {
                    this.launch_selected_run(cx);
                }))
                .child(secondary_button("Approve selected gate", cx, |this, cx| {
                    this.decide_selected_approval(
                        domain::ApprovalState::Approved,
                        "Approved from native runtime controls.",
                        cx,
                    );
                }))
                .child(secondary_button("Reject selected gate", cx, |this, cx| {
                    this.decide_selected_approval(
                        domain::ApprovalState::Rejected,
                        "Rejected from native runtime controls.",
                        cx,
                    );
                })),
        )
        .child(div().mt(px(16.0)).child(root.runtime_steer_input.clone()))
        .child(
            div()
                .mt(px(10.0))
                .flex()
                .justify_end()
                .child(primary_button("Send steer", cx, |this, cx| {
                    this.send_runtime_steer(cx);
                })),
        )
        .child(div().mt(px(16.0)).child(root.runtime_follow_up_input.clone()))
        .child(
            div()
                .mt(px(10.0))
                .flex()
                .justify_end()
                .child(secondary_button("Queue follow-up", cx, |this, cx| {
                    this.send_runtime_follow_up(cx);
                })),
        )
}

fn timeline_row(label: &'static str, value: String) -> impl IntoElement {
    div()
        .flex()
        .justify_between()
        .items_center()
        .py_2()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(div().text_sm().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .text_sm()
                .text_color(theme::text_primary())
                .child(value),
        )
}

fn run_filter_controls(cx_filter: RunFilter, cx: &mut Context<AppRoot>) -> impl IntoElement {
    div()
        .flex()
        .gap_2()
        .child(run_filter_chip(
            "All",
            cx_filter == RunFilter::All,
            RunFilter::All,
            cx,
        ))
        .child(run_filter_chip(
            "Running",
            cx_filter == RunFilter::Running,
            RunFilter::Running,
            cx,
        ))
        .child(run_filter_chip(
            "Needs review",
            cx_filter == RunFilter::NeedsReview,
            RunFilter::NeedsReview,
            cx,
        ))
        .child(run_filter_chip(
            "Finished",
            cx_filter == RunFilter::Finished,
            RunFilter::Finished,
            cx,
        ))
}

fn run_filter_chip(
    label: &'static str,
    active: bool,
    next: RunFilter,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    div()
        .id(SharedString::from(format!("run-filter-{label}")))
        .px_3()
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
            this.state.run_filter = next;
            cx.notify();
        }))
        .child(label)
}

fn run_matches_filter(
    snapshot: &domain::ProfileSnapshot,
    run: &domain::Run,
    filter: RunFilter,
) -> bool {
    match filter {
        RunFilter::All => true,
        RunFilter::Running => matches!(run.status.as_str(), "queued" | "running"),
        RunFilter::NeedsReview => run.task_id.as_ref().is_some_and(|task_id| {
            snapshot.approvals.iter().any(|approval| {
                approval.related_task_id.as_deref() == Some(task_id.as_str())
                    && approval.state == "pending"
            })
        }),
        RunFilter::Finished => {
            matches!(run.status.as_str(), "completed" | "failed" | "cancelled")
        }
    }
}

fn run_matches_query(snapshot: &domain::ProfileSnapshot, run: &domain::Run, query: &str) -> bool {
    if query.trim().is_empty() {
        return true;
    }
    let query = query.trim();
    let title = run_task_title(snapshot, run).to_lowercase();
    let subtitle = run_subtitle(snapshot, run).to_lowercase();
    let summary = run.summary.to_lowercase();
    title.contains(query) || subtitle.contains(query) || summary.contains(query)
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

fn short_date(value: &str) -> &str {
    value.get(..10).unwrap_or(value)
}
