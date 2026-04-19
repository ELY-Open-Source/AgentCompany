use super::*;
use app_models::OnboardingStep;
use gpui::{Animation, AnimationExt, Hsla, SharedString, pulsating_between, rgb};
use std::time::Duration;

impl AppRoot {
    pub(super) fn render_onboarding(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let step = self.state.onboarding_step;
        let readiness = onboarding_readiness(
            &self.snapshot,
            self.state.onboarding_connector_id.as_deref(),
        );

        div().size_full().bg(theme::window_bg()).child(
            div()
                .size_full()
                .flex()
                .child(self.render_onboarding_story(step, &readiness))
                .child(div().w(px(12.0)).bg(theme::split_divider()))
                .child(self.render_onboarding_panel(step, cx)),
        )
    }

    fn render_onboarding_story(
        &self,
        step: OnboardingStep,
        readiness: &[ConnectorReadiness<'_>],
    ) -> impl IntoElement + '_ {
        div()
            .flex_1()
            .flex()
            .items_center()
            .justify_center()
            .child(
                div()
                    .w(px(620.0))
                    .gap_8()
                    .child(onboarding_eyebrow("AGENTCOMPANY DESKTOP"))
                    .child(
                        div()
                            .text_color(theme::text_primary())
                            .child(
                                div()
                                    .text_size(px(68.0))
                                    .line_height(px(68.0))
                                    .child("Start a real local-first"),
                            )
                            .child(
                                div()
                                    .text_size(px(68.0))
                                    .line_height(px(68.0))
                                    .child("agent company."),
                            ),
                    )
                    .child(
                        div()
                            .max_w(px(560.0))
                            .text_size(px(18.0))
                            .line_height(px(30.0))
                            .text_color(theme::text_muted())
                            .child("Set up your company, connect a runtime, choose an execution mode, and launch the first native operating loop."),
                    )
                    .child(onboarding_stepper(step))
                    .child(
                        div()
                            .mt(px(44.0))
                            .gap_5()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme::text_muted())
                                    .child("CONNECTOR READINESS"),
                            )
                            .children(readiness.iter().map(|item| readiness_row(item))),
                    )
                    .child(div().mt(px(56.0)).child(onboarding_eyebrow("BY ELYDORA"))),
            )
    }

    fn render_onboarding_panel(
        &self,
        step: OnboardingStep,
        cx: &mut Context<Self>,
    ) -> impl IntoElement + '_ {
        div()
            .w(px(620.0))
            .flex()
            .items_center()
            .justify_center()
            .child(match step {
                OnboardingStep::NodeCheck => self.render_nodecheck_panel(cx).into_any_element(),
                OnboardingStep::Providers => self.render_providers_panel(cx).into_any_element(),
                OnboardingStep::Company => self.render_company_setup_panel(cx).into_any_element(),
                OnboardingStep::ModelPool => self.render_model_pool_panel(cx).into_any_element(),
                OnboardingStep::ExecutionMode => {
                    self.render_execution_mode_panel(cx).into_any_element()
                }
                OnboardingStep::Mission => self.render_mission_setup_panel(cx).into_any_element(),
                OnboardingStep::Launch => self.render_launch_summary_panel(cx).into_any_element(),
            })
    }

    fn render_nodecheck_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let ready_connectors = self
            .snapshot
            .connectors
            .iter()
            .filter(|connector| connector.status == "ready" || connector.auth_state == "ready")
            .count();
        onboarding_card()
            .child(step_counter("NODECHECK", 1, 7))
            .child(card_title("Verify the local runtime boundary"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(onboarding_metric_row(
                        "Connector inventory",
                        format!("{} configured", self.snapshot.connectors.len()),
                    ))
                    .child(onboarding_metric_row(
                        "Ready runtimes",
                        format!("{} ready", ready_connectors),
                    ))
                    .child(onboarding_metric_row(
                        "Workspace binding",
                        if self.workspace_input.read(cx).value().trim().is_empty() {
                            "Set in company step".to_string()
                        } else {
                            "Path captured".to_string()
                        },
                    ))
                    .child(
                        div()
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child(
                                "The native desktop path boots a real local-first company profile. This step keeps the original wizard contract honest before provider and mission setup.",
                            ),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_end()
                    .child(primary_button("Continue to providers", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Providers;
                        cx.notify();
                    })),
            )
    }

    fn render_providers_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let connector_options = primary_connector_options(&self.snapshot);
        let selected_connector_id = self
            .state
            .onboarding_connector_id
            .as_deref()
            .unwrap_or("anthropic");

        onboarding_card()
            .child(step_counter("PROVIDERS", 2, 7))
            .child(card_title("Choose the founding runtime"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(div().flex().flex_wrap().gap_2().children(
                        connector_options.into_iter().map(|connector| {
                            let active = connector.id == selected_connector_id;
                            let connector_id = connector.id.clone();
                            selectable_chip(
                                connector.label.as_str(),
                                active,
                                cx,
                                move |this, cx| {
                                    this.state.onboarding_connector_id = Some(connector_id.clone());
                                    cx.notify();
                                },
                            )
                            .into_any_element()
                        }),
                    ))
                    .child(
                        div()
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child(onboarding_connector_note(
                                &self.snapshot,
                                selected_connector_id,
                            )),
                    )
                    .child(
                        div()
                            .gap_3()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme::text_muted())
                                    .child("READINESS"),
                            )
                            .children(
                                onboarding_readiness(
                                    &self.snapshot,
                                    self.state.onboarding_connector_id.as_deref(),
                                )
                                .iter()
                                .map(readiness_row),
                            ),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::NodeCheck;
                        cx.notify();
                    }))
                    .child(primary_button("Continue to company", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Company;
                        cx.notify();
                    })),
            )
    }

    fn render_company_setup_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        onboarding_card()
            .child(step_counter("COMPANY", 3, 7))
            .child(card_title("Set up the company shell"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(self.company_name_input.clone())
                    .child(self.mission_input.clone())
                    .child(self.workspace_input.clone())
                    .child(
                        div()
                            .mt(px(6.0))
                            .text_xs()
                            .line_height(px(20.0))
                            .text_color(theme::text_muted())
                            .child("The workspace path becomes the default execution boundary for the first operating loop."),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Providers;
                        cx.notify();
                    }))
                    .child(primary_button("Continue to model pool", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::ModelPool;
                        cx.notify();
                    })),
            )
    }

    fn render_model_pool_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let connector = self
            .state
            .onboarding_connector_id
            .as_deref()
            .and_then(|connector_id| {
                self.snapshot
                    .connectors
                    .iter()
                    .find(|connector| connector.id == connector_id)
            });
        onboarding_card()
            .child(step_counter("MODELPOOL", 4, 7))
            .child(card_title("Review the active model pool"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(onboarding_metric_row(
                        "Selected runtime",
                        connector
                            .map(|item| item.label.clone())
                            .unwrap_or_else(|| "No connector selected".to_string()),
                    ))
                    .child(onboarding_metric_row(
                        "Default model",
                        connector
                            .and_then(|item| item.model.clone())
                            .unwrap_or_else(|| "Use connector default".to_string()),
                    ))
                    .child(onboarding_metric_row(
                        "Status",
                        connector
                            .map(|item| {
                                if item.status.is_empty() {
                                    "Unknown".to_string()
                                } else {
                                    item.status.clone()
                                }
                            })
                            .unwrap_or_else(|| "Pending".to_string()),
                    ))
                    .child(
                        div()
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child("The original flow paused here to confirm the provider/model surface before execution mode. Native onboarding now preserves that pause with live connector data instead of a collapsed shortcut."),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Company;
                        cx.notify();
                    }))
                    .child(primary_button("Continue to execution mode", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::ExecutionMode;
                        cx.notify();
                    })),
            )
    }

    fn render_execution_mode_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        onboarding_card()
            .child(step_counter("EXECUTIONMODE", 5, 7))
            .child(card_title("Choose how the company executes"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(selectable_chip(
                                "AI CEO",
                                self.state.onboarding_execution_mode == "ai_ceo",
                                cx,
                                |this, cx| {
                                    this.state.onboarding_execution_mode = "ai_ceo";
                                    cx.notify();
                                },
                            ))
                            .child(selectable_chip(
                                "AI Co-Founder",
                                self.state.onboarding_execution_mode == "ai_cofounder",
                                cx,
                                |this, cx| {
                                    this.state.onboarding_execution_mode = "ai_cofounder";
                                    cx.notify();
                                },
                            )),
                    )
                    .child(
                        div()
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child(onboarding_execution_mode_note(
                                self.state.onboarding_execution_mode,
                            )),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::ModelPool;
                        cx.notify();
                    }))
                    .child(primary_button("Continue to mission", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Mission;
                        cx.notify();
                    })),
            )
    }

    fn render_mission_setup_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        onboarding_card()
            .child(step_counter("MISSION", 6, 7))
            .child(card_title("Define the founding mission"))
            .child(card_divider())
            .child(
                div()
                    .gap_4()
                    .child(self.onboarding_goal_input.clone())
                    .child(self.onboarding_goal_detail_input.clone())
                    .child(
                        div()
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel_inset())
                            .p_4()
                            .text_sm()
                            .line_height(px(22.0))
                            .text_color(theme::text_secondary())
                            .child("This mission becomes the first goal, kickoff project brief, and the queued launch run summary inside the local profile."),
                    ),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::ExecutionMode;
                        cx.notify();
                    }))
                    .child(primary_button("Review launch", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Launch;
                        cx.notify();
                    })),
            )
    }

    fn render_launch_summary_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let connector_id = self
            .state
            .onboarding_connector_id
            .as_deref()
            .unwrap_or("anthropic");
        let connector_label = self
            .snapshot
            .connectors
            .iter()
            .find(|connector| connector.id == connector_id)
            .map(|connector| connector.label.clone())
            .unwrap_or_else(|| connector_id.to_string());
        let company_name = self.company_name_input.read(cx).value();
        let workspace_path = self.workspace_input.read(cx).value();
        let workspace_value = if workspace_path.trim().is_empty() {
            "No workspace selected".to_string()
        } else {
            "Registered".to_string()
        };
        let goal_title = self.onboarding_goal_input.read(cx).value();

        onboarding_card()
            .child(success_badge())
            .child(step_counter("LAUNCH", 7, 7))
            .child(
                div()
                    .mt(px(20.0))
                    .text_size(px(32.0))
                    .line_height(px(38.0))
                    .text_color(theme::text_primary())
                    .child(if company_name.trim().is_empty() {
                        "Company profile is ready to launch.".to_string()
                    } else {
                        format!("{} is ready to launch.", company_name.trim())
                    }),
            )
            .child(
                div()
                    .mt(px(16.0))
                    .text_size(px(16.0))
                    .line_height(px(26.0))
                    .text_color(theme::text_muted())
                    .child("Company, workspace, goal, lead agent, kickoff project, task, and the initial queued run will be created in the local profile."),
            )
            .child(
                div()
                    .mt(px(28.0))
                    .grid()
                    .grid_cols(2)
                    .gap_4()
                    .child(summary_tile("CONNECTOR", connector_label))
                    .child(summary_tile("LEAD AGENT", "CEO agent created".to_string()))
                    .child(summary_tile("PRIMARY WORKSPACE", workspace_value))
                    .child(summary_tile("KICKOFF PROJECT", "Created".to_string()))
                    .child(summary_tile(
                        "INITIAL RUN",
                        if goal_title.trim().is_empty() {
                            "Queued".to_string()
                        } else {
                            format!("Queued for {}", goal_title.trim())
                        },
                    )),
            )
            .child(
                div()
                    .mt(px(32.0))
                    .flex()
                    .justify_between()
                    .child(secondary_button("Back", cx, |this, cx| {
                        this.state.onboarding_step = OnboardingStep::Mission;
                        cx.notify();
                    }))
                    .child(primary_button("Open Control Center", cx, |this, cx| {
                        this.create_company(cx);
                    })),
            )
    }
}

