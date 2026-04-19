use crate::{
    SharedStore,
    widgets::{
        button::{primary_button, secondary_button},
        text_input::TextInput,
    },
};
use app_models::AppState;
use domain::{ApprovalState, ProfileSnapshot, SectionId};
use gpui::{App, Context, Entity, SharedString, Window, div, prelude::*, px, rgb};
use storage::NewCompanyInput;

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
        let result = {
            let mut store = self.store.lock();
            store.decide_approval(&company_id, &approval_id, state, note)
        };
        match result {
            Ok(_) => self.reload(format!("Approval moved to {}.", state.as_str()), cx),
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

    fn metric_card(
        &self,
        label: impl Into<String>,
        value: String,
        detail: impl Into<String>,
    ) -> impl IntoElement + '_ {
        let label = label.into();
        let detail = detail.into();
        div()
            .flex_1()
            .p_4()
            .gap_2()
            .border_1()
            .rounded_md()
            .border_color(rgb(0xd9cdbf))
            .bg(rgb(0xfffbf5))
            .child(div().text_sm().text_color(rgb(0x6f665d)).child(label))
            .child(div().text_3xl().text_color(rgb(0x171411)).child(value))
            .child(div().text_sm().text_color(rgb(0x6f665d)).child(detail))
    }

    fn render_sidebar(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
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

    fn render_overview(&self) -> impl IntoElement + '_ {
        let company = self.snapshot.current_company();
        let company_name = company
            .map(|item| item.name.clone())
            .unwrap_or_else(|| "No company".to_string());
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(self.metric_card(
                        "Active tasks",
                        self.snapshot.active_tasks().to_string(),
                        "Tasks in todo, review, or execution",
                    ))
                    .child(self.metric_card(
                        "Pending approvals",
                        self.snapshot.pending_approvals().to_string(),
                        "Human review gates",
                    ))
                    .child(self.metric_card(
                        "Unread messages",
                        self.snapshot.unread_messages().to_string(),
                        "Company and direct channels",
                    ))
                    .child(self.metric_card(
                        "Active runs",
                        self.snapshot.active_runs().to_string(),
                        "Queued, running, and waiting runs",
                    )),
            )
            .child(
                div()
                    .flex()
                    .gap_4()
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .gap_2()
                            .border_1()
                            .rounded_md()
                            .border_color(rgb(0xd9cdbf))
                            .bg(rgb(0xfffbf5))
                            .child(div().text_lg().child(company_name))
                            .children(self.snapshot.tasks.iter().take(6).map(|task| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(rgb(0xeee3d7))
                                    .child(format!("{} · {}", task.status, task.title))
                            })),
                    )
                    .child(
                        div()
                            .flex_1()
                            .p_4()
                            .gap_2()
                            .border_1()
                            .rounded_md()
                            .border_color(rgb(0xd9cdbf))
                            .bg(rgb(0xfffbf5))
                            .child(div().text_lg().child("Recent activity"))
                            .children(self.snapshot.activity.iter().take(6).map(|item| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(rgb(0xeee3d7))
                                    .child(format!("{} · {}", item.action, item.detail))
                            })),
                    ),
            )
    }

    fn render_runs(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_run_id
            .as_ref()
            .and_then(|id| self.snapshot.runs.iter().find(|item| &item.id == id));
        let selected_status = selected
            .map(|item| item.status.clone())
            .unwrap_or_else(|| "Select a run".to_string());
        let selected_summary = selected
            .map(|item| item.summary.clone())
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "No run selected.".to_string());
        let selected_model = selected
            .and_then(|item| item.model.clone())
            .unwrap_or_else(|| "model pending".to_string());
        let selected_agent = selected
            .and_then(|run| {
                self.snapshot
                    .agents
                    .iter()
                    .find(|agent| agent.id == run.agent_id)
                    .map(|agent| agent.name.clone())
            })
            .unwrap_or_else(|| "Agent unavailable".to_string());
        let selected_workspace = selected
            .and_then(|run| {
                run.workspace_id.as_ref().and_then(|workspace_id| {
                    self.snapshot
                        .workspaces
                        .iter()
                        .find(|workspace| &workspace.id == workspace_id)
                        .map(|workspace| workspace.name.clone())
                })
            })
            .unwrap_or_else(|| "Workspace pending".to_string());
        let selected_error = selected
            .and_then(|item| item.error_message.clone())
            .unwrap_or_default();

        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("runs-list")
                    .w(px(360.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Run queue"))
                    .children(self.snapshot.runs.iter().map(|item| {
                        let active =
                            self.state.selected_run_id.as_deref() == Some(item.id.as_str());
                        let run_id = item.id.clone();
                        let headline = if item.summary.trim().is_empty() {
                            format!("{} · {}", item.status, item.id)
                        } else {
                            format!("{} · {}", item.status, item.summary)
                        };
                        div()
                            .id(SharedString::from(format!("run-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_run_id = Some(run_id.clone());
                                cx.notify();
                            }))
                            .child(headline)
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Run inspector"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(selected_status),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(self.metric_card("Agent", selected_agent, "Assigned operator"))
                            .child(self.metric_card(
                                "Model",
                                selected_model,
                                "Runtime-selected model",
                            )),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(self.metric_card(
                                "Workspace",
                                selected_workspace,
                                "Bound workspace",
                            ))
                            .child(
                                self.metric_card(
                                    "Connector",
                                    selected
                                        .map(|item| item.connector_id.clone())
                                        .unwrap_or_else(|| "connector pending".to_string()),
                                    "Execution provider",
                                ),
                            ),
                    )
                    .child(
                        div()
                            .min_h(px(180.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(selected_summary),
                    )
                    .when(!selected_error.is_empty(), |container| {
                        container.child(
                            div()
                                .p_3()
                                .border_1()
                                .border_color(rgb(0x9e3d2d))
                                .rounded_md()
                                .bg(rgb(0xffefe8))
                                .child(selected_error),
                        )
                    }),
            )
    }

    fn render_inbox(&self) -> impl IntoElement + '_ {
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Unread messages"))
                    .children(
                        self.snapshot
                            .agent_messages
                            .iter()
                            .filter(|item| item.read_at.is_none())
                            .take(8)
                            .map(|item| {
                                div()
                                    .py_2()
                                    .border_b_1()
                                    .border_color(rgb(0xeee3d7))
                                    .child(format!("{} · {}", item.subject, item.body))
                            }),
                    ),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Pending approvals"))
                    .children(
                        self.snapshot
                            .approvals
                            .iter()
                            .filter(|item| item.state == "pending")
                            .take(8)
                            .map(|item| {
                                div().py_2().border_b_1().border_color(rgb(0xeee3d7)).child(
                                    format!("{} · {}", item.approval_type, item.payload_summary),
                                )
                            }),
                    ),
            )
    }

    fn render_messages(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self.state.selected_message_id.as_ref().and_then(|id| {
            self.snapshot
                .agent_messages
                .iter()
                .find(|item| &item.id == id)
        });
        let selected_subject = selected
            .map(|item| item.subject.clone())
            .unwrap_or_else(|| "Select a thread".to_string());
        let selected_body = selected
            .map(|item| item.body.clone())
            .unwrap_or_else(|| "No message selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("messages-list")
                    .w(px(320.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Channels"))
                    .children(self.snapshot.agent_messages.iter().map(|item| {
                        let active =
                            self.state.selected_message_id.as_deref() == Some(item.id.as_str());
                        let message_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("message-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_message_id = Some(message_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.subject, item.priority))
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Conversation"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(selected_subject),
                    )
                    .child(
                        div()
                            .min_h(px(220.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(selected_body),
                    )
                    .child(self.message_input.clone())
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

    fn render_approvals(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_approval_id
            .as_ref()
            .and_then(|id| self.snapshot.approvals.iter().find(|item| &item.id == id));
        let approval_type = selected
            .map(|item| item.approval_type.clone())
            .unwrap_or_else(|| "Select an approval".to_string());
        let approval_summary = selected
            .map(|item| item.impact_summary.clone())
            .unwrap_or_else(|| "No approval selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("approvals-list")
                    .w(px(340.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Approval queue"))
                    .children(self.snapshot.approvals.iter().map(|item| {
                        let active =
                            self.state.selected_approval_id.as_deref() == Some(item.id.as_str());
                        let approval_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("approval-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_approval_id = Some(approval_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.state, item.payload_summary))
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Decision"))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(approval_type),
                    )
                    .child(
                        div()
                            .min_h(px(160.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(approval_summary),
                    )
                    .child(
                        div()
                            .flex()
                            .gap_2()
                            .child(primary_button("Approve", cx, |this, cx| {
                                this.decide_selected_approval(
                                    ApprovalState::Approved,
                                    "Approved from native shell.",
                                    cx,
                                )
                            }))
                            .child(secondary_button("Reject", cx, |this, cx| {
                                this.decide_selected_approval(
                                    ApprovalState::Rejected,
                                    "Rejected from native shell.",
                                    cx,
                                )
                            })),
                    ),
            )
    }

    fn render_documents(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        let selected = self
            .state
            .selected_document_id
            .as_ref()
            .and_then(|id| self.snapshot.documents.iter().find(|item| &item.id == id));
        let document_title = selected
            .map(|item| item.title.clone())
            .unwrap_or_else(|| "Select a document".to_string());
        let document_content = selected
            .map(|item| item.content.clone())
            .unwrap_or_else(|| "No document selected.".to_string());
        div()
            .flex()
            .gap_4()
            .child(
                div()
                    .id("documents-list")
                    .w(px(340.0))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .overflow_scroll()
                    .child(div().text_lg().child("Document center"))
                    .children(self.snapshot.documents.iter().map(|item| {
                        let active =
                            self.state.selected_document_id.as_deref() == Some(item.id.as_str());
                        let document_id = item.id.clone();
                        div()
                            .id(SharedString::from(format!("document-{}", item.id)))
                            .px_3()
                            .py_2()
                            .rounded_md()
                            .cursor_pointer()
                            .bg(if active { rgb(0xefe2d4) } else { rgb(0xfffbf5) })
                            .hover(|style| style.bg(rgb(0xf4ede4)))
                            .on_click(cx.listener(move |this, _, _, cx| {
                                this.state.selected_document_id = Some(document_id.clone());
                                cx.notify();
                            }))
                            .child(format!("{} · {}", item.status, item.title))
                    })),
            )
            .child(
                div()
                    .flex_1()
                    .p_4()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("Quick draft"))
                    .child(self.document_title_input.clone())
                    .child(self.document_body_input.clone())
                    .child(primary_button("Save draft", cx, |this, cx| {
                        this.create_document(cx)
                    }))
                    .child(div().h(px(1.0)).bg(rgb(0xeee3d7)))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(document_title),
                    )
                    .child(
                        div()
                            .min_h(px(200.0))
                            .p_3()
                            .border_1()
                            .border_color(rgb(0xeee3d7))
                            .rounded_md()
                            .bg(rgb(0xf7f0e7))
                            .child(document_content),
                    ),
            )
    }

    fn render_workspaces(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .flex()
            .flex_col()
            .gap_3()
            .children(self.snapshot.workspaces.iter().map(|workspace| {
                let active =
                    self.state.selected_workspace_id.as_deref() == Some(workspace.id.as_str());
                let workspace_id = workspace.id.clone();
                div()
                    .id(SharedString::from(format!("workspace-{}", workspace.id)))
                    .p_4()
                    .gap_2()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(if active { rgb(0xf7f0e7) } else { rgb(0xfffbf5) })
                    .cursor_pointer()
                    .hover(|style| style.bg(rgb(0xf4ede4)))
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.state.selected_workspace_id = Some(workspace_id.clone());
                        cx.notify();
                    }))
                    .child(div().text_lg().child(workspace.name.clone()))
                    .child(
                        div()
                            .text_sm()
                            .text_color(rgb(0x6f665d))
                            .child(workspace.local_path.clone()),
                    )
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child(format!(
                        "{} · {}",
                        workspace.state,
                        if workspace.is_primary {
                            "primary"
                        } else {
                            "linked"
                        }
                    )))
            }))
    }

    fn render_settings(&self) -> impl IntoElement + '_ {
        let current = self.snapshot.current_company();
        let execution_mode = current
            .map(|item| item.execution_mode.clone())
            .unwrap_or_else(|| "ai_ceo".to_string());
        div()
            .flex()
            .flex_col()
            .gap_4()
            .child(self.metric_card(
                "Profile path",
                self.snapshot.profile_path.clone(),
                "Electron-compatible local profile",
            ))
            .child(self.metric_card(
                "Theme",
                self.snapshot.theme.clone(),
                "Stored in the shared settings table",
            ))
            .child(self.metric_card(
                "Locale",
                self.snapshot.locale.clone(),
                "Read from settings or the OS locale",
            ))
            .child(self.metric_card(
                "Connectors",
                self.snapshot.connectors.len().to_string(),
                execution_mode,
            ))
    }

    fn render_onboarding(&self, cx: &mut Context<Self>) -> impl IntoElement + '_ {
        div()
            .size_full()
            .p_8()
            .flex()
            .gap_8()
            .bg(rgb(0xf3efe8))
            .child(
                div()
                    .flex_1()
                    .gap_4()
                    .child(div().text_3xl().text_color(rgb(0x171411)).child("Start a native AgentCompany profile"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Create the first company, point it at a workspace, and keep the SQLite profile local."))
                    .child(self.company_name_input.clone())
                    .child(self.mission_input.clone())
                    .child(self.workspace_input.clone())
                    .child(primary_button("Create company", cx, |this, cx| this.create_company(cx))),
            )
            .child(
                div()
                    .w(px(380.0))
                    .p_5()
                    .gap_3()
                    .border_1()
                    .rounded_md()
                    .border_color(rgb(0xd9cdbf))
                    .bg(rgb(0xfffbf5))
                    .child(div().text_lg().child("What lands in SQLite"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Company"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Primary workspace"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Connector catalog"))
                    .child(div().text_sm().text_color(rgb(0x6f665d)).child("Shared profile settings")),
            )
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
            .bg(rgb(0xf3efe8))
            .child(self.render_sidebar(cx))
            .child(
                div()
                    .flex_1()
                    .flex()
                    .flex_col()
                    .child(
                        div()
                            .px_6()
                            .py_4()
                            .border_b_1()
                            .border_color(rgb(0xd9cdbf))
                            .bg(rgb(0xf8f2e9))
                            .child(div().text_xl().text_color(rgb(0x171411)).child(header))
                            .child(div().text_sm().text_color(rgb(0x6f665d)).child(
                                self.state.status_line.clone().unwrap_or_else(|| {
                                    "Native Rust shell is reading the shared local profile."
                                        .to_string()
                                }),
                            )),
                    )
                    .child(
                        div()
                            .id("main-scroll")
                            .flex_1()
                            .overflow_scroll()
                            .p_6()
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
                                SectionId::Settings => self.render_settings().into_any_element(),
                            }),
                    ),
            )
            .into_any_element()
    }
}
