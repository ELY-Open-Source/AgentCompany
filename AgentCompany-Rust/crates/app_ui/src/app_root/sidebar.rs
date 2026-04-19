use super::*;

impl AppRoot {
    pub(super) fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let sections = [
            (SectionId::Overview, None),
            (SectionId::Runs, Some(self.snapshot.active_runs())),
            (SectionId::Inbox, Some(self.snapshot.active_tasks())),
            (SectionId::Messages, Some(self.snapshot.unread_messages())),
            (SectionId::Approvals, Some(self.snapshot.pending_approvals())),
            (SectionId::Documents, None),
            (SectionId::Workspaces, None),
        ];

        div()
            .w(px(292.0))
            .h_full()
            .p_4()
            .gap_4()
            .flex()
            .flex_col()
            .bg(theme::sidebar_bg())
            .border_r_1()
            .border_color(theme::sidebar_divider())
            .child(
                div()
                    .flex()
                    .items_center()
                    .justify_between()
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(traffic_light(rgb_hex(0xff5f57)))
                            .child(traffic_light(rgb_hex(0xfebc2e)))
                            .child(traffic_light(rgb_hex(0x28c840))),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme::text_subtle())
                            .child("local-first"),
                    ),
            )
            .child(
                div()
                    .flex()
                    .gap_2()
                    .items_center()
                    .child(
                        div()
                            .flex_1()
                            .px_4()
                            .py_3()
                            .border_1()
                            .rounded_lg()
                            .border_color(theme::panel_border())
                            .bg(theme::panel())
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(theme::text_primary())
                                    .child(
                                        self.snapshot
                                            .current_company()
                                            .map(|company| company.name.clone())
                                            .unwrap_or_else(|| "AgentCompany".to_string()),
                                    ),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(theme::text_muted())
                                    .child("native GPUI shell"),
                            ),
                    )
                    .child(
                        div()
                            .w(px(44.0))
                            .h(px(44.0))
                            .rounded_lg()
                            .border_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel())
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_sm()
                            .text_color(theme::text_secondary())
                            .child("⌘"),
                    ),
            )
            .children(self.snapshot.companies.iter().map(|company| {
                let active = self.snapshot.current_company_id.as_deref() == Some(company.id.as_str());
                let company_id = company.id.clone();
                div()
                    .id(SharedString::from(format!("company-{}", company.id)))
                    .px_4()
                    .py_3()
                    .rounded_lg()
                    .cursor_pointer()
                    .border_1()
                    .border_color(if active {
                        theme::selection_border()
                    } else {
                        theme::panel_border()
                    })
                    .bg(if active {
                        theme::selection_fill()
                    } else {
                        theme::panel()
                    })
                    .hover(|style| style.bg(theme::sidebar_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.switch_company(company_id.clone(), cx)
                    }))
                    .child(
                        div()
                            .text_sm()
                            .text_color(if active {
                                theme::sidebar_text_active()
                            } else {
                                theme::sidebar_text()
                            })
                            .child(company.name.clone()),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme::text_muted())
                            .child(format!("{} mode", company.execution_mode.replace('_', " "))),
                    )
            }))
            .child(div().h(px(1.0)).bg(theme::sidebar_divider()))
            .children(sections.into_iter().map(|(section, badge)| {
                let active = self.state.section == section;
                let label = section.label();
                div()
                    .id(SharedString::from(format!(
                        "section-{}",
                        label.to_lowercase()
                    )))
                    .flex()
                    .items_center()
                    .justify_between()
                    .px_4()
                    .py_3()
                    .rounded_lg()
                    .cursor_pointer()
                    .border_1()
                    .border_color(if active {
                        theme::selection_border()
                    } else {
                        theme::sidebar_bg()
                    })
                    .bg(if active {
                        theme::selection_fill()
                    } else {
                        theme::sidebar_bg()
                    })
                    .text_color(if active {
                        theme::sidebar_text_active()
                    } else {
                        theme::sidebar_text()
                    })
                    .hover(|style| style.bg(theme::sidebar_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.section = section;
                        cx.notify();
                    }))
                    .child(div().text_sm().child(label))
                    .when_some(badge.filter(|count| *count > 0), |container, count| {
                        container.child(
                            div()
                                .min_w(px(24.0))
                                .px_2()
                                .py_1()
                                .rounded_full()
                                .bg(if section == SectionId::Messages {
                                    theme::accent_orange()
                                } else {
                                    theme::badge_dark()
                                })
                                .text_xs()
                                .text_color(theme::panel())
                                .child(count.to_string()),
                        )
                    })
            }))
            .child(div().flex_1())
            .child(div().h(px(1.0)).bg(theme::sidebar_divider()))
            .child(sidebar_footer_row("Settings", self.state.section == SectionId::Settings, cx, |this, cx| {
                this.state.section = SectionId::Settings;
                cx.notify();
            }))
            .child(
                div()
                    .px_4()
                    .py_3()
                    .rounded_lg()
                    .bg(theme::panel_muted())
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme::text_muted())
                            .child(format!(
                                "{} agents · {} channels",
                                self.snapshot.agents.len(),
                                self.snapshot.agent_messages.len()
                            )),
                    ),
            )
    }
}

fn sidebar_footer_row<V>(
    label: &'static str,
    active: bool,
    cx: &mut Context<V>,
    on_click: impl Fn(&mut V, &mut Context<V>) + 'static,
) -> impl IntoElement
where
    V: 'static,
{
    div()
        .px_4()
        .py_3()
        .rounded_lg()
        .cursor_pointer()
        .bg(if active {
            theme::selection_fill()
        } else {
            theme::sidebar_bg()
        })
        .text_color(if active {
            theme::sidebar_text_active()
        } else {
            theme::sidebar_text()
        })
        .hover(|style| style.bg(theme::sidebar_hover()))
        .on_click(cx.listener(move |this, _, _, cx| on_click(this, cx)))
        .child(label)
}

fn rgb_hex(hex: u32) -> gpui::Hsla {
    gpui::rgb(hex).into()
}

fn traffic_light(color: gpui::Hsla) -> impl IntoElement {
    div().w(px(12.0)).h(px(12.0)).rounded_full().bg(color)
}
