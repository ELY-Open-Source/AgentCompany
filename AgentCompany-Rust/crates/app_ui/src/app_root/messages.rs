use super::{
    messages_parts::{
        compact_message_card, composer_chip, composer_subject, message_section_label,
        secondary_message, selected_message_card, selected_recipient,
    },
    *,
};

impl AppRoot {
    pub(super) fn render_messages<'a>(
        &'a self,
        cx: &'a mut Context<Self>,
    ) -> impl IntoElement + 'a {
        let selected = self.state.selected_message_id.as_ref().and_then(|id| {
            self.snapshot
                .agent_messages
                .iter()
                .find(|item| &item.id == id)
        });
        let channel_groups = message_channel_groups(&self.snapshot);
        let selected_channel = selected.map(message_channel_key).or_else(|| {
            channel_groups
                .first()
                .and_then(|group| group.rows.first().map(|row| row.key.clone()))
        });
        let message_query = self.message_search_input.read(cx).value().to_lowercase();
        let visible_messages = selected_channel
            .as_ref()
            .map(|channel_key| messages_for_channel(&self.snapshot, channel_key))
            .unwrap_or_default()
            .into_iter()
            .filter(|message| {
                message_matches_query(message, message_query.as_str())
                    && (!self.state.message_unread_only || message.read_at.is_none())
            })
            .collect::<Vec<_>>();

        div()
            .flex()
            .gap_3()
            .child(render_message_sidebar(
                &channel_groups,
                selected_channel.as_deref(),
                &self.state.selected_message_id,
                cx,
            ))
            .child(
                div()
                    .flex_1()
                    .border_1()
                    .rounded_md()
                    .border_color(theme::panel_border())
                    .bg(theme::panel())
                    .child(render_message_header(
                        self,
                        selected_channel.as_deref(),
                        visible_messages.len(),
                        cx,
                    ))
                    .child(
                        div()
                            .id("messages-stream")
                            .flex_1()
                            .p_4()
                            .overflow_scroll()
                            .when(visible_messages.is_empty(), |container| {
                                container.child(selected_message_card(None))
                            })
                            .when(!visible_messages.is_empty(), |container| {
                                container.children(visible_messages.iter().map(|message| {
                                    let is_selected = self.state.selected_message_id.as_deref()
                                        == Some(message.id.as_str());
                                    let message_id = message.id.clone();
                                    div()
                                        .id(SharedString::from(format!(
                                            "message-stream-{}",
                                            message.id
                                        )))
                                        .cursor_pointer()
                                        .hover(|style| style.bg(theme::panel_hover()))
                                        .on_click(cx.listener(move |this, _, _, cx| {
                                            this.state.selected_message_id =
                                                Some(message_id.clone());
                                            cx.notify();
                                        }))
                                        .child(if is_selected {
                                            selected_message_card(Some(message)).into_any_element()
                                        } else {
                                            compact_message_card(message).into_any_element()
                                        })
                                }))
                            }),
                    )
                    .child(render_message_composer(self, selected, cx)),
            )
            .child(render_message_inspector(selected))
    }
}

#[derive(Clone)]
struct ChannelRow {
    key: String,
    label: String,
    count: usize,
    urgent: bool,
    rows: Vec<String>,
}

#[derive(Clone)]
struct ChannelGroup {
    label: &'static str,
    rows: Vec<ChannelRow>,
}

fn message_channel_groups(snapshot: &domain::ProfileSnapshot) -> Vec<ChannelGroup> {
    let company = build_channel_group(snapshot, "COMPANY", |message| message.channel == "company");
    let department = build_channel_group(snapshot, "DEPARTMENT", |message| {
        message.channel == "department"
    });
    let direct = build_channel_group(snapshot, "DIRECT MESSAGES", |message| {
        message.channel == "direct"
    });
    let task_threads = build_channel_group(snapshot, "TASK DISCUSSIONS", |message| {
        matches!(message.channel.as_str(), "project" | "incident" | "run")
    });
    [company, department, direct, task_threads]
        .into_iter()
        .filter(|group| !group.rows.is_empty())
        .collect()
}

