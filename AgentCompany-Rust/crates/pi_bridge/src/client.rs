use crate::{ClientRequest, RuntimeEvent};
use anyhow::{Context, Result};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

pub struct PiBridgeClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PiBridgeClient {
    pub fn spawn(command: PathBuf, args: &[String], working_dir: Option<PathBuf>) -> Result<Self> {
        let mut process = Command::new(&command);
        process
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());

        if let Some(dir) = working_dir {
            process.current_dir(dir);
        }

        let mut child = process
            .spawn()
            .with_context(|| format!("failed to spawn Pi Mono sidecar at {}", command.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("Pi Mono sidecar stdin is unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("Pi Mono sidecar stdout is unavailable")?;
        Ok(Self {
            child,
            stdin,
            stdout: BufReader::new(stdout),
        })
    }

    pub fn send(&mut self, message: &ClientRequest) -> Result<()> {
        let payload =
            serde_json::to_vec(message).context("failed to serialize Pi bridge request")?;
        self.stdin
            .write_all(&payload)
            .context("failed to write Pi bridge request")?;
        self.stdin
            .write_all(b"\n")
            .context("failed to terminate Pi bridge request")?;
        self.stdin
            .flush()
            .context("failed to flush Pi bridge request")?;
        Ok(())
    }

    pub fn read_event(&mut self) -> Result<RuntimeEvent> {
        let mut line = String::new();
        let bytes = self
            .stdout
            .read_line(&mut line)
            .context("failed to read Pi bridge event")?;
        if bytes == 0 {
            return Err(anyhow::anyhow!("Pi Mono sidecar closed stdout"));
        }
        serde_json::from_str(line.trim()).context("failed to decode Pi bridge event")
    }

    pub fn wait(&mut self) -> Result<()> {
        self.child
            .wait()
            .context("failed while waiting for Pi Mono sidecar")?;
        Ok(())
    }
}
