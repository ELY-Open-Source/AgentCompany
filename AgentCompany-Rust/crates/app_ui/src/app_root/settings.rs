use super::*;

impl AppRoot {
    pub(super) fn render_settings(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .flex()
            .flex_col()
            .gap_6()
            .child(settings_tabs(self.state.settings_tab, cx))
            .child(self.render_active_settings_panel(cx))
    }

    fn render_active_settings_panel(&self, cx: &mut Context<Self>) -> gpui::AnyElement {
        match self.state.settings_tab {
            SettingsTab::General => self.render_general_settings_panel(cx).into_any_element(),
            SettingsTab::Mode => self.render_mode_settings_panel(cx).into_any_element(),
            SettingsTab::Providers => self.render_providers_settings_panel().into_any_element(),
            SettingsTab::Shortcuts => self.render_shortcuts_settings_panel().into_any_element(),
            SettingsTab::Data => self.render_data_settings_panel().into_any_element(),
            SettingsTab::Secrets => self.render_secrets_settings_panel().into_any_element(),
        }
    }

    fn render_general_settings_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        settings_panel(
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
                settings_readonly_row("Profile path", self.snapshot.profile_path.clone()),
            ],
        )
    }

    fn render_mode_settings_panel(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let execution_mode = self
            .snapshot
            .current_company()
            .map(|item| item.execution_mode.clone())
            .unwrap_or_else(|| "ai_ceo".to_string());
        settings_panel(
            "Execution mode",
            vec![settings_action_row(
                "Company mode",
                execution_mode.clone(),
                vec![
                    settings_action_button("AI CEO", execution_mode == "ai_ceo", cx, |this, cx| {
                        this.update_execution_mode("ai_ceo", cx)
                    })
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
        )
    }

    fn render_providers_settings_panel(&self) -> impl IntoElement + '_ {
        settings_panel(
            "Providers",
            vec![
                settings_readonly_row(
                    "Configured connectors",
                    self.snapshot.connectors.len().to_string(),
                ),
                settings_readonly_row(
                    "Ready connectors",
                    self.snapshot
                        .connectors
                        .iter()
                        .filter(|item| item.status == "ready" || item.auth_state == "ready")
                        .count()
                        .to_string(),
                ),
            ],
        )
    }

    fn render_shortcuts_settings_panel(&self) -> impl IntoElement + '_ {
        settings_panel(
            "Shortcuts",
            vec![
                settings_readonly_row("Open inbox", "g then i".to_string()),
                settings_readonly_row("Open runs", "g then r".to_string()),
                settings_readonly_row("Open settings", "g then s".to_string()),
            ],
        )
    }

    fn render_data_settings_panel(&self) -> impl IntoElement + '_ {
        settings_panel(
            "Data",
            vec![
                settings_readonly_row("Stored profile", "Local SQLite".to_string()),
                settings_readonly_row(
                    "Current company",
                    current_company_name(self.snapshot.current_company()),
                ),
                settings_readonly_row("Documents", self.snapshot.documents.len().to_string()),
                settings_readonly_row("Artifacts", self.snapshot.artifacts.len().to_string()),
            ],
        )
    }

    fn render_secrets_settings_panel(&self) -> impl IntoElement + '_ {
        settings_panel(
            "Secrets",
            vec![settings_readonly_row(
                "Connector auth surfaces",
                self.snapshot.connectors.len().to_string(),
            )],
        )
    }
}

fn settings_tabs(cx_tab: SettingsTab, cx: &mut Context<AppRoot>) -> impl IntoElement {
    div()
        .flex()
        .gap_1()
        .border_b_1()
        .border_color(theme::panel_border())
        .children([
            settings_tab_button("General", SettingsTab::General, cx_tab, cx).into_any_element(),
            settings_tab_button("Mode", SettingsTab::Mode, cx_tab, cx).into_any_element(),
            settings_tab_button("Providers", SettingsTab::Providers, cx_tab, cx).into_any_element(),
            settings_tab_button("Shortcuts", SettingsTab::Shortcuts, cx_tab, cx).into_any_element(),
            settings_tab_button("Data", SettingsTab::Data, cx_tab, cx).into_any_element(),
            settings_tab_button("Secrets", SettingsTab::Secrets, cx_tab, cx).into_any_element(),
        ])
}

fn settings_tab_button(
    label: &'static str,
    tab: SettingsTab,
    active_tab: SettingsTab,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    let active = tab == active_tab;
    div()
        .id(SharedString::from(format!("settings-tab-{label}")))
        .relative()
        .px_4()
        .py_2()
        .cursor_pointer()
        .text_sm()
        .text_color(if active {
            theme::text_primary()
        } else {
            theme::text_muted()
        })
        .hover(|style| style.text_color(theme::text_primary()))
        .on_click(cx.listener(move |this, _, _, cx| {
            this.state.settings_tab = tab;
            cx.notify();
        }))
        .child(label)
        .when(active, |element| {
            element.child(
                div()
                    .absolute()
                    .left(px(8.0))
                    .right(px(8.0))
                    .bottom(px(-1.0))
                    .h(px(2.0))
                    .bg(theme::primary_action()),
            )
        })
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
