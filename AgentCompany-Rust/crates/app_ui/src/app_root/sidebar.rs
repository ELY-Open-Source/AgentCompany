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
            .bg(rgb(0x161514))
            .text_color(rgb(0xf5eee4))
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
                    .bg(if active { rgb(0x9e3d2d) } else { rgb(0x211d1a) })
                    .hover(|style| style.bg(rgb(0x362c27)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.switch_company(company_id.clone(), cx)
                    }))
                    .child(company.name.clone())
            }))
            .child(div().h(px(1.0)).bg(rgb(0x2f2924)))
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
                    .bg(if active { rgb(0xefe2d4) } else { rgb(0x161514) })
                    .text_color(if active { rgb(0x171411) } else { rgb(0xf5eee4) })
                    .hover(|style| style.bg(rgb(0x2c2825)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.section = section;
                        cx.notify();
                    }))
                    .child(section.label())
            }))
    }
}
