use super::*;

impl AppRoot {
    pub(super) fn render_runs(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_run_id
            .as_ref()
            .and_then(|id| self.snapshot.runs.iter().find(|item| &item.id == id));
        let selected_status = selected
            .map(|item| item.status.clone())
            .unwrap_or_else(|| "Select a run".to_string());
        let selected_summary = selected
            .map(|item| item.summary.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "No run selected.".to_string());
        let selected_model = selected
            .and_then(|item| item.model.clone())
            .unwrap_or_else(|| "model pending".to_string());
        let selected_agent = selected
            .and_then(|run| {
                self.snapshot
                    .agents
                    .iter()
                    .find(|agent| agent.id == run.agent_id)
                    .map(|agent| agent.name.clone())
            })
            .unwrap_or_else(|| "Agent unavailable".to_string());
        let selected_workspace = selected
            .and_then(|run| {
                run.workspace_id.as_ref().and_then(|workspace_id| {
                    self.snapshot
                        .workspaces
                        .iter()
                        .find(|workspace| &workspace.id == workspace_id)
                        .map(|workspace| workspace.name.clone())
                })
            })
            .unwrap_or_else(|| "Workspace pending".to_string());
        let selected_error = selected
            .and_then(|item| item.error_message.clone())
            .unwrap_or_default();

        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("runs-list")
                    .w(px(360.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Run queue"))
                    .children(self.snapshot.runs.iter().map(|item| {
                        let active =
                            self.state.selected_run_id.as_deref() == Some(item.id.as_str());
                        let run_id = item.id.clone();
                        let headline = if item.summary.trim().is_empty() {
                            format!("{} · {}", item.status, item.id)
                        } else {
                            format!("{} · {}", item.status, item.summary)
                        };
                        div()
                            .id(SharedString::from(format!("run-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_run_id = Some(run_id.clone());
                                cx.notify();
                            }))
                            .child(headline)
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Run inspector"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(selected_status),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(self.metric_card("Agent", selected_agent, "Assigned operator"))
                            .child(self.metric_card(
                                "Model",
                                selected_model,
                                "Runtime-selected model",
                            )),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(self.metric_card(
                                "Workspace",
                                selected_workspace,
                                "Bound workspace",
                            ))
                            .child(
                                self.metric_card(
                                    "Connector",
                                    selected
                                        .map(|item| item.connector_id.clone())
                                        .unwrap_or_else(|| "connector pending".to_string()),
                                    "Execution provider",
                                ),
                            ),
                    )
                    .child(
                        div()
                            .min_h(px(180.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(selected_summary),
                    )
                    .when(!selected_error.is_empty(), |container| {
                        container.child(
                            div()
                                .p_3()
                                .border_1()
                                .border_color(rgb(0x9e3d2d))
                                .rounded_md()
                                .bg(rgb(0xffefe8))
                                .child(selected_error),
                        )
                    }),
            )
    }
}