struct ConnectorReadiness<'a> {
    label: &'a str,
    state: &'a str,
    help: Option<&'a str>,
    tone: ReadinessTone,
}

#[derive(Clone, Copy)]
enum ReadinessTone {
    Ready,
    Warning,
    Neutral,
}

fn onboarding_readiness<'a>(
    snapshot: &'a domain::ProfileSnapshot,
    selected_connector_id: Option<&'a str>,
) -> Vec<ConnectorReadiness<'a>> {
    let mut rows = Vec::new();
    let priority = [
        selected_connector_id.unwrap_or("anthropic"),
        "openai-codex",
        "gemini-cli",
    ];
    for connector_id in priority {
        if let Some(connector) = snapshot
            .connectors
            .iter()
            .find(|item| item.id == connector_id)
        {
            let tone = if connector.status == "ready" || connector.auth_state == "ready" {
                ReadinessTone::Ready
            } else if connector.last_error.is_some() || connector.auth_state == "auth_required" {
                ReadinessTone::Warning
            } else {
                ReadinessTone::Neutral
            };
            let state = if connector.status == "ready" {
                "ready"
            } else if connector.auth_state == "ready" {
                "authenticated"
            } else if connector.auth_state == "auth_required" {
                "auth required"
            } else if connector.status.is_empty() {
                "unknown"
            } else {
                connector.status.as_str()
            };
            let help = connector.last_error.as_deref().or_else(|| {
                (!connector.notes.trim().is_empty()).then_some(connector.notes.as_str())
            });
            rows.push(ConnectorReadiness {
                label: connector.label.as_str(),
                state,
                help,
                tone,
            });
        }
    }
    rows
}

