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
                    .border_color(rgb(0xd9cdbf))
                    .bg(if active { rgb(0xf7f0e7) } else { rgb(0xfffbf5) })
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(0xf4ede4)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.selected_workspace_id = Some(workspace_id.clone());
                        cx.notify();
                    }))
                    .child(div().text_lg().child(workspace.name.clone()))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(workspace.local_path.clone()),
                    )
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child(format!(
                        "{} · {}",
                        workspace.state,
                        if workspace.is_primary {
                            "primary"
                        } else {
                            "linked"
                        }
                    )))
            }))
    }
}
