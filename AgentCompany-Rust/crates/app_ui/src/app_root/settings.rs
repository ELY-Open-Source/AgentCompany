use super::*;

impl AppRoot {
    pub(super) fn render_settings(&self) -> impl IntoElement + '_ {
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
}
