use super::*;

impl AppRoot {
    pub(super) fn render_settings(&self) -> impl IntoElement + '_ {
        let current = self.snapshot.current_company();
        let execution_mode = current
            .map(|item| item.execution_mode.clone())
            .unwrap_or_else(|| "ai_ceo".to_string());

        div()
            .flex()
            .gap_6()
            .child(
                div()
                    .w(px(220.0))
                    .p_4()
                    .gap_2()
                    .rounded_lg()
                    .border_1()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(settings_nav_row("General", true))
                    .child(settings_nav_row("Execution mode", false))
                    .child(settings_nav_row("Providers", false))
                    .child(settings_nav_row("Shortcuts", false))
                    .child(settings_nav_row("Data", false))
                    .child(settings_nav_row("Secrets", false)),
            )
            .child(
                div()
                    .flex_1()
                    .gap_6()
                    .child(settings_section(
                        "General",
                        vec![
                            settings_row("Profile path", self.snapshot.profile_path.clone()),
                            settings_row("Theme", self.snapshot.theme.clone()),
                            settings_row("Locale", self.snapshot.locale.clone()),
                        ],
                    ))
                    .child(settings_section(
                        "Execution mode",
                        vec![settings_row("Company mode", execution_mode)],
                    ))
                    .child(settings_section(
                        "Providers",
                        vec![settings_row(
                            "Configured connectors",
                            self.snapshot.connectors.len().to_string(),
                        )],
                    ))
                    .child(settings_section(
                        "Data",
                        vec![
                            settings_row("Stored profile", "Local SQLite".to_string()),
                            settings_row("Current company", current_company_name(current)),
                        ],
                    )),
            )
    }
}

fn settings_nav_row(label: &'static str, active: bool) -> impl IntoElement {
    div()
        .px_4()
        .py_3()
        .rounded_lg()
        .bg(if active {
            theme::selection_fill()
        } else {
            theme::panel()
        })
        .text_color(if active {
            theme::sidebar_text_active()
        } else {
            theme::text_secondary()
        })
        .child(label)
}

fn settings_section(label: &'static str, rows: Vec<gpui::Div>) -> impl IntoElement {
    div()
        .p_5()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .child(
            div()
                .text_lg()
                .text_color(theme::text_primary())
                .child(label),
        )
        .child(div().mt(px(16.0)).children(rows))
}

fn settings_row(label: &'static str, value: String) -> gpui::Div {
    div()
        .flex()
        .justify_between()
        .items_center()
        .py_3()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(div().text_sm().text_color(theme::text_muted()).child(label))
        .child(
            div()
                .text_sm()
                .text_color(theme::text_primary())
                .child(value),
        )
}

fn current_company_name(company: Option<&domain::Company>) -> String {
    company
        .map(|item| item.name.clone())
        .unwrap_or_else(|| "No company".to_string())
}