fn primary_connector_options(snapshot: &domain::ProfileSnapshot) -> Vec<&domain::Connector> {
    let preferred = ["anthropic", "openai-codex", "claude-pro", "gemini-cli"];
    let mut options = Vec::new();
    for connector_id in preferred {
        if let Some(connector) = snapshot
            .connectors
            .iter()
            .find(|item| item.id == connector_id)
        {
            options.push(connector);
        }
    }
    if options.is_empty() {
        snapshot.connectors.iter().take(4).collect()
    } else {
        options
    }
}

fn onboarding_eyebrow(label: &'static str) -> impl IntoElement {
    div()
        .flex()
        .gap_3()
        .items_center()
        .child(div().w(px(44.0)).h(px(1.0)).bg(theme::text_subtle()))
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
}

fn onboarding_stepper(step: OnboardingStep) -> impl IntoElement {
    let steps = [
        ("Node check", OnboardingStep::NodeCheck),
        ("Providers", OnboardingStep::Providers),
        ("Company", OnboardingStep::Company),
        ("Model pool", OnboardingStep::ModelPool),
        ("Execution mode", OnboardingStep::ExecutionMode),
        ("Mission", OnboardingStep::Mission),
        ("Launch", OnboardingStep::Launch),
    ];
    let active_index = steps
        .iter()
        .position(|(_, current)| *current == step)
        .unwrap_or_default();

    let mut children = Vec::new();
    for (index, (label, current_step)) in steps.into_iter().enumerate() {
        if index > 0 {
            children.push(step_connector(index <= active_index).into_any_element());
        }
        children.push(
            major_step_chip(label, step == current_step, index < active_index).into_any_element(),
        );
    }

    div()
        .mt(px(12.0))
        .flex()
        .gap_3()
        .items_center()
        .children(children)
}

