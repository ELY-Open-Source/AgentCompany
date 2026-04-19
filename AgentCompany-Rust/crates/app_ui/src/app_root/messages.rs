use super::{
    messages_parts::{
        compact_message_card, composer_chip, composer_subject, filter_shell, message_section_label,
        search_shell, secondary_message, selected_message_card, selected_recipient,
    },
    *,
};

impl AppRoot {
    pub(super) fn render_messages(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self.state.selected_message_id.as_ref().and_then(|id| {
            self.snapshot
                .agent_messages
                .iter()
                .find(|item| &item.id == id)
        });
        let company_wide = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|item| item.channel == "company")
            .collect::<Vec<_>>();
        let department = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|item| item.channel == "department")
            .collect::<Vec<_>>();
        let direct = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|item| item.channel == "direct")
            .collect::<Vec<_>>();
        let task_threads = self
            .snapshot
            .agent_messages
            .iter()
            .filter(|item| {
                item.channel != "company"
                    && item.channel != "department"
                    && item.channel != "direct"
            })
            .collect::<Vec<_>>();

        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .w(px(356.0))
                    .p_5()
                    .gap_4()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(message_section_label("COMPANY-WIDE"))
                    .children(company_wide.iter().map(|message| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(message.id.as_str());
                        let message_id = message.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", message.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_4()
                            .py_3()
                            .rounded_lg()
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::panel()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if active {
                                        theme::sidebar_text_active()
                                    } else {
                                        theme::text_secondary()
                                    })
                                    .truncate()
                                    .child(message.subject.clone()),
                            )
                            .when(message.priority == "urgent", |container| {
                                container.child(
                                    div()
                                        .w(px(10.0))
                                        .h(px(10.0))
                                        .rounded_full()
                                        .bg(theme::danger()),
                                )
                            })
                    }))
                    .child(message_section_label("DEPARTMENT"))
                    .children(department.iter().map(|message| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(message.id.as_str());
                        let message_id = message.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", message.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_4()
                            .py_3()
                            .rounded_lg()
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::panel()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if active {
                                        theme::sidebar_text_active()
                                    } else {
                                        theme::text_secondary()
                                    })
                                    .truncate()
                                    .child(message.subject.clone()),
                            )
                    }))
                    .child(message_section_label("DIRECT MESSAGES"))
                    .children(direct.iter().map(|message| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(message.id.as_str());
                        let message_id = message.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", message.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_4()
                            .py_3()
                            .rounded_lg()
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::panel()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if active {
                                        theme::sidebar_text_active()
                                    } else {
                                        theme::text_secondary()
                                    })
                                    .truncate()
                                    .child(message.subject.clone()),
                            )
                            .when(message.read_at.is_none(), |container| {
                                container.child(
                                    div()
                                        .w(px(10.0))
                                        .h(px(10.0))
                                        .rounded_full()
                                        .bg(theme::danger()),
                                )
                            })
                    }))
                    .child(message_section_label("TASK DISCUSSIONS"))
                    .children(task_threads.iter().map(|message| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(message.id.as_str());
                        let message_id = message.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", message.id)))
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_4()
                            .py_3()
                            .rounded_lg()
                            .cursor_pointer()
                            .bg(if active {
                                theme::selection_fill()
                            } else {
                                theme::panel()
                            })
                            .hover(|style| style.bg(theme::panel_hover()))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(
                                div()
                                    .text_sm()
                                    .text_color(if active {
                                        theme::sidebar_text_active()
                                    } else {
                                        theme::text_secondary()
                                    })
                                    .truncate()
                                    .child(message.subject.clone()),
                            )
                    }))
                    .child(div().flex_1())
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .text_xs()
                            .text_color(theme::text_muted())
                            .child(format!("{} channels", self.snapshot.agent_messages.len()))
                            .child(format!("{} agents", self.snapshot.agents.len())),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .border_1()
                    .rounded_lg()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(
                        div()
                            .flex()
                            .justify_between()
                            .items_center()
                            .px_5()
                            .py_4()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .child(
                                div().text_lg().text_color(theme::text_primary()).child(
                                    selected
                                        .map(|message| message.subject.clone())
                                        .unwrap_or_else(|| "Select a conversation".to_string()),
                                ),
                            )
                            .child(
                                div()
                                    .flex()
                                    .gap_3()
                                    .child(search_shell("Search messages"))
                                    .child(filter_shell()),
                            ),
                    )
                    .child(
                        div()
                            .id("messages-stream")
                            .flex_1()
                            .p_4()
                            .overflow_scroll()
                            .child(selected_message_card(selected))
                            .when_some(secondary_message(selected), |container, message| {
                                container.child(compact_message_card(message))
                            }),
                    )
                    .child(
                        div()
                            .px_4()
                            .py_3()
                            .border_t_1()
                            .border_color(theme::panel_border())
                            .bg(theme::panel())
                            .child(
                                div()
                                    .flex()
                                    .gap_3()
                                    .child(composer_chip(selected_recipient(selected).as_str()))
                                    .child(composer_subject(selected)),
                            )
                            .child(
                                div()
                                    .mt(px(12.0))
                                    .p_3()
                                    .rounded_lg()
                                    .bg(theme::panel_inset())
                                    .border_1()
                                    .border_color(theme::panel_inset_border())
                                    .child(self.message_input.clone()),
                            )
                            .child(
                                div()
                                    .mt(px(10.0))
                                    .flex()
                                    .justify_between()
                                    .items_center()
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(theme::text_muted())
                                            .child("Press Cmd+Enter to send"),
                                    )
                                    .child(
                                        div()
                                            .flex()
                                            .gap_2()
                                            .child(primary_button("Send update", cx, |this, cx| {
                                                this.send_message(cx)
                                            }))
                                            .child(secondary_button(
                                                "Mark read",
                                                cx,
                                                |this, cx| this.mark_selected_message_read(cx),
                                            )),
                                    ),
                            ),
                    ),
            )
    }
}
