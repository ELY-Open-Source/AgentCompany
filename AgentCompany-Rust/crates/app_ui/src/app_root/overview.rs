use super::*;

impl AppRoot {
    pub(super) fn render_overview(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let pending_approvals = self
            .snapshot
            .approvals
            .iter()
            .filter(|approval| approval.state == "pending")
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
        let unread_messages = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|message| message.read_at.is_none())
            .collect::<Vec<_>>();
        let budget_alerts = self
            .snapshot
            .agents
            .iter()
            .filter(|agent| {
                agent.budget_monthly_usd > 0.0
                    && agent.spent_monthly_usd >= agent.budget_monthly_usd * 0.8
            })
            .collect::<Vec<_>>();
        let interrupted_runs = self
            .snapshot
            .runs
            .iter()
            .filter(|run| run.status == "interrupted")
            .collect::<Vec<_>>();
        let active_work = self
            .snapshot
            .runs
            .iter()
            .filter(|run| matches!(run.status.as_str(), "queued" | "running"))
            .take(8)
            .collect::<Vec<_>>();
        let total_spend = self
            .snapshot
            .runs
            .iter()
            .filter_map(|run| run.cost_usd)
            .sum::<f64>();

        div()
            .flex()
            .flex_col()
            .gap_6()
            .when(!interrupted_runs.is_empty(), |container| {
                container.child(recovery_banner(interrupted_runs.as_slice()))
            })
            .when(!budget_alerts.is_empty(), |container| {
                container.child(budget_alert_banner(budget_alerts.as_slice()))
            })
            .child(
                div()
                    .grid()
                    .grid_cols(4)
                    .gap_3()
                    .child(metric_card(
                        "ACTIVE TASKS",
                        self.snapshot.active_tasks().to_string(),
                        format!(
                            "{} queued",
                            self.snapshot
                                .tasks
                                .iter()
                                .filter(|task| task.status == "todo")
                                .count()
                        ),
                        theme::accent_blue_soft(),
                        theme::accent_blue(),
                    ))
                    .child(metric_card(
                        "APPROVALS",
                        pending_approvals.len().to_string(),
                        if pending_approvals.is_empty() {
                            "All clear".to_string()
                        } else {
                            "Needs attention".to_string()
                        },
                        theme::accent_orange_soft(),
                        theme::accent_orange(),
                    ))
                    .child(metric_card(
                        "AGENTS",
                        self.snapshot.agents.len().to_string(),
                        format!(
                            "{} running",
                            self.snapshot
                                .agents
                                .iter()
                                .filter(|agent| agent.status == "running")
                                .count()
                        ),
                        theme::accent_teal_soft(),
                        theme::accent_teal(),
                    ))
                    .child(metric_card(
                        "TOTAL SPEND",
                        format!("${total_spend:.2}"),
                        "Local profile budget trace".to_string(),
                        theme::panel_muted(),
                        theme::text_primary(),
                    )),
            )
            .when(
                !(pending_approvals.is_empty()
                    && failed_runs.is_empty()
                    && unread_messages.is_empty()),
                |container| {
                    container.child(section_label("NEEDS ATTENTION")).child(
                        div()
                            .gap_2()
                            .children(pending_approvals.iter().take(5).map(|approval| {
                                attention_row(
                                    approval.payload_summary.clone(),
                                    format!(
                                        "{} · pending",
                                        approval.approval_type.replace('_', " ")
                                    ),
                                    theme::accent_orange_soft(),
                                    theme::accent_orange(),
                                )
                            }))
                            .children(failed_runs.iter().take(3).map(|run| {
                                attention_row(
                                    overview_run_title(&self.snapshot, run),
                                    run.error_message
                                        .clone()
                                        .unwrap_or_else(|| run.status.clone()),
                                    theme::danger_bg(),
                                    theme::danger(),
                                )
                            }))
                            .children(unread_messages.iter().take(3).map(|message| {
                                attention_row(
                                    message.subject.clone(),
                                    message.body.clone(),
                                    theme::accent_teal_soft(),
                                    theme::accent_teal(),
                                )
                            })),
                    )
                },
            )
            .child(section_label("PERFORMANCE"))
            .child(
                div()
                    .grid()
                    .grid_cols(2)
                    .gap_3()
                    .child(run_activity_card(&self.snapshot))
                    .child(success_rate_card(&self.snapshot))
                    .child(cost_trend_card(&self.snapshot))
                    .child(agent_workload_card(&self.snapshot)),
            )
            .child(section_label("ACTIVE WORK"))
            .child(active_work_card(&self.snapshot, active_work.as_slice(), cx))
            .child(section_label("RECENT ACTIVITY"))
            .child(activity_feed_card(&self.snapshot))
    }
}