fn major_step_chip(label: &'static str, current: bool, complete: bool) -> impl IntoElement {
    let bg = if complete {
        theme::accent_teal_soft()
    } else if current {
        theme::panel_muted()
    } else {
        rgb(0xf1f3f7).into()
    };
    let chip = div()
        .px_4()
        .py_2()
        .rounded_full()
        .bg(bg)
        .text_sm()
        .text_color(if complete {
            theme::accent_teal()
        } else {
            theme::text_secondary()
        })
        .child(label);
    if current {
        chip.with_animation(
            ("onboarding-major-step", label.len()),
            Animation::new(Duration::from_secs(2))
                .repeat()
                .with_easing(pulsating_between(0.84, 1.0)),
            |element, delta| element.opacity(delta),
        )
        .into_any_element()
    } else {
        chip.into_any_element()
    }
}

fn step_connector(active: bool) -> impl IntoElement {
    div().w(px(42.0)).h(px(1.0)).bg(if active {
        theme::accent_teal_soft()
    } else {
        theme::panel_border()
    })
}

fn onboarding_metric_row(label: &'static str, value: String) -> impl IntoElement {
    div()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel_inset())
        .p_4()
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .mt(px(8.0))
                .text_sm()
                .text_color(theme::text_primary())
                .child(value),
        )
}

