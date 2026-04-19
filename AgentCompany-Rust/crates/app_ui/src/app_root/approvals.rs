use super::*;

impl AppRoot {
    pub(super) fn render_approvals(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_approval_id
            .as_ref()
            .and_then(|id| self.snapshot.approvals.iter().find(|item| &item.id == id));
        let approval_type = selected
            .map(|item| item.approval_type.clone())
            .unwrap_or_else(|| "Select an approval".to_string());
        let approval_summary = selected
            .map(|item| item.impact_summary.clone())
            .unwrap_or_else(|| "No approval selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("approvals-list")
                    .w(px(340.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .overflow_scroll()
                    .child(div().text_lg().child("Approval queue"))
                    .children(self.snapshot.approvals.iter().map(|item| {
                        let active =
                            self.state.selected_approval_id.as_deref() == Some(item.id.as_str());
                        let approval_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("approval-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::panel()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_approval_id = Some(approval_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.state, item.payload_summary))
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(div().text_lg().child("Decision"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(theme::text_muted())
                            .child(approval_type),
                    )
                    .child(
                        div()
                            .min_h(px(160.0))
                            .p_3()
                            .border_1()
                            .border_color(theme::panel_inset_border())
                            .rounded_md()
                            .bg(theme::panel_inset())
                            .child(approval_summary),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(primary_button("Approve", cx, |this, cx| {
                                this.decide_selected_approval(
                                    ApprovalState::Approved,
                                    "Approved from native shell.",
                                    cx,
                                )
                            }))
                            .child(secondary_button("Reject", cx, |this, cx| {
                                this.decide_selected_approval(
                                    ApprovalState::Rejected,
                                    "Rejected from native shell.",
                                    cx,
                                )
                            })),
                    ),
            )
    }
}
