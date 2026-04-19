use crate::{
    SharedStore, theme,
    widgets::{
        button::{primary_button, secondary_button},
        text_input::TextInput,
    },
};
use app_models::AppState;
use domain::{ApprovalState, ProfileSnapshot, SectionId};
use gpui::{App, Context, Entity, SharedString, Window, div, prelude::*, px};
use storage::NewCompanyInput;

mod approvals;
mod documents;
mod inbox;
mod messages;
mod messages_parts;
mod onboarding;
mod overview;
mod runs;
mod runtime;
mod settings;
mod sidebar;
mod workspaces;

pub struct AppRoot {
    store: SharedStore,
    snapshot: ProfileSnapshot,
    state: AppState,
    company_name_input: Entity<TextInput>,
    mission_input: Entity<TextInput>,
    workspace_input: Entity<TextInput>,
    message_input: Entity<TextInput>,
    document_title_input: Entity<TextInput>,
    document_body_input: Entity<TextInput>,
    runtime_steer_input: Entity<TextInput>,
    runtime_follow_up_input: Entity<TextInput>,
    runtime_session: Option<runtime::LiveRuntimeSession>,
}

impl AppRoot {
    pub fn new(store: SharedStore, snapshot: ProfileSnapshot, cx: &mut App) -> Self {
        let mut root = Self {
            store,
            snapshot,
            state: AppState::default(),
            company_name_input: TextInput::new(cx, "Company name"),
            mission_input: TextInput::new(cx, "Mission or thesis direction"),
            workspace_input: TextInput::new(cx, "Primary workspace path"),
            message_input: TextInput::new(cx, "Board message"),
            document_title_input: TextInput::new(cx, "Document title"),
            document_body_input: TextInput::new(cx, "Document body"),
            runtime_steer_input: TextInput::new(cx, "Steer the active run"),
            runtime_follow_up_input: TextInput::new(cx, "Queue a follow-up after the current run"),
            runtime_session: None,
        };
        root.sync_selection();
        root
    }

    fn sync_selection(&mut self) {
        if self.state.selected_run_id.is_none() {
            self.state.selected_run_id = self.snapshot.runs.first().map(|item| item.id.clone());
        }
        if self.state.selected_approval_id.is_none() {
            self.state.selected_approval_id =
                self.snapshot.approvals.first().map(|item| item.id.clone());
        }
        if self.state.selected_message_id.is_none() {
            self.state.selected_message_id = self
                .snapshot
                .agent_messages
                .first()
                .map(|item| item.id.clone());
        }
        if self.state.selected_document_id.is_none() {
            self.state.selected_document_id =
                self.snapshot.documents.first().map(|item| item.id.clone());
        }
        if self.state.selected_workspace_id.is_none() {
            self.state.selected_workspace_id =
                self.snapshot.workspaces.first().map(|item| item.id.clone());
        }
    }

    fn current_company_id(&self) -> Option<&str> {
        self.snapshot
            .current_company()
            .map(|company| company.id.as_str())
    }

    fn set_status(&mut self, message: impl Into<String>, cx: &mut Context<Self>) {
        self.state.set_status(message);
        cx.notify();
    }

