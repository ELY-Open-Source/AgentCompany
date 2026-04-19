use super::*;

impl AppRoot {
    pub(super) fn render_overview(&self) -> impl IntoElement + '_ {
        let company = self.snapshot.current_company();
        let company_name = company
            .map(|item| item.name.clone())
            .unwrap_or_else(|| "No company".to_string());
        let queued_tasks = self
            .snapshot
            .tasks
            .iter()
            .filter(|task| task.status == "todo")
            .count();
        let running_agents = self
            .snapshot
            .agents
            .iter()
            .filter(|agent| agent.status == "running")
            .count();

        div()
            .flex()
            .flex_col()
            .gap_8()
            .child(
                div()
                    .gap_2()
                    .child(
                        div()
                            .text_3xl()
                            .text_color(theme::text_primary())
                            .child(company_name),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_3()
                            .items_center()
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(metadata_dot(theme::accent_teal()))
                            .child(format!("{} agents active", self.snapshot.agents.len()))
                            .child(div().child("•"))
                            .child(metadata_dot(theme::badge_dark()))
                            .child(format!("{} tasks in progress", self.snapshot.active_tasks()))
                            .child(div().child("•"))
                            .child(format!("{} completed", completed_task_count(&self.snapshot))),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(metric_panel(
                        "ACTIVE TASKS",
                        self.snapshot.active_tasks().to_string(),
                        format!("{} queued", queued_tasks),
                        theme::accent_blue_soft(),
                        theme::accent_blue(),
                    ))
                    .child(metric_panel(
                        "APPROVALS",
                        self.snapshot.pending_approvals().to_string(),
                        if self.snapshot.pending_approvals() == 0 {
                            "All clear".to_string()
                        } else {
                            "Needs board attention".to_string()
                        },
                        theme::panel_muted(),
                        theme::text_primary(),
                    ))
                    .child(metric_panel(
                        "AGENTS",
                        self.snapshot.agents.len().to_string(),
                        format!("{} running", running_agents),
                        theme::accent_teal_soft(),
                        theme::accent_teal(),
                    ))
                    .child(metric_panel(
                        "TOTAL SPEND",
                        total_spend_label(&self.snapshot),
                        "Local profile budget trace".to_string(),
                        theme::panel_muted(),
                        theme::text_primary(),
                    )),
            )
            .child(section_header("ACTIVE WORK", Some("All runs →")))
            .child(
                div()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .children(self.snapshot.runs.iter().take(6).map(|run| {
                        let task_title = self
                            .snapshot
                            .tasks
                            .iter()
                            .find(|task| Some(task.id.as_str()) == run.task_id.as_deref())
                            .map(|task| task.title.clone())
                            .unwrap_or_else(|| {
                                if run.summary.trim().is_empty() {
                                    format!("Run {}", trim_id(&run.id))
                                } else {
                                    run.summary.clone()
                                }
                            });
                        let agent_name = self
                            .snapshot
                            .agents
                            .iter()
                            .find(|agent| agent.id == run.agent_id)
                            .map(|agent| agent.name.clone())
                            .unwrap_or_else(|| "Unknown agent".to_string());
                        div()
                            .px_5()
                            .py_4()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .child(
                                div()
                                    .text_base()
                                    .text_color(theme::text_primary())
                                    .child(task_title),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!("{} · {}", agent_name, run.status)),
                            )
                    })),
            )
            .child(section_header("RECENT ACTIVITY", None))
            .child(
                div()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .children(self.snapshot.activity.iter().take(8).map(|item| {
                        div()
                            .px_5()
                            .py_4()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .child(
                                div()
                                    .text_base()
                                    .text_color(theme::text_primary())
                                    .child(format!("{} {}", item.actor, item.action.replace('_', " "))),
                            )
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(item.detail.clone()),
                            )
                    })),
            )
    }
}

fn completed_task_count(snapshot: &domain::ProfileSnapshot) -> usize {
    snapshot
        .tasks
        .iter()
        .filter(|task| task.status == "done")
        .count()
}

fn total_spend_label(snapshot: &domain::ProfileSnapshot) -> String {
    let spend = snapshot
        .runs
        .iter()
        .filter_map(|run| run.cost_usd)
        .sum::<f64>();
    format!("${spend:.2}")
}

fn trim_id(value: &str) -> &str {
    value.get(..8).unwrap_or(value)
}

fn metadata_dot(color: gpui::Hsla) -> impl IntoElement {
    div().w(px(8.0)).h(px(8.0)).rounded_full().bg(color)
}

fn section_header(label: &'static str, action: Option<&'static str>) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .justify_between()
        .child(
            div()
                .text_xs()
                .text_color(theme::text_muted())
                .child(label),
        )
        .when_some(action, |container, action_label| {
            container.child(
                div()
                    .text_sm()
                    .text_color(theme::accent_blue())
                    .child(action_label),
            )
        })
}

fn metric_panel(
    label: &'static str,
    value: String,
    detail: String,
    tile_bg: gpui::Hsla,
    value_color: gpui::Hsla,
) -> impl IntoElement {
    div()
        .flex_1()
        .p_5()
        .gap_3()
        .border_1()
        .rounded_lg()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .child(
            div()
                .w(px(56.0))
                .h(px(56.0))
                .rounded_lg()
                .bg(tile_bg),
        )
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(div().text_3xl().text_color(value_color).child(value))
        .child(div().text_sm().text_color(theme::text_muted()).child(detail))
}
