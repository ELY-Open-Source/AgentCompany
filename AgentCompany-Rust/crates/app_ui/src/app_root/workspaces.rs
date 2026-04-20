use super::*;

impl AppRoot {
    pub(super) fn render_workspaces(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_workspace_id
            .as_ref()
            .and_then(|workspace_id| {
                self.snapshot
                    .workspaces
                    .iter()
                    .find(|workspace| &workspace.id == workspace_id)
            });

        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(
                div()
                    .flex()
                    .justify_between()
                    .items_start()
                    .child(
                        div()
                            .child(
                                div()
                                    .text_2xl()
                                    .text_color(theme::text_primary())
                                    .child("Workspaces"),
                            )
                            .child(
                                div()
                                    .mt(px(6.0))
                                    .text_sm()
                                    .text_color(theme::text_muted())
                                    .child(format!("{} linked workspaces", self.snapshot.workspaces.len())),
                            ),
                    )
                    .when_some(selected, |container, workspace| {
                        if workspace.is_primary {
                            container
                        } else {
                            container.child(primary_button("Set primary", cx, |this, cx| {
                                this.set_primary_selected_workspace(cx)
                            }))
                        }
                    }),
            )
            .child(div().h(px(1.0)).bg(theme::panel_border()))
            .when(self.snapshot.workspaces.is_empty(), |container| {
                container.child(
                    div()
                        .min_h(px(260.0))
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
                                        .child("No workspaces linked"),
                                )
                                .child(
                                    div()
                                        .mt(px(10.0))
                                        .text_base()
                                        .text_color(theme::text_muted())
                                        .child("The active company will show its local workspaces here."),
                                ),
                        ),
                )
            })
            .when(!self.snapshot.workspaces.is_empty(), |container| {
                container.child(
                    div().children(self.snapshot.workspaces.iter().map(|workspace| {
                        let active =
                            self.state.selected_workspace_id.as_deref() == Some(workspace.id.as_str());
                        let workspace_id = workspace.id.clone();
                        div()
                            .id(SharedString::from(format!("workspace-{}", workspace.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_6()
                            .py_5()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::window_bg()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_workspace_id = Some(workspace_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .flex_1()
                                    .child(
                                        div()
                                            .text_base()
                                            .text_color(theme::text_primary())
                                            .child(workspace.name.clone()),
                                    )
                                    .child(
                                        div()
                                            .mt(px(8.0))
                                            .text_sm()
                                            .text_color(theme::text_muted())
                                            .child(workspace.local_path.clone()),
                                    )
                                    .child(
                                        div()
                                            .mt(px(8.0))
                                            .text_xs()
                                            .text_color(theme::text_subtle())
                                            .child(format!(
                                                "{} · {}",
                                                workspace.state,
                                                workspace_kind(workspace.is_primary)
                                            )),
                                    ),
                            )
                            .child(workspace_state_badge(
                                workspace.state.as_str(),
                                workspace.is_primary,
                            ))
                    })),
                )
            })
    }
}

fn workspace_kind(is_primary: bool) -> &'static str {
    if is_primary { "primary" } else { "linked" }
}

fn workspace_state_badge(state: &str, is_primary: bool) -> impl IntoElement {
    div()
        .flex()
        .items_center()
        .gap_2()
        .child(div().w(px(8.0)).h(px(8.0)).rounded_full().bg(match state {
            "ready" => theme::accent_teal(),
            "blocked" | "missing" | "error" => theme::danger(),
            _ => theme::accent_blue(),
        }))
        .child(
            div()
                .text_xs()
                .text_color(theme::text_secondary())
                .child(if is_primary {
                    format!("{} · PRIMARY", state.to_uppercase())
                } else {
                    state.to_uppercase()
                }),
        )
}
