use anyhow::{Context, Result};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

pub fn now_iso() -> Result<String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .context("failed to format UTC timestamp")
}
