use super::*;

impl AppRoot {
    pub(super) fn render_onboarding(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .size_full()
            .p_8()
            .flex()
            .gap_8()
            .bg(rgb(0xf3efe8))
            .child(
                div()
                    .flex_1()
                    .gap_4()
                    .child(div().text_3xl().text_color(rgb(0x171411)).child("Start a native AgentCompany profile"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Create the first company, point it at a workspace, and keep the SQLite profile local."))
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
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("What lands in SQLite"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Company"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Primary workspace"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Connector catalog"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Shared profile settings")),
            )
    }
}
