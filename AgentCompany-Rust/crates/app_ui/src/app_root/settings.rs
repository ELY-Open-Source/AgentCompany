use super::*;

impl AppRoot {
    pub(super) fn render_settings(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
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
                    .child(settings_panel(
                        "General",
                        vec![
                            settings_action_row(
                                "Theme",
                                self.snapshot.theme.clone(),
                                vec![
                                    settings_action_button(
                                        "System",
                                        self.snapshot.theme == "system",
                                        cx,
                                        |this, cx| this.update_theme("system", cx),
                                    )
                                    .into_any_element(),
                                    settings_action_button(
                                        "Light",
                                        self.snapshot.theme == "light",
                                        cx,
                                        |this, cx| this.update_theme("light", cx),
                                    )
                                    .into_any_element(),
                                    settings_action_button(
                                        "Dark",
                                        self.snapshot.theme == "dark",
                                        cx,
                                        |this, cx| this.update_theme("dark", cx),
                                    )
                                    .into_any_element(),
                                ],
                            ),
                            settings_action_row(
                                "Locale",
                                self.snapshot.locale.clone(),
                                vec![
                                    settings_action_button(
                                        "EN",
                                        self.snapshot.locale == "en",
                                        cx,
                                        |this, cx| this.update_locale("en", cx),
                                    )
                                    .into_any_element(),
                                    settings_action_button(
                                        "ZH",
                                        self.snapshot.locale == "zh",
                                        cx,
                                        |this, cx| this.update_locale("zh", cx),
                                    )
                                    .into_any_element(),
                                ],
                            ),
                            settings_readonly_row(
                                "Profile path",
                                self.snapshot.profile_path.clone(),
                            ),
                        ],
                    ))
                    .child(settings_panel(
                        "Execution mode",
                        vec![settings_action_row(
                            "Company mode",
                            execution_mode.clone(),
                            vec![
                                settings_action_button(
                                    "AI CEO",
                                    execution_mode == "ai_ceo",
                                    cx,
                                    |this, cx| this.update_execution_mode("ai_ceo", cx),
                                )
                                .into_any_element(),
                                settings_action_button(
                                    "AI Co-Founder",
                                    execution_mode == "ai_cofounder",
                                    cx,
                                    |this, cx| this.update_execution_mode("ai_cofounder", cx),
                                )
                                .into_any_element(),
                            ],
                        )],
                    ))
                    .child(settings_panel(
                        "Providers",
                        vec![settings_readonly_row(
                            "Configured connectors",
                            self.snapshot.connectors.len().to_string(),
                        )],
                    ))
                    .child(settings_panel(
                        "Data",
                        vec![
                            settings_readonly_row("Stored profile", "Local SQLite".to_string()),
                            settings_readonly_row("Current company", current_company_name(current)),
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

fn settings_panel(label: &'static str, rows: Vec<gpui::AnyElement>) -> impl IntoElement {
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

fn settings_readonly_row(label: &'static str, value: String) -> gpui::AnyElement {
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
        .into_any_element()
}

fn settings_action_row(
    label: &'static str,
    value: String,
    actions: Vec<gpui::AnyElement>,
) -> gpui::AnyElement {
    div()
        .py_3()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(
            div()
                .flex()
                .justify_between()
                .items_center()
                .child(div().text_sm().text_color(theme::text_muted()).child(label))
                .child(
                    div()
                        .text_sm()
                        .text_color(theme::text_primary())
                        .child(value),
                ),
        )
        .child(div().mt(px(10.0)).flex().gap_2().children(actions))
        .into_any_element()
}

fn settings_action_button<V>(
    label: &'static str,
    active: bool,
    cx: &mut Context<V>,
    on_click: impl Fn(&mut V, &mut Context<V>) + 'static,
) -> impl IntoElement
where
    V: 'static,
{
    div()
        .id(SharedString::from(format!("settings-action-{label}")))
        .px_3()
        .py_2()
        .rounded_lg()
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
        .hover(|style| style.bg(theme::panel_hover()))
        .on_click(
            cx.listener(move |this, _: &gpui::ClickEvent, _: &mut Window, cx| on_click(this, cx)),
        )
        .child(label)
}

fn current_company_name(company: Option<&domain::Company>) -> String {
    company
        .map(|item| item.name.clone())
        .unwrap_or_else(|| "No company".to_string())
}