fn recovery_banner(runs: &[&domain::Run]) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::danger())
        .bg(theme::danger_bg())
        .p_4()
        .gap_3()
        .child(div().text_sm().text_color(theme::danger()).child(format!(
            "{} interrupted task(s) detected from the previous session",
            runs.len()
        )))
        .children(runs.iter().map(|run| {
            div()
                .rounded_md()
                .bg(theme::panel())
                .px_4()
                .py_3()
                .child(
                    div()
                        .text_sm()
                        .text_color(theme::text_primary())
                        .child(overview_run_title_from_run(run)),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_xs()
                        .text_color(theme::text_muted())
                        .child(run.id.get(..8).unwrap_or(run.id.as_str()).to_string()),
                )
        }))
}

fn budget_alert_banner(agents: &[&domain::Agent]) -> impl IntoElement {
    div().gap_2().children(agents.iter().map(|agent| {
        div()
            .rounded_lg()
            .border_1()
            .border_color(theme::danger())
            .bg(theme::accent_orange_soft())
            .px_4()
            .py_3()
            .child(
                div()
                    .text_sm()
                    .text_color(theme::accent_orange())
                    .child(format!(
                        "{} is at ${:.2} / ${:.2} monthly budget.",
                        agent.name, agent.spent_monthly_usd, agent.budget_monthly_usd
                    )),
            )
    }))
}

fn metric_card(
    label: &'static str,
    value: String,
    subtitle: String,
    icon_bg: gpui::Hsla,
    tone: gpui::Hsla,
) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_4()
        .child(
            div()
                .flex()
                .gap_4()
                .items_center()
                .child(div().w(px(48.0)).h(px(48.0)).rounded_lg().bg(icon_bg))
                .child(
                    div()
                        .flex_1()
                        .child(div().text_xs().text_color(theme::text_muted()).child(label))
                        .child(div().text_3xl().text_color(tone).child(value))
                        .child(
                            div()
                                .mt(px(6.0))
                                .text_xs()
                                .text_color(theme::text_muted())
                                .child(subtitle),
                        ),
                ),
        )
}

fn section_label(label: &'static str) -> impl IntoElement {
    div().text_xs().text_color(theme::text_muted()).child(label)
}

fn attention_row(
    title: String,
    subtitle: String,
    tile_bg: gpui::Hsla,
    accent: gpui::Hsla,
) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .px_4()
        .py_3()
        .child(
            div()
                .flex()
                .gap_3()
                .items_center()
                .child(div().w(px(36.0)).h(px(36.0)).rounded_lg().bg(tile_bg))
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
                                .text_xs()
                                .text_color(theme::text_muted())
                                .line_clamp(2)
                                .child(subtitle),
                        ),
                )
                .child(div().w(px(10.0)).h(px(10.0)).rounded_full().bg(accent)),
        )
}

fn run_activity_card(snapshot: &domain::ProfileSnapshot) -> impl IntoElement {
    let queued = snapshot
        .runs
        .iter()
        .filter(|run| run.status == "queued")
        .count();
    let running = snapshot
        .runs
        .iter()
        .filter(|run| run.status == "running")
        .count();
    let completed = snapshot
        .runs
        .iter()
        .filter(|run| run.status == "completed")
        .count();
    mini_chart_card(
        "RUN ACTIVITY",
        vec![
            ("queued".to_string(), queued),
            ("running".to_string(), running),
            ("completed".to_string(), completed),
        ],
        theme::accent_blue(),
    )
}

fn success_rate_card(snapshot: &domain::ProfileSnapshot) -> impl IntoElement {
    let finished = snapshot
        .runs
        .iter()
        .filter(|run| matches!(run.status.as_str(), "completed" | "failed" | "timed_out"))
        .count();
    let completed = snapshot
        .runs
        .iter()
        .filter(|run| run.status == "completed")
        .count();
    let rate = if finished == 0 {
        0.0
    } else {
        completed as f32 / finished as f32
    };
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_xs()
                .text_color(theme::text_muted())
                .child("SUCCESS RATE"),
        )
        .child(
            div()
                .mt(px(10.0))
                .text_3xl()
                .text_color(theme::accent_teal())
                .child(format!("{:.0}%", rate * 100.0)),
        )
        .child(
            div()
                .mt(px(10.0))
                .h(px(10.0))
                .rounded_full()
                .bg(theme::panel_muted())
                .child(
                    div()
                        .w(gpui::relative(rate.clamp(0.0, 1.0)))
                        .h_full()
                        .rounded_full()
                        .bg(theme::accent_teal()),
                ),
        )
}