fn build_channel_group(
    snapshot: &domain::ProfileSnapshot,
    label: &'static str,
    predicate: impl Fn(&domain::AgentMessage) -> bool,
) -> ChannelGroup {
    let mut channels = std::collections::BTreeMap::<String, Vec<&domain::AgentMessage>>::new();
    for message in snapshot
        .agent_messages
        .iter()
        .filter(|message| predicate(message))
    {
        channels
            .entry(message_channel_key(message))
            .or_default()
            .push(message);
    }
    let rows = channels
        .into_iter()
        .map(|(key, messages)| {
            let label = channel_label(snapshot, messages.as_slice());
            let count = messages
                .iter()
                .filter(|message| message.read_at.is_none())
                .count();
            let urgent = messages
                .iter()
                .any(|message| message.priority == "urgent" && message.read_at.is_none());
            let rows = messages
                .iter()
                .map(|message| message.id.clone())
                .collect::<Vec<_>>();
            ChannelRow {
                key,
                label,
                count,
                urgent,
                rows,
            }
        })
        .collect::<Vec<_>>();
    ChannelGroup { label, rows }
}

fn channel_label(snapshot: &domain::ProfileSnapshot, messages: &[&domain::AgentMessage]) -> String {
    let Some(first) = messages.first() else {
        return "#empty".to_string();
    };
    match first.channel.as_str() {
        "company" => "#company-wide".to_string(),
        "department" => format!(
            "#{}",
            first
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "department".to_string())
        ),
        "direct" => first
            .to_agent_id
            .as_ref()
            .and_then(|agent_id| snapshot.agents.iter().find(|agent| &agent.id == agent_id))
            .map(|agent| agent.name.clone())
            .unwrap_or_else(|| "Direct".to_string()),
        "project" => format!(
            "#{}",
            first
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "project".to_string())
        ),
        "incident" => format!(
            "#{}",
            first
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "incident".to_string())
        ),
        "run" => format!(
            "Run {}",
            first
                .channel_target_id
                .clone()
                .unwrap_or_default()
                .get(..8)
                .unwrap_or("run")
        ),
        other => other.to_string(),
    }
}

fn render_message_sidebar<'a>(
    groups: &'a [ChannelGroup],
    active_channel: Option<&'a str>,
    selected_message_id: &'a Option<String>,
    cx: &'a mut Context<AppRoot>,
) -> impl IntoElement + 'a {
    div()
        .w(px(292.0))
        .p_3()
        .gap_3()
        .border_1()
        .rounded_md()
        .border_color(theme::panel_border())
        .bg(theme::sidebar_bg())
        .children(groups.iter().map(|group| {
            div()
                .gap_2()
                .child(message_section_label(group.label))
                .children(group.rows.iter().map(|channel| {
                    let active = active_channel == Some(channel.key.as_str());
                    let next_message_id = channel
                        .rows
                        .first()
                        .cloned()
                        .or_else(|| selected_message_id.clone())
                        .unwrap_or_default();
                    div()
                        .id(SharedString::from(format!(
                            "message-channel-{}",
                            channel.key
                        )))
                        .cursor_pointer()
                        .hover(|style| style.bg(theme::panel_hover()))
                        .bg(if active {
                            theme::selection_fill()
                        } else {
                            theme::panel()
                        })
                        .rounded_md()
                        .px_3()
                        .py_2()
                        .on_click(cx.listener(move |this, _, _, cx| {
                            if !next_message_id.is_empty() {
                                this.state.selected_message_id = Some(next_message_id.clone());
                            }
                            cx.notify();
                        }))
                        .child(
                            div()
                                .flex()
                                .items_center()
                                .gap_3()
                                .child(
                                    div()
                                        .w(px(28.0))
                                        .h(px(28.0))
                                        .rounded_md()
                                        .bg(theme::panel_muted()),
                                )
                                .child(
                                    div().flex_1().child(
                                        div()
                                            .text_sm()
                                            .text_color(if active {
                                                theme::sidebar_text_active()
                                            } else {
                                                theme::text_secondary()
                                            })
                                            .truncate()
                                            .child(channel.label.clone()),
                                    ),
                                )
                                .when(channel.urgent, |container| {
                                    container.child(
                                        div()
                                            .w(px(8.0))
                                            .h(px(8.0))
                                            .rounded_full()
                                            .bg(theme::danger()),
                                    )
                                })
                                .when(channel.count > 0, |container| {
                                    container.child(
                                        div()
                                            .px_2()
                                            .py_1()
                                            .rounded_full()
                                            .bg(theme::primary_action())
                                            .text_xs()
                                            .text_color(theme::primary_action_text())
                                            .child(channel.count.to_string()),
                                    )
                                }),
                        )
                }))
        }))
        .child(
            div()
                .flex()
                .justify_between()
                .text_xs()
                .text_color(theme::text_muted())
                .child(format!(
                    "{} channels",
                    groups.iter().map(|group| group.rows.len()).sum::<usize>()
                ))
                .child("live threads"),
        )
}

