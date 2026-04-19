use super::*;

impl AppRoot {
    pub(super) fn render_onboarding(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .size_full()
            .p_8()
            .flex()
            .gap_8()
            .bg(theme::canvas())
            .child(
                div()
                    .flex_1()
                    .gap_4()
                    .child(div().text_3xl().text_color(theme::text_primary()).child("Start a native AgentCompany profile"))
                    .child(div().text_sm().text_color(theme::text_muted()).child("Create the first company, point it at a workspace, and keep the SQLite profile local."))
                    .child(self.company_name_input.clone())
                    .child(self.mission_input.clone())
                    .child(self.workspace_input.clone())
                    .child(primary_button("Create company", cx, |this, cx| this.create_company(cx))),
            )
            .child(
                div()
                    .w(px(380.0))
                    .p_5()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(div().text_lg().child("What lands in SQLite"))
                    .child(div().text_sm().text_color(theme::text_muted()).child("Company"))
                    .child(div().text_sm().text_color(theme::text_muted()).child("Primary workspace"))
                    .child(div().text_sm().text_color(theme::text_muted()).child("Connector catalog"))
                    .child(div().text_sm().text_color(theme::text_muted()).child("Shared profile settings")),
            )
    }
}
