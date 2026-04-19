use super::*;

pub(super) fn message_section_label(label: &'static str) -> impl IntoElement {
    div().text_xs().text_color(theme::text_muted()).child(label)
}

pub(super) fn selected_message_card(message: Option<&domain::AgentMessage>) -> impl IntoElement {
    let subject = message
        .map(|item| item.subject.clone())
        .unwrap_or_else(|| "Select a message thread".to_string());
    let body = message.map(|item| item.body.clone()).unwrap_or_else(|| {
        "Choose a company channel, direct thread, or task discussion from the left rail."
            .to_string()
    });
    div()
        .p_5()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .child(message_header(message, false))
        .child(
            div()
                .mt(px(16.0))
                .text_lg()
                .text_color(theme::text_primary())
                .child(subject),
        )
        .child(
            div()
                .mt(px(12.0))
                .text_base()
                .text_color(theme::text_secondary())
                .child(body),
        )
        .child(
            div()
                .mt(px(16.0))
                .text_sm()
                .text_color(theme::text_muted())
                .child("↩ Reply"),
        )
}

pub(super) fn compact_message_card(message: &domain::AgentMessage) -> impl IntoElement {
    div()
        .mt(px(16.0))
        .p_5()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .child(message_header(Some(message), true))
        .child(
            div()
                .mt(px(12.0))
                .text_base()
                .text_color(theme::text_primary())
                .child(message.subject.clone()),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_sm()
                .text_color(theme::text_muted())
                .line_clamp(2)
                .child(message.body.clone()),
        )
}

fn message_header(message: Option<&domain::AgentMessage>, urgent: bool) -> impl IntoElement {
    let sender = message
        .map(|item| trim_sender(item.from_agent_id.as_str()))
        .unwrap_or("AC");
    let timestamp = message
        .and_then(|item| item.created_at.get(11..16))
        .unwrap_or("--:--")
        .to_string();
    div()
        .flex()
        .items_center()
        .gap_3()
        .child(
            div()
                .w(px(44.0))
                .h(px(44.0))
                .rounded_full()
                .bg(theme::accent_orange_soft())
                .text_color(theme::accent_orange())
                .flex()
                .items_center()
                .justify_center()
                .child(sender.to_string()),
        )
        .child(
            div()
                .flex()
                .gap_2()
                .items_center()
                .child(
                    div().text_sm().text_color(theme::accent_orange()).child(
                        message
                            .map(|item| item.sender_kind.clone())
                            .unwrap_or_else(|| "human".to_string()),
                    ),
                )
                .child(
                    div().text_sm().text_color(theme::text_muted()).child(
                        message
                            .map(|item| item.channel.clone())
                            .unwrap_or_else(|| "company".to_string()),
                    ),
                )
                .child(
                    div()
                        .px_2()
                        .py_1()
                        .rounded_full()
                        .bg(theme::accent_orange_soft())
                        .text_xs()
                        .text_color(theme::accent_orange())
                        .child("OPERATIONS"),
                )
                .child(
                    div()
                        .text_sm()
                        .text_color(theme::text_muted())
                        .child(timestamp),
                )
                .when(urgent, |container| {
                    container.child(
                        div()
                            .px_2()
                            .py_1()
                            .rounded_full()
                            .bg(theme::danger_bg())
                            .text_xs()
                            .text_color(theme::danger())
                            .child("URGENT"),
                    )
                }),
        )
}

pub(super) fn secondary_message(
    selected: Option<&domain::AgentMessage>,
) -> Option<&domain::AgentMessage> {
    selected
}

fn trim_sender(sender: &str) -> &str {
    sender.get(..2).unwrap_or(sender)
}

pub(super) fn composer_chip(label: &str) -> impl IntoElement {
    div()
        .px_4()
        .py_3()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .text_sm()
        .text_color(theme::text_secondary())
        .child(label.to_string())
}

pub(super) fn composer_subject(message: Option<&domain::AgentMessage>) -> impl IntoElement {
    div()
        .flex_1()
        .px_4()
        .py_3()
        .rounded_lg()
        .border_1()
        .border_color(theme::panel_border())
        .bg(theme::panel())
        .text_sm()
        .text_color(theme::text_subtle())
        .child(
            message
                .map(|item| item.subject.clone())
                .unwrap_or_else(|| "Subject (optional)".to_string()),
        )
}

pub(super) fn selected_recipient(message: Option<&domain::AgentMessage>) -> String {
    message
        .and_then(|item| item.to_agent_id.clone())
        .unwrap_or_else(|| "CEO (CEO)".to_string())
}
