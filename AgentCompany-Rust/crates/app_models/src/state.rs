use domain::SectionId;

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum OnboardingStep {
    #[default]
    NodeCheck,
    Providers,
    Company,
    ModelPool,
    ExecutionMode,
    Mission,
    Launch,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum InboxFilter {
    #[default]
    All,
    Approvals,
    Reviews,
    Failed,
    Messages,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum RunFilter {
    #[default]
    All,
    Running,
    NeedsReview,
    Finished,
}

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub enum SettingsTab {
    #[default]
    General,
    Mode,
    Providers,
    Shortcuts,
    Data,
    Secrets,
}

#[derive(Clone, Debug, Default)]
pub struct AppState {
    pub section: SectionId,
    pub selected_run_id: Option<String>,
    pub selected_approval_id: Option<String>,
    pub selected_message_id: Option<String>,
    pub selected_document_id: Option<String>,
    pub selected_workspace_id: Option<String>,
    pub onboarding_step: OnboardingStep,
    pub onboarding_connector_id: Option<String>,
    pub onboarding_execution_mode: &'static str,
    pub inbox_filter: InboxFilter,
    pub run_filter: RunFilter,
    pub settings_tab: SettingsTab,
    pub message_unread_only: bool,
    pub status_line: Option<String>,
}

impl AppState {
    pub fn set_status(&mut self, value: impl Into<String>) {
        self.status_line = Some(value.into());
    }

    pub fn clear_status(&mut self) {
        self.status_line = None;
    }
}
