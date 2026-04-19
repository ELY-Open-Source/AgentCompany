use super::*;

impl AppRoot {
    pub(super) fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let sections = [
            SectionId::Overview,
            SectionId::Runs,
            SectionId::Inbox,
            SectionId::Messages,
            SectionId::Approvals,
            SectionId::Documents,
            SectionId::Workspaces,
            SectionId::Settings,
        ];
        div()
            .w(px(208.0))
            .h_full()
            .p_4()
            .gap_4()
            .flex()
            .flex_col()
            .bg(theme::sidebar_bg())
            .text_color(theme::sidebar_text())
            .child(div().text_lg().child("AgentCompany"))
            .children(self.snapshot.companies.iter().map(|company| {
                let active =
                    self.snapshot.current_company_id.as_deref() == Some(company.id.as_str());
                let company_id = company.id.clone();
                div()
                    .id(SharedString::from(format!("company-{}", company.id)))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .cursor_pointer()
                    .bg(if active {
                        theme::primary_action()
                    } else {
                        theme::sidebar_surface()
                    })
                    .hover(|style| style.bg(theme::sidebar_surface_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.switch_company(company_id.clone(), cx)
                    }))
                    .child(company.name.clone())
            }))
            .child(div().h(px(1.0)).bg(theme::sidebar_divider()))
            .children(sections.into_iter().map(|section| {
                let active = self.state.section == section;
                div()
                    .id(SharedString::from(format!(
                        "section-{}",
                        section.label().to_lowercase()
                    )))
                    .px_3()
                    .py_2()
                    .rounded_md()
                    .cursor_pointer()
                    .bg(if active {
                        theme::selection_fill()
                    } else {
                        theme::sidebar_bg()
                    })
                    .text_color(if active {
                        theme::text_primary()
                    } else {
                        theme::sidebar_text()
                    })
                    .hover(|style| style.bg(theme::sidebar_hover()))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.section = section;
                        cx.notify();
                    }))
                    .child(section.label())
            }))
    }
}
