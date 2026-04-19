use super::*;

impl AppRoot {
    pub(super) fn render_workspaces(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .flex()
            .flex_col()
            .gap_3()
            .children(self.snapshot.workspaces.iter().map(|workspace| {
                let active =
                    self.state.selected_workspace_id.as_deref() == Some(workspace.id.as_str());
                let workspace_id = workspace.id.clone();
                div()
                    .id(SharedString::from(format!("workspace-{}", workspace.id)))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(theme::panel_border())
                    .bg(if active {
                        theme::panel_inset()
                    } else {
                        theme::panel()
                    })
                    .cursor_pointer()
                    .hover(|style| style.bg(theme::panel_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.selected_workspace_id = Some(workspace_id.clone());
                        cx.notify();
                    }))
                    .child(div().text_lg().child(workspace.name.clone()))
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(workspace.local_path.clone()),
                    )
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} · {}",
                                workspace.state,
                                if workspace.is_primary {
                                    "primary"
                                } else {
                                    "linked"
                                }
                            )),
                    )
            }))
    }
}