fn readiness_row(row: &ConnectorReadiness<'_>) -> impl IntoElement {
    div()
        .gap_2()
        .child(
            div()
                .flex()
                .gap_3()
                .items_center()
                .child(readiness_dot(row.tone))
                .child(
                    div()
                        .text_base()
                        .text_color(theme::text_primary())
                        .child(row.label.to_string()),
                )
                .child(
                    div()
                        .text_base()
                        .text_color(theme::text_muted())
                        .child(row.state.to_string()),
                ),
        )
        .when_some(row.help, |container, help| {
            container.child(
                div()
                    .pl(px(28.0))
                    .text_sm()
                    .line_height(px(22.0))
                    .text_color(theme::text_muted())
                    .child(help.to_string()),
            )
        })
}

fn readiness_dot(tone: ReadinessTone) -> impl IntoElement {
    let color: Hsla = match tone {
        ReadinessTone::Ready => theme::accent_teal(),
        ReadinessTone::Warning => theme::accent_orange(),
        ReadinessTone::Neutral => theme::badge_dark(),
    };
    div().w(px(16.0)).h(px(16.0)).rounded_full().bg(color)
}

fn onboarding_card() -> gpui::Div {
    div()
        .w(px(650.0))
        .p_10()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
}

fn step_counter(label: &'static str, index: usize, total: usize) -> impl IntoElement {
    div()
        .text_xs()
        .text_color(theme::text_muted())
        .child(format!("{} {} / {}", label, index, total))
}

fn card_title(label: &'static str) -> impl IntoElement {
    div()
        .mt(px(8.0))
        .text_size(px(24.0))
        .line_height(px(30.0))
        .text_color(theme::text_primary())
        .child(label)
}

fn card_divider() -> impl IntoElement {
    div()
        .mt(px(12.0))
        .mb(px(24.0))
        .h(px(1.0))
        .bg(theme::panel_border())
}

fn selectable_chip<V>(
    label: &str,
    active: bool,
    cx: &mut Context<V>,
    on_click: impl Fn(&mut V, &mut Context<V>) + 'static,
) -> impl IntoElement
where
    V: 'static,
{
    div()
        .id(SharedString::from(format!("onboarding-chip-{label}")))
        .px_4()
        .py_2()
        .rounded_full()
        .cursor_pointer()
        .bg(if active {
            theme::primary_action()
        } else {
            theme::panel_muted()
        })
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
        .on_click(
            cx.listener(move |this, _: &gpui::ClickEvent, _: &mut Window, cx| on_click(this, cx)),
        )
        .child(label.to_string())
}

fn onboarding_connector_note(snapshot: &domain::ProfileSnapshot, connector_id: &str) -> String {
    snapshot
        .connectors
        .iter()
        .find(|connector| connector.id == connector_id)
        .map(|connector| {
            if !connector.notes.trim().is_empty() {
                connector.notes.clone()
            } else if !connector.description.trim().is_empty() {
                connector.description.clone()
            } else {
                format!(
                    "{} will be bound to the founding CEO agent.",
                    connector.label
                )
            }
        })
        .unwrap_or_else(|| "The selected connector becomes the default CEO runtime.".to_string())
}

fn onboarding_execution_mode_note(mode: &str) -> &'static str {
    match mode {
        "ai_cofounder" => {
            "AI Co-Founder keeps human review tighter on deliverables while preserving a shared planning loop."
        }
        _ => {
            "AI CEO starts the company autonomously, boots the lead agent, creates the first project, and queues the kickoff run."
        }
    }
}

fn success_badge() -> impl IntoElement {
    div()
        .w(px(60.0))
        .h(px(60.0))
        .rounded_full()
        .bg(theme::success_bg())
        .child(
            div()
                .m(px(16.0))
                .w(px(28.0))
                .h(px(28.0))
                .rounded_full()
                .bg(theme::accent_teal())
                .with_animation(
                    "onboarding-success-badge",
                    Animation::new(Duration::from_secs(2))
                        .repeat()
                        .with_easing(pulsating_between(0.76, 1.0)),
                    |element, delta| element.opacity(delta),
                ),
        )
}

fn summary_tile(label: &'static str, value: String) -> impl IntoElement {
    div()
        .min_h(px(92.0))
        .p_5()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_inset_border())
        .bg(theme::panel_inset())
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .mt(px(10.0))
                .text_base()
                .text_color(theme::text_primary())
                .line_height(px(22.0))
                .child(value),
        )
}
