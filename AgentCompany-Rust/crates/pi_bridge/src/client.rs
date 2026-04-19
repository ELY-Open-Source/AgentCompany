use crate::{ClientRequest, RuntimeEvent};
use anyhow::{Context, Result};
use std::{
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, ChildStdout, Command, Stdio},
};

pub struct PiBridgeWriter {
    stdin: ChildStdin,
}

pub struct PiBridgeEventStream {
    child: Child,
    stdout: BufReader<ChildStdout>,
}

pub struct PiBridgeClient {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl PiBridgeClient {
    pub fn spawn(command: PathBuf, args: &[String], working_dir: Option<PathBuf>) -> Result<Self> {
        let (child, stdin, stdout) = spawn_process(command, args, working_dir)?;
        Ok(Self {
            child,
            stdin,
            stdout,
        })
    }

    pub fn spawn_split(
        command: PathBuf,
        args: &[String],
        working_dir: Option<PathBuf>,
    ) -> Result<(PiBridgeWriter, PiBridgeEventStream)> {
        let (child, stdin, stdout) = spawn_process(command, args, working_dir)?;
        Ok((
            PiBridgeWriter { stdin },
            PiBridgeEventStream { child, stdout },
        ))
    }

    pub fn send(&mut self, message: &ClientRequest) -> Result<()> {
        write_request(&mut self.stdin, message)
    }

    pub fn read_event(&mut self) -> Result<RuntimeEvent> {
        read_event(&mut self.stdout)
    }

    pub fn wait(&mut self) -> Result<()> {
        self.child
            .wait()
            .context("failed while waiting for Pi Mono sidecar")?;
        Ok(())
    }
}

impl PiBridgeWriter {
    pub fn send(&mut self, message: &ClientRequest) -> Result<()> {
        write_request(&mut self.stdin, message)
    }
}

impl PiBridgeEventStream {
    pub fn read_event(&mut self) -> Result<RuntimeEvent> {
        read_event(&mut self.stdout)
    }

    pub fn wait(&mut self) -> Result<()> {
        self.child
            .wait()
            .context("failed while waiting for Pi Mono sidecar")?;
        Ok(())
    }
}

fn spawn_process(
    command: PathBuf,
    args: &[String],
    working_dir: Option<PathBuf>,
) -> Result<(Child, ChildStdin, BufReader<ChildStdout>)> {
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
    Ok((child, stdin, BufReader::new(stdout)))
}

fn write_request(stdin: &mut ChildStdin, message: &ClientRequest) -> Result<()> {
    let payload = serde_json::to_vec(message).context("failed to serialize Pi bridge request")?;
    stdin
        .write_all(&payload)
        .context("failed to write Pi bridge request")?;
    stdin
        .write_all(b"\n")
        .context("failed to terminate Pi bridge request")?;
    stdin.flush().context("failed to flush Pi bridge request")?;
    Ok(())
}

fn read_event(stdout: &mut BufReader<ChildStdout>) -> Result<RuntimeEvent> {
    let mut line = String::new();
    let bytes = stdout
        .read_line(&mut line)
        .context("failed to read Pi bridge event")?;
    if bytes == 0 {
        return Err(anyhow::anyhow!("Pi Mono sidecar closed stdout"));
    }
    serde_json::from_str(line.trim()).context("failed to decode Pi bridge event")
}