fn render_message_header(
    root: &AppRoot,
    active_channel: Option<&str>,
    visible_count: usize,
    cx: &mut Context<AppRoot>,
) -> impl IntoElement {
    div()
        .flex()
        .justify_between()
        .items_center()
        .px_5()
        .py_4()
        .border_b_1()
        .border_color(theme::panel_border())
        .child(
            div()
                .child(
                    div()
                        .text_lg()
                        .text_color(theme::text_primary())
                        .child(active_channel.unwrap_or("Select a channel").to_string()),
                )
                .child(
                    div()
                        .mt(px(4.0))
                        .text_sm()
                        .text_color(theme::text_muted())
                        .child(format!("{} visible messages", visible_count)),
                ),
        )
        .child(
            div()
                .flex()
                .gap_3()
                .items_center()
                .child(root.message_search_input.clone())
                .child(message_filter_toggle(root.state.message_unread_only, cx)),
        )
}

fn render_message_composer<'a>(
    root: &'a AppRoot,
    selected: Option<&'a domain::AgentMessage>,
    cx: &'a mut Context<AppRoot>,
) -> impl IntoElement + 'a {
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
                .child(root.message_input.clone()),
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
                        .child("Reply, mention, or route an operational update."),
                )
                .child(
                    div()
                        .flex()
                        .gap_2()
                        .child(primary_button("Send update", cx, |this, cx| {
                            this.send_message(cx)
                        }))
                        .child(secondary_button("Mark read", cx, |this, cx| {
                            this.mark_selected_message_read(cx)
                        })),
                ),
        )
}

fn render_message_inspector(selected: Option<&domain::AgentMessage>) -> impl IntoElement {
    div()
        .w(px(320.0))
        .border_1()
        .rounded_lg()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .p_5()
        .child(
            div()
                .text_lg()
                .text_color(theme::text_primary())
                .child("Conversation details"),
        )
        .child(selected_message_card(selected))
        .when_some(secondary_message(selected), |container, message| {
            container.child(compact_message_card(message))
        })
}

fn message_filter_toggle(unread_only: bool, cx: &mut Context<AppRoot>) -> impl IntoElement {
    div()
        .id("message-filter-toggle")
        .px_3()
        .py_2()
        .rounded_full()
        .cursor_pointer()
        .bg(if unread_only {
            theme::primary_action()
        } else {
            theme::panel_muted()
        })
        .text_xs()
        .text_color(if unread_only {
            theme::primary_action_text()
        } else {
            theme::text_secondary()
        })
        .hover(|style| {
            style.bg(if unread_only {
                theme::primary_action_hover()
            } else {
                theme::panel_hover()
            })
        })
        .on_click(cx.listener(move |this, _, _, cx| {
            this.state.message_unread_only = !this.state.message_unread_only;
            cx.notify();
        }))
        .child(if unread_only {
            "Unread only"
        } else {
            "All messages"
        })
}

fn message_matches_query(message: &domain::AgentMessage, query: &str) -> bool {
    if query.trim().is_empty() {
        return true;
    }
    let query = query.trim();
    message.subject.to_lowercase().contains(query)
        || message.body.to_lowercase().contains(query)
        || message.channel.to_lowercase().contains(query)
}

fn message_channel_key(message: &domain::AgentMessage) -> String {
    match message.channel.as_str() {
        "company" => "company-all".to_string(),
        "department" => format!(
            "department-{}",
            message
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "general".to_string())
        ),
        "direct" => {
            let to = message
                .to_agent_id
                .clone()
                .unwrap_or_else(|| "broadcast".to_string());
            format!("direct-{}-{}", message.from_agent_id, to)
        }
        "project" => format!(
            "project-{}",
            message
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "general".to_string())
        ),
        "incident" => format!(
            "incident-{}",
            message
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "room".to_string())
        ),
        "run" => format!(
            "run-{}",
            message
                .channel_target_id
                .clone()
                .unwrap_or_else(|| "run".to_string())
        ),
        other => format!("{}-misc", other),
    }
}

fn messages_for_channel<'a>(
    snapshot: &'a domain::ProfileSnapshot,
    channel_key: &str,
) -> Vec<&'a domain::AgentMessage> {
    snapshot
        .agent_messages
        .iter()
        .filter(|message| message_channel_key(message) == channel_key)
        .collect::<Vec<_>>()
}