fn cost_trend_card(snapshot: &domain::ProfileSnapshot) -> impl IntoElement {
    let costs = snapshot
        .runs
        .iter()
        .filter_map(|run| run.cost_usd)
        .collect::<Vec<_>>();
    let total = costs.iter().sum::<f64>();
    let average = if costs.is_empty() {
        0.0
    } else {
        total / costs.len() as f64
    };
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_xs()
                .text_color(theme::text_muted())
                .child("COST TREND"),
        )
        .child(
            div()
                .mt(px(10.0))
                .text_3xl()
                .text_color(theme::text_primary())
                .child(format!("${total:.2}")),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_xs()
                .text_color(theme::text_muted())
                .child(format!("Average ${average:.2} per metered run")),
        )
}

fn agent_workload_card(snapshot: &domain::ProfileSnapshot) -> impl IntoElement {
    let rows = snapshot
        .agents
        .iter()
        .map(|agent| {
            let active_runs = snapshot
                .runs
                .iter()
                .filter(|run| run.agent_id == agent.id)
                .count();
            (agent.name.clone(), active_runs)
        })
        .collect::<Vec<_>>();
    mini_chart_card("AGENT WORKLOAD", rows, theme::accent_orange())
}

fn mini_chart_card(
    label: &'static str,
    rows: Vec<(String, usize)>,
    accent: gpui::Hsla,
) -> impl IntoElement {
    let max = rows
        .iter()
        .map(|(_, count)| *count)
        .max()
        .unwrap_or(1)
        .max(1) as f32;
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .children(rows.into_iter().map(|(name, count)| {
            div()
                .mt(px(12.0))
                .child(
                    div()
                        .flex()
                        .justify_between()
                        .child(
                            div()
                                .text_sm()
                                .text_color(theme::text_primary())
                                .child(name),
                        )
                        .child(
                            div()
                                .text_xs()
                                .text_color(theme::text_muted())
                                .child(count.to_string()),
                        ),
                )
                .child(
                    div()
                        .mt(px(6.0))
                        .h(px(8.0))
                        .rounded_full()
                        .bg(theme::panel_muted())
                        .child(
                            div()
                                .w(gpui::relative((count as f32 / max).clamp(0.0, 1.0)))
                                .h_full()
                                .rounded_full()
                                .bg(accent),
                        ),
                )
        }))
}

fn active_work_card<'a>(
    snapshot: &'a domain::ProfileSnapshot,
    runs: &[&'a domain::Run],
    cx: &mut Context<AppRoot>,
) -> impl IntoElement + 'a {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .when(runs.is_empty(), |container| {
            container.child(
                div()
                    .p_6()
                    .text_center()
                    .text_color(theme::text_muted())
                    .child("No tasks are running right now."),
            )
        })
        .when(!runs.is_empty(), |container| {
            container.children(runs.iter().map(|run| {
                let run_id = run.id.clone();
                div()
                    .id(SharedString::from(format!("overview-run-{run_id}")))
                    .cursor_pointer()
                    .hover(|style| style.bg(theme::panel_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.section = SectionId::Runs;
                        this.state.selected_run_id = Some(run_id.clone());
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
                            .child(overview_run_title(snapshot, run)),
                    )
                    .child(
                        div()
                            .mt(px(4.0))
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} · {}",
                                overview_run_agent(snapshot, run),
                                run.status
                            )),
                    )
            }))
        })
}

fn activity_feed_card(snapshot: &domain::ProfileSnapshot) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .children(snapshot.activity.iter().take(10).map(|item| {
            div()
                .px_5()
                .py_4()
                .border_b_1()
                .border_color(theme::panel_border())
                .child(
                    div()
                        .text_sm()
                        .text_color(theme::text_primary())
                        .child(format!("{} {}", item.actor, item.action.replace('_', " "))),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_xs()
                        .text_color(theme::text_muted())
                        .child(item.detail.clone()),
                )
        }))
}

fn overview_run_title(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    run.task_id
        .as_ref()
        .and_then(|task_id| snapshot.tasks.iter().find(|task| &task.id == task_id))
        .map(|task| task.title.clone())
        .unwrap_or_else(|| overview_run_title_from_run(run))
}

fn overview_run_title_from_run(run: &domain::Run) -> String {
    if run.summary.trim().is_empty() {
        format!("Run {}", run.id.get(..8).unwrap_or(run.id.as_str()))
    } else {
        run.summary.clone()
    }
}

fn overview_run_agent(snapshot: &domain::ProfileSnapshot, run: &domain::Run) -> String {
    snapshot
        .agents
        .iter()
        .find(|agent| agent.id == run.agent_id)
        .map(|agent| agent.name.clone())
        .unwrap_or_else(|| run.agent_id.clone())
}
