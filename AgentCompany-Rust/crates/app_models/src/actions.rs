use domain::SectionId;

#[derive(Clone, Debug)]
pub enum AppAction {
    SelectSection(SectionId),
    SelectRun(Option<String>),
    SelectApproval(Option<String>),
    SelectMessage(Option<String>),
    SelectDocument(Option<String>),
    SelectWorkspace(Option<String>),
    Status(String),
    ClearStatus,
}