    fn reload(&mut self, status: impl Into<String>, cx: &mut Context<Self>) {
        let result = {
            let store = self.store.lock();
            store.snapshot()
        };
        match result {
            Ok(snapshot) => {
                self.snapshot = snapshot;
                self.sync_selection();
                self.state.set_status(status);
                cx.notify();
            }
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn create_company(&mut self, cx: &mut Context<Self>) {
        let input = NewCompanyInput {
            name: self.company_name_input.read(cx).value(),
            description: self.mission_input.read(cx).value(),
            workspace_path: self.workspace_input.read(cx).value(),
            execution_mode: "ai_ceo".to_string(),
        };
        let result = {
            let mut store = self.store.lock();
            store.create_company(input)
        };
        match result {
            Ok(_) => {
                self.company_name_input.update(cx, |input, _| input.clear());
                self.mission_input.update(cx, |input, _| input.clear());
                self.workspace_input.update(cx, |input, _| input.clear());
                self.reload("Company created in the native profile.", cx);
            }
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn switch_company(&mut self, company_id: String, cx: &mut Context<Self>) {
        let result = {
            let mut store = self.store.lock();
            store.set_current_company(&company_id)
        };
        match result {
            Ok(_) => self.reload("Company switched.", cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn update_theme(&mut self, theme: &'static str, cx: &mut Context<Self>) {
        let result = {
            let mut store = self.store.lock();
            store.update_theme(theme)
        };
        match result {
            Ok(_) => self.reload(format!("Theme updated to {theme}."), cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn update_locale(&mut self, locale: &'static str, cx: &mut Context<Self>) {
        let result = {
            let mut store = self.store.lock();
            store.update_locale(locale)
        };
        match result {
            Ok(_) => self.reload(format!("Locale updated to {locale}."), cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn update_execution_mode(&mut self, execution_mode: &'static str, cx: &mut Context<Self>) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let result = {
            let mut store = self.store.lock();
            store.update_execution_mode(&company_id, execution_mode)
        };
        match result {
            Ok(_) => self.reload(format!("Execution mode updated to {execution_mode}."), cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn set_primary_selected_workspace(&mut self, cx: &mut Context<Self>) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let Some(workspace_id) = self.state.selected_workspace_id.clone() else {
            self.set_status("Choose a workspace first.", cx);
            return;
        };
        let result = {
            let mut store = self.store.lock();
            store.set_primary_workspace(&company_id, &workspace_id)
        };
        match result {
            Ok(_) => self.reload("Primary workspace updated.", cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn decide_selected_approval(
        &mut self,
        state: ApprovalState,
        note: &'static str,
        cx: &mut Context<Self>,
    ) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let Some(approval_id) = self.state.selected_approval_id.clone() else {
            self.set_status("Choose an approval first.", cx);
            return;
        };
        let selected_approval = self
            .snapshot
            .approvals
            .iter()
            .find(|approval| approval.id == approval_id)
            .cloned();
        let result = {
            let mut store = self.store.lock();
            store.decide_approval(&company_id, &approval_id, state, note)
        };
        match result {
            Ok(_) => {
                self.maybe_dispatch_runtime_approval(selected_approval.as_ref(), state, cx);
                self.reload(format!("Approval moved to {}.", state.as_str()), cx);
            }
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn send_message(&mut self, cx: &mut Context<Self>) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let body = self.message_input.read(cx).value();
        let result = {
            let mut store = self.store.lock();
            store.send_board_message(&company_id, &body)
        };
        match result {
            Ok(_) => {
                self.message_input.update(cx, |input, _| input.clear());
                self.reload("Board message saved.", cx);
            }
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn mark_selected_message_read(&mut self, cx: &mut Context<Self>) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let Some(message_id) = self.state.selected_message_id.clone() else {
            self.set_status("Choose a message first.", cx);
            return;
        };
        let result = {
            let mut store = self.store.lock();
            store.mark_message_read(&company_id, &message_id)
        };
        match result {
            Ok(_) => self.reload("Message marked as read.", cx),
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }

    fn create_document(&mut self, cx: &mut Context<Self>) {
        let Some(company_id) = self.current_company_id().map(str::to_string) else {
            self.set_status("Create a company first.", cx);
            return;
        };
        let title = self.document_title_input.read(cx).value();
        let body = self.document_body_input.read(cx).value();
        let result = {
            let mut store = self.store.lock();
            store.create_document(&company_id, &title, &body)
        };
        match result {
            Ok(_) => {
                self.document_title_input
                    .update(cx, |input, _| input.clear());
                self.document_body_input
                    .update(cx, |input, _| input.clear());
                self.reload("Document saved.", cx);
            }
            Err(error) => self.set_status(error.to_string(), cx),
        }
    }
}

impl Render for AppRoot {
    fn render(&mut self, _window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        if self.snapshot.companies.is_empty() {
            return self.render_onboarding(cx).into_any_element();
        }

        let header = self
            .snapshot
            .current_company()
            .map(|company| format!("{} · {}", company.name, company.execution_mode))
            .unwrap_or_else(|| "AgentCompany".to_string());

        div()
            .size_full()
            .flex()
            .bg(theme::window_bg())
            .child(self.render_sidebar(cx))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .px_8()
                            .py_5()
                            .border_b_1()
                            .border_color(theme::panel_border())
                            .bg(theme::shell_header())
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_between()
                                    .child(
                                        div()
                                            .child(
                                                div()
                                                    .text_3xl()
                                                    .text_color(theme::text_primary())
                                                    .child(self.state.section.label()),
                                            )
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(theme::text_muted())
                                                    .child(header),
                                            )
                                            .child(
                                                div()
                                                    .text_sm()
                                                    .text_color(theme::text_subtle())
                                                    .child(self.state.status_line.clone().unwrap_or_else(|| {
                                                        "Native Rust shell is reading the shared local profile."
                                                            .to_string()
                                                    })),
                                            ),
                                    )
                                    .child(
                                        div()
                                            .px_4()
                                            .py_3()
                                            .rounded_lg()
                                            .border_1()
                                            .border_color(theme::panel_border())
                                            .bg(theme::panel())
                                            .text_sm()
                                            .text_color(theme::text_secondary())
                                            .child("Show console"),
                                    ),
                            ),
                    )
                    .child(
                        div()
                            .id("main-scroll")
                            .flex_1()
                            .overflow_scroll()
                            .p_8()
                            .child(match self.state.section {
                                SectionId::Overview => self.render_overview().into_any_element(),
                                SectionId::Runs => self.render_runs(cx).into_any_element(),
                                SectionId::Inbox => self.render_inbox().into_any_element(),
                                SectionId::Messages => self.render_messages(cx).into_any_element(),
                                SectionId::Approvals => {
                                    self.render_approvals(cx).into_any_element()
                                }
                                SectionId::Documents => {
                                    self.render_documents(cx).into_any_element()
                                }
                                SectionId::Workspaces => {
                                    self.render_workspaces(cx).into_any_element()
                                }
                                SectionId::Settings => {
                                    self.render_settings(cx).into_any_element()
                                }
                            }),
                    ),
            )
            .into_any_element()
    }
}
