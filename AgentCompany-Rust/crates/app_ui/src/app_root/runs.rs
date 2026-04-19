use super::*;

impl AppRoot {
    pub(super) fn render_runs(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_run_id
            .as_ref()
            .and_then(|id| self.snapshot.runs.iter().find(|item| &item.id == id));

        div()
            .flex()
            .gap_6()
            .child(
                div()
                    .id("runs-list")
                    .w(px(420.0))
                    .p_5()
                    .gap_4()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .overflow_scroll()
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .items_center()
                            .child(
                                div()
                                    .child(
                                        div()
                                            .text_xl()
                                            .text_color(theme::text_primary())
                                            .child("Run queue"),
                                    )
                                    .child(
                                        div()
                                            .mt(px(6.0))
                                            .text_sm()
                                            .text_color(theme::text_muted())
                                            .child(format!("{} runs", self.snapshot.runs.len())),
                                    ),
                            )
                            .child(run_filter_shell()),
                    )
                    .child(run_search_shell("Search runs"))
                    .children(self.snapshot.runs.iter().map(|item| {
                        let active =
                            self.state.selected_run_id.as_deref() == Some(item.id.as_str());
                        let run_id = item.id.clone();
                        let title = run_task_title(&self.snapshot, item);
                        let subtitle = run_subtitle(&self.snapshot, item);
                        let summary = if item.summary.trim().is_empty() {
                            "No summary yet".to_string()
                        } else {
                            item.summary.clone()
                        };
                        div()
                            .id(SharedString::from(format!("run-{}", item.id)))
                            .p_4()
                            .rounded_lg()
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
                            .child(
                                div()
                                    .flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .flex_1()
                                            .child(
                                                div()
                                                    .text_base()
                                                    .text_color(theme::text_primary())
                                                    .truncate()
                                                    .child(title),
                                            )
                                            .child(
                                                div()
                                                    .mt(px(6.0))
                                                    .text_sm()
                                                    .text_color(theme::text_muted())
                                                    .child(subtitle),
                                            ),
                                    )
                                    .child(run_status_badge(item.status.as_str())),
                            )
                            .child(
                                div()
                                    .mt(px(10.0))
                                    .text_sm()
                                    .text_color(theme::text_secondary())
                                    .line_clamp(2)
                                    .child(summary),
                            )
                            .when_some(item.updated_at.get(..10), |container, date| {
                                container.child(
                                    div()
                                        .mt(px(10.0))
                                        .text_xs()
                                        .text_color(theme::text_subtle())
                                        .child(date.to_string()),
                                )
                            })
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .gap_5()
                    .when_some(selected, |container, run| {
                        container
                            .child(
                                div()
                                    .p_5()
                                    .rounded_lg()
                                    .border_1()
                                    .border_color(theme::panel_border())
                                    .bg(theme::panel())
                                    .child(
                                        div()
                                            .text_xl()
                                            .text_color(theme::text_primary())
                                            .child(run_task_title(&self.snapshot, run)),
                                    )
                                    .child(
                                        div()
                                            .mt(px(8.0))
                                            .text_sm()
                                            .text_color(theme::text_muted())
                                            .child(run.status.clone()),
                                    )
                                    .child(
                                        div()
                                            .mt(px(16.0))
                                            .flex()
                                            .gap_3()
                                            .child(info_tile(
                                                "AGENT",
                                                run_agent_name(&self.snapshot, run),
                                            ))
                                            .child(info_tile(
                                                "MODEL",
                                                run.model.clone().unwrap_or_else(|| "Pending".to_string()),
                                            )),
                                    )
                                    .child(
                                        div()
                                            .mt(px(12.0))
                                            .flex()
                                            .gap_3()
                                            .child(info_tile(
                                                "WORKSPACE",
                                                run_workspace_name(&self.snapshot, run),
                                            ))
                                            .child(info_tile(
                                                "CONNECTOR",
                                                run.connector_id.clone(),
                                            )),
                                    )
                                    .child(
                                        div()
                                            .mt(px(18.0))
                                            .p_4()
                                            .rounded_lg()
                                            .border_1()
                                            .border_color(theme::panel_inset_border())
                                            .bg(theme::panel_inset())
                                            .child(if run.summary.trim().is_empty() {
                                                "No run summary yet.".to_string()
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
                                                    .p_4()
                                                    .rounded_lg()
                                                    .border_1()
                                                    .border_color(theme::danger())
                                                    .bg(theme::danger_bg())
                                                    .child(error),
                                            )
                                        }
                                    }),
                            )
                            .child(
                                div()
                                    .p_5()
                                    .rounded_lg()
                                    .border_1()
                                    .border_color(theme::panel_border())
                                    .bg(theme::panel())
                                    .child(
                                        div()
                                            .flex()
                                            .justify_between()
                                            .items_center()
                                            .child(
                                                div()
                                                    .text_lg()
                                                    .text_color(theme::text_primary())
                                                    .child("Run timeline"),
                                            )
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(theme::text_muted())
                                                    .child(short_date(run.updated_at.as_str()).to_string()),
                                            ),
                                    )
                                    .child(run_timeline(&self.snapshot, run)),
                            )
                    })
                    .when(selected.is_none(), |container| {
                        container.child(
                            div()
                                .min_h(px(320.0))
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
                                                .child("No run selected"),
                                        )
                                        .child(
                                            div()
                                                .mt(px(10.0))
                                                .text_base()
                                                .text_color(theme::text_muted())
                                                .child("Choose a run from the queue to inspect its status and execution context."),
                                        ),
                                ),
                        )
                    }),
            )
    }
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
    div()
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
        .child(status.to_uppercase())
}

fn info_tile(label: &'static str, value: String) -> impl IntoElement {
    div()
        .flex_1()
        .p_4()
        .rounded_lg()
        .bg(theme::panel_muted())
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .mt(px(8.0))
                .text_sm()
                .text_color(theme::text_primary())
                .child(value),
        )
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

fn run_filter_shell() -> impl IntoElement {
    div()
        .px_4()
        .py_3()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .text_sm()
        .text_color(theme::text_secondary())
        .child("All")
}

fn run_search_shell(label: &'static str) -> impl IntoElement {
    div()
        .px_4()
        .py_3()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .text_sm()
        .text_color(theme::text_subtle())
        .child(label)
}

fn short_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

fn short_date(value: &str) -> &str {
    value.get(..10).unwrap_or(value)
}
