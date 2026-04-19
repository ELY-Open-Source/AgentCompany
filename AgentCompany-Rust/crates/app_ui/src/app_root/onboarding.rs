use super::*;
use gpui::{Animation, AnimationExt, pulsating_between};
use std::time::Duration;

impl AppRoot {
    pub(super) fn render_onboarding(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .size_full()
            .bg(theme::window_bg())
            .child(
                div()
                    .size_full()
                    .flex()
                    .child(
                        div()
                            .flex_1()
                            .p_8()
                            .gap_8()
                            .child(
                                div()
                                    .flex()
                                    .gap_2()
                                    .child(traffic_light(theme::danger()))
                                    .child(traffic_light(rgb_hex(0xfebc2e)))
                                    .child(traffic_light(rgb_hex(0x28c840))),
                            )
                            .child(div().h(px(80.0)))
                            .child(eyebrow("AGENTCOMPANY DESKTOP"))
                            .child(
                                div()
                                    .text_3xl()
                                    .text_color(theme::text_primary())
                                    .child("Start a real local-first")
                                    .child(div().child("agent company.")),
                            )
                            .child(
                                div()
                                    .text_lg()
                                    .text_color(theme::text_muted())
                                    .child("Set up your company, point it at a workspace, and launch")
                                    .child(div().child("the first native Rust control center.")),
                            )
                            .child(onboarding_steps())
                            .child(
                                div()
                                    .w(px(520.0))
                                    .p_5()
                                    .gap_4()
                                    .border_1()
                                    .rounded_lg()
                                    .border_color(theme::panel_border())
                                    .bg(theme::panel())
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::text_muted())
                                            .child("COMPANY SETUP"),
                                    )
                                    .child(self.company_name_input.clone())
                                    .child(self.mission_input.clone())
                                    .child(self.workspace_input.clone())
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::text_muted())
                                            .child("The native shell writes directly into SQLite with no cloud fallback."),
                                    ),
                            )
                            .child(readiness_panel())
                            .child(div().flex_1())
                            .child(eyebrow("BY ELYDORA")),
                    )
                    .child(
                        div()
                            .w(px(14.0))
                            .bg(theme::split_divider()),
                    )
                    .child(
                        div()
                            .w(px(520.0))
                            .p_8()
                            .child(
                                div()
                                    .mt(px(220.0))
                                    .p_8()
                                    .gap_5()
                                    .border_1()
                                    .rounded_lg()
                                    .border_color(theme::panel_border())
                                    .bg(theme::panel())
                                    .child(success_badge())
                                    .child(
                                        div()
                                            .text_2xl()
                                            .text_color(theme::text_primary())
                                            .child("Native shell ready."),
                                    )
                                    .child(
                                        div()
                                            .text_lg()
                                            .text_color(theme::text_muted())
                                            .child("Create the company record, register the workspace, and")
                                            .child(div().child("open the GPUI control center.")),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .gap_3()
                                            .child(launch_tile("CONNECTOR", "SQLite local profile"))
                                            .child(launch_tile("LEAD AGENT", "CEO shell created")),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .gap_3()
                                            .child(launch_tile("PRIMARY WORKSPACE", "Registered on create"))
                                            .child(launch_tile("KICKOFF PROJECT", "Created from first task")),
                                    )
                                    .child(launch_tile("INITIAL RUN", "Queued once company state lands"))
                                    .child(primary_button("Create company", cx, |this, cx| {
                                        this.create_company(cx)
                                    })),
                            ),
                    ),
            )
    }
}

fn eyebrow(label: &'static str) -> impl IntoElement {
    div()
        .flex()
        .gap_3()
        .items_center()
        .child(div().w(px(48.0)).h(px(1.0)).bg(theme::text_subtle()))
        .child(
            div()
                .text_xs()
                .text_color(theme::text_subtle())
                .child(label),
        )
}

fn onboarding_steps() -> impl IntoElement {
    div()
        .flex()
        .gap_3()
        .items_center()
        .child(step_chip("Company", true))
        .child(div().w(px(32.0)).h(px(1.0)).bg(theme::text_subtle()))
        .child(step_chip("Mission", true))
        .child(div().w(px(32.0)).h(px(1.0)).bg(theme::text_subtle()))
        .child(step_chip("Launch", false))
}

fn step_chip(label: &'static str, complete: bool) -> impl IntoElement {
    let chip = div()
        .px_4()
        .py_2()
        .rounded_full()
        .bg(if complete {
            theme::success_bg()
        } else {
            theme::panel_muted()
        })
        .text_sm()
        .text_color(if complete {
            theme::accent_teal()
        } else {
            theme::text_secondary()
        })
        .child(label);
    if complete {
        chip.with_animation(
            ("step-chip", label.len()),
            Animation::new(Duration::from_secs(3))
                .repeat()
                .with_easing(pulsating_between(0.78, 1.0)),
            |element, delta| element.opacity(delta),
        )
        .into_any_element()
    } else {
        chip.into_any_element()
    }
}

fn readiness_panel() -> impl IntoElement {
    div()
        .w(px(520.0))
        .gap_3()
        .child(
            div()
                .text_xs()
                .text_color(theme::text_muted())
                .child("CONNECTOR READINESS"),
        )
        .child(readiness_row("Claude Code", "ready", true))
        .child(readiness_row("Codex", "ready", true))
        .child(readiness_row("Gemini CLI", "auth required", false))
        .child(
            div()
                .pl(px(28.0))
                .text_xs()
                .text_color(theme::text_subtle())
                .child("Gemini CLI requires authentication before the runtime can use it."),
        )
}

fn readiness_row(label: &'static str, state: &'static str, ready: bool) -> impl IntoElement {
    div()
        .flex()
        .gap_3()
        .items_center()
        .child(div().w(px(16.0)).h(px(16.0)).rounded_full().bg(if ready {
            theme::accent_teal()
        } else {
            theme::accent_orange()
        }))
        .child(
            div()
                .text_sm()
                .text_color(theme::text_primary())
                .child(label),
        )
        .child(div().text_sm().text_color(theme::text_muted()).child(state))
}

fn success_badge() -> impl IntoElement {
    div()
        .w(px(72.0))
        .h(px(72.0))
        .rounded_full()
        .bg(theme::success_bg())
        .child(
            div()
                .m(px(20.0))
                .w(px(32.0))
                .h(px(32.0))
                .rounded_full()
                .bg(theme::accent_teal())
                .with_animation(
                    "success-badge-inner",
                    Animation::new(Duration::from_secs(2))
                        .repeat()
                        .with_easing(pulsating_between(0.72, 1.0)),
                    |element, delta| element.opacity(delta),
                ),
        )
}

fn launch_tile(label: &'static str, value: &'static str) -> impl IntoElement {
    div()
        .flex_1()
        .p_4()
        .gap_2()
        .rounded_lg()
        .bg(theme::panel_muted())
        .child(div().text_xs().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .text_sm()
                .text_color(theme::text_primary())
                .child(value),
        )
}

fn rgb_hex(hex: u32) -> gpui::Hsla {
    gpui::rgb(hex).into()
}

fn traffic_light(color: gpui::Hsla) -> impl IntoElement {
    div().w(px(12.0)).h(px(12.0)).rounded_full().bg(color)
}
