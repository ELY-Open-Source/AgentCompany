use super::*;

pub(super) fn message_section_label(label: &'static str) -> impl IntoElement {
    div()
        .text_size(px(11.0))
        .font_weight(gpui::FontWeight::SEMIBOLD)
        .text_color(theme::muted_foreground())
        .mb(px(4.0))
        .px(px(8.0))
        .child(label)
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
        .p_4()
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::border())
        .bg(theme::card())
        .child(message_header(message, false))
        .child(
            div()
                .mt(px(16.0))
                .text_size(px(14.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme::foreground())
                .child(subject),
        )
        .child(
            div()
                .mt(px(12.0))
                .text_size(px(14.0))
                .text_color(theme::muted_foreground())
                .child(body),
        )
        .child(
            div()
                .mt(px(16.0))
                .text_size(px(14.0))
                .text_color(theme::muted_foreground())
                .child("↩ Reply"),
        )
}

pub(super) fn compact_message_card(message: &domain::AgentMessage) -> impl IntoElement {
    div()
        .mt(px(16.0))
        .p(px(12.0))
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::border())
        .bg(theme::card())
        .child(message_header(Some(message), true))
        .child(
            div()
                .mt(px(12.0))
                .text_size(px(14.0))
                .font_weight(gpui::FontWeight::SEMIBOLD)
                .text_color(theme::foreground())
                .child(message.subject.clone()),
        )
        .child(
            div()
                .mt(px(8.0))
                .text_size(px(14.0))
                .text_color(theme::muted_foreground())
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
                .w(px(36.0))
                .h(px(36.0))
                .rounded_full()
                .bg(theme::accent())
                .border_1()
                .border_color(theme::border())
                .text_color(theme::foreground())
                .flex()
                .items_center()
                .justify_center()
                .text_size(px(14.0))
                .font_weight(gpui::FontWeight::MEDIUM)
                .child(sender.to_string()),
        )
        .child(
            div()
                .flex()
                .flex_1()
                .gap_2()
                .items_center()
                .child(
                    div()
                        .text_size(px(14.0))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(theme::foreground())
                        .child(
                            message
                                .map(|item| item.sender_kind.clone())
                                .unwrap_or_else(|| "human".to_string()),
                        ),
                )
                .child(
                    div()
                        .text_size(px(12.0))
                        .text_color(theme::muted_foreground())
                        .child(
                            message
                                .map(|item| item.channel.clone())
                                .unwrap_or_else(|| "company".to_string()),
                        ),
                )
                .child(
                    div()
                        .px(px(8.0))
                        .py(px(2.0))
                        .rounded_full()
                        .bg(theme::primary())
                        .text_size(px(10.0))
                        .font_weight(gpui::FontWeight::MEDIUM)
                        .text_color(theme::primary_foreground())
                        .child("OPERATIONS"),
                )
                .child(
                    div()
                        .flex_1()
                        .text_size(px(12.0))
                        .text_color(theme::muted_foreground())
                        .child(timestamp),
                )
                .when(urgent, |container| {
                    container.child(
                        div()
                            .px(px(8.0))
                            .py(px(2.0))
                            .rounded_full()
                            .bg(theme::destructive())
                            .text_size(px(10.0))
                            .font_weight(gpui::FontWeight::MEDIUM)
                            .text_color(theme::primary_foreground())
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
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::border())
        .bg(theme::muted())
        .text_size(px(12.0))
        .font_weight(gpui::FontWeight::MEDIUM)
        .text_color(theme::muted_foreground())
        .child(label.to_string())
}

pub(super) fn composer_subject(message: Option<&domain::AgentMessage>) -> impl IntoElement {
    div()
        .flex_1()
        .px(px(12.0))
        .py(px(6.0))
        .rounded(px(0.0))
        .border_1()
        .border_color(theme::border())
        .bg(theme::card())
        .text_size(px(14.0))
        .text_color(theme::muted_foreground())
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
