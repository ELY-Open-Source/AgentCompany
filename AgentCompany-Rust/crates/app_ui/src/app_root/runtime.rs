use super::*;
use ::runtime::RuntimeConfig;
use anyhow::{Context as _, Result, anyhow};
use pi_bridge::{
    ClientRequest, FollowUpRequest, RunBudget, RunRequest, RuntimeEvent, RuntimeHandshake,
    SteerRequest, ToolApprovalDecision,
};
use std::{
    env,
    path::PathBuf,
    sync::mpsc::{self, Receiver, Sender, TryRecvError},
    time::Duration,
};
use support::paths::{RUNTIME_ARGS_ENV, RUNTIME_COMMAND_ENV, RUNTIME_WORKDIR_ENV};

pub(super) struct LiveRuntimeSession {
    pub run_id: String,
    pub commands: Sender<RuntimeCommand>,
    pub updates: Receiver<RuntimeUpdate>,
}

pub(super) enum RuntimeCommand {
    ToolApproval {
        run_id: String,
        tool_call_id: String,
        approved: bool,
        note: String,
    },
    Steer {
        run_id: String,
        body: String,
    },
    FollowUp {
        run_id: String,
        body: String,
    },
}

pub(super) enum RuntimeUpdate {
    Event(RuntimeEvent),
    Failed(String),
    Closed,
}

struct RuntimeApprovalPayload {
    run_id: String,
    tool_call_id: String,
}

impl AppRoot {
    pub(super) fn launch_selected_run(&mut self, cx: &mut Context<Self>) {
        if self.runtime_session.is_some() {
            self.set_status("A native runtime session is already active.", cx);
            return;
        }

        let selected_run_id = match self.state.selected_run_id.clone() {
            Some(run_id) => run_id,
            None => {
                self.set_status("Choose a run first.", cx);
                return;
            }
        };

        let request = match self.build_run_request(selected_run_id.as_str()) {
            Ok(request) => request,
            Err(error) => {
                self.set_status(error.to_string(), cx);
                return;
            }
        };
        let config = match resolve_runtime_config() {
            Ok(config) => config,
            Err(error) => {
                self.set_status(error.to_string(), cx);
                return;
            }
        };

        let result = {
            let mut store = self.store.lock();
            store.mark_run_started(selected_run_id.as_str())
        };
        if let Err(error) = result {
            self.set_status(error.to_string(), cx);
            return;
        }

        let (command_tx, command_rx) = mpsc::channel();
        let (update_tx, update_rx) = mpsc::channel();
        spawn_runtime_worker(config, request, command_rx, update_tx);
        self.runtime_session = Some(LiveRuntimeSession {
            run_id: selected_run_id,
            commands: command_tx,
            updates: update_rx,
        });
        self.reload("Native runtime connected.", cx);
        self.start_runtime_poll_loop(cx);
    }

    pub(super) fn send_runtime_steer(&mut self, cx: &mut Context<Self>) {
        let Some(run_id) = self.active_runtime_run_id() else {
            self.set_status("Launch a native runtime first.", cx);
            return;
        };
        let body = self.runtime_steer_input.read(cx).value();
        let trimmed = body.trim().to_string();
        if trimmed.is_empty() {
            self.set_status("Steer message cannot be empty.", cx);
            return;
        }
        if let Err(error) = self.send_runtime_command(RuntimeCommand::Steer {
            run_id,
            body: trimmed,
        }) {
            self.runtime_session = None;
            self.set_status(error.to_string(), cx);
            return;
        }
        self.runtime_steer_input
            .update(cx, |input, _| input.clear());
        self.set_status("Steer queued into the native runtime.", cx);
    }

    pub(super) fn send_runtime_follow_up(&mut self, cx: &mut Context<Self>) {
        let Some(run_id) = self.active_runtime_run_id() else {
            self.set_status("Launch a native runtime first.", cx);
            return;
        };
        let body = self.runtime_follow_up_input.read(cx).value();
        let trimmed = body.trim().to_string();
        if trimmed.is_empty() {
            self.set_status("Follow-up message cannot be empty.", cx);
            return;
        }
        if let Err(error) = self.send_runtime_command(RuntimeCommand::FollowUp {
            run_id,
            body: trimmed,
        }) {
            self.runtime_session = None;
            self.set_status(error.to_string(), cx);
            return;
        }
        self.runtime_follow_up_input
            .update(cx, |input, _| input.clear());
        self.set_status("Follow-up queued into the native runtime.", cx);
    }

    pub(super) fn maybe_dispatch_runtime_approval(
        &mut self,
        approval: Option<&domain::Approval>,
        state: ApprovalState,
        cx: &mut Context<Self>,
    ) {
        let Some(approval) = approval else {
            return;
        };
        if approval.approval_type != "runtime_tool_call" {
            return;
        }
        let payload = match parse_runtime_approval_payload(approval) {
            Ok(payload) => payload,
            Err(error) => {
                self.set_status(error.to_string(), cx);
                return;
            }
        };
        let approved = matches!(state, ApprovalState::Approved);
        let note = match state {
            ApprovalState::Approved => "Approved from native review.",
            ApprovalState::Rejected => "Rejected from native review.",
            ApprovalState::Pending => "Pending native review.",
            ApprovalState::RevisionRequested => "Revision requested from native review.",
        }
        .to_string();
        if let Err(error) = self.send_runtime_command(RuntimeCommand::ToolApproval {
            run_id: payload.run_id,
            tool_call_id: payload.tool_call_id,
            approved,
            note,
        }) {
            self.runtime_session = None;
            self.set_status(error.to_string(), cx);
        }
    }

    fn active_runtime_run_id(&self) -> Option<String> {
        let session = self.runtime_session.as_ref()?;
        let selected_matches =
            self.state.selected_run_id.as_deref() == Some(session.run_id.as_str());
        if selected_matches {
            Some(session.run_id.clone())
        } else {
            None
        }
    }

    fn send_runtime_command(&self, command: RuntimeCommand) -> Result<()> {
        let session = self
            .runtime_session
            .as_ref()
            .ok_or_else(|| anyhow!("native runtime session is unavailable"))?;
        session
            .commands
            .send(command)
            .context("native runtime command channel is closed")
    }

    fn start_runtime_poll_loop(&self, cx: &mut Context<Self>) {
        cx.spawn(
            |entity: gpui::WeakEntity<AppRoot>, async_cx: &mut gpui::AsyncApp| {
                let entity = entity.clone();
                let mut async_cx = async_cx.clone();
                async move {
                    loop {
                        async_cx
                            .background_executor()
                            .timer(Duration::from_millis(120))
                            .await;
                        let keep_running = entity
                            .update(&mut async_cx, |this, cx| this.drain_runtime_updates(cx))
                            .unwrap_or(false);
                        if !keep_running {
                            break;
                        }
                    }
                }
            },
        )
        .detach();
    }

    fn drain_runtime_updates(&mut self, cx: &mut Context<Self>) -> bool {
        let mut keep_running = self.runtime_session.is_some();
        loop {
            let next_update = match self.runtime_session.as_mut() {
                Some(session) => match session.updates.try_recv() {
                    Ok(update) => Some(update),
                    Err(TryRecvError::Empty) => None,
                    Err(TryRecvError::Disconnected) => {
                        self.runtime_session = None;
                        self.reload("Native runtime disconnected.", cx);
                        keep_running = false;
                        None
                    }
                },
                None => None,
            };
            let Some(update) = next_update else {
                break;
            };
            self.apply_runtime_update(update, cx);
            keep_running = self.runtime_session.is_some();
        }
        keep_running
    }

    fn apply_runtime_update(&mut self, update: RuntimeUpdate, cx: &mut Context<Self>) {
        match update {
            RuntimeUpdate::Event(event) => {
                let selected_run_id = self.state.selected_run_id.clone();
                let result = {
                    let mut store = self.store.lock();
                    store.ingest_runtime_event(event.clone())
                };
                match result {
                    Ok(()) => {
                        self.reload("Native runtime event applied.", cx);
                        match event {
                            RuntimeEvent::ToolCall {
                                run_id,
                                tool_call_id,
                                ..
                            } => {
                                self.state.selected_run_id = Some(run_id.clone());
                                self.state.selected_approval_id = self
                                    .snapshot
                                    .approvals
                                    .iter()
                                    .find(|approval| {
                                        approval.approval_type == "runtime_tool_call"
                                            && approval
                                                .payload_json
                                                .as_deref()
                                                .map(|payload| {
                                                    payload.contains(run_id.as_str())
                                                        && payload.contains(tool_call_id.as_str())
                                                })
                                                .unwrap_or(false)
                                    })
                                    .map(|approval| approval.id.clone());
                                cx.notify();
                            }
                            RuntimeEvent::RunFinished { run_id, .. } => {
                                self.state.selected_run_id = Some(run_id);
                                cx.notify();
                            }
                            RuntimeEvent::Message { run_id, .. }
                            | RuntimeEvent::ToolResult { run_id, .. }
                            | RuntimeEvent::Artifact { run_id, .. } => {
                                if selected_run_id.as_deref() != Some(run_id.as_str()) {
                                    self.state.selected_run_id = Some(run_id);
                                    cx.notify();
                                }
                            }
                            RuntimeEvent::HandshakeAck { .. } => {}
                        }
                    }
                    Err(error) => {
                        self.runtime_session = None;
                        self.set_status(error.to_string(), cx);
                    }
                }
            }
            RuntimeUpdate::Failed(message) => {
                self.runtime_session = None;
                self.set_status(message, cx);
            }
            RuntimeUpdate::Closed => {
                self.runtime_session = None;
                self.set_status("Native runtime session closed.", cx);
            }
        }
    }

    fn build_run_request(&self, run_id: &str) -> Result<RunRequest> {
        let run = self
            .snapshot
            .runs
            .iter()
            .find(|run| run.id == run_id)
            .cloned()
            .ok_or_else(|| anyhow!("run {run_id} was not found in the active snapshot"))?;
        let task = run
            .task_id
            .as_ref()
            .and_then(|task_id| self.snapshot.tasks.iter().find(|task| &task.id == task_id))
            .cloned()
            .ok_or_else(|| anyhow!("selected run must be linked to a task before native launch"))?;
        let company_id = self
            .current_company_id()
            .map(str::to_string)
            .ok_or_else(|| anyhow!("create a company first"))?;
        let workspace_path = run.workspace_id.as_ref().and_then(|workspace_id| {
            self.snapshot
                .workspaces
                .iter()
                .find(|workspace| &workspace.id == workspace_id)
                .map(|workspace| workspace.local_path.clone())
        });
        let prompt = if task.description.trim().is_empty() {
            task.title.clone()
        } else {
            format!("{}\n\n{}", task.title, task.description)
        };
        Ok(RunRequest {
            run_id: run.id.clone(),
            session_id: Some(run.id.clone()),
            company_id,
            task_id: Some(task.id.clone()),
            agent_id: run.agent_id.clone(),
            workspace_path,
            connector_id: run.connector_id.clone(),
            model: run.model.clone(),
            prompt,
            context_json: serde_json::json!({
                "task_title": task.title,
                "task_description": task.description,
                "source": "native_gpui",
            }),
            budget: RunBudget {
                thinking_level: Some("high".to_string()),
                token_budget: None,
            },
        })
    }
}

fn resolve_runtime_config() -> Result<RuntimeConfig> {
    let command = env::var(RUNTIME_COMMAND_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .ok_or_else(|| {
            anyhow!("set {RUNTIME_COMMAND_ENV} to the Pi Mono sidecar executable path")
        })?;
    let args = match env::var(RUNTIME_ARGS_ENV) {
        Ok(value) if !value.trim().is_empty() => serde_json::from_str::<Vec<String>>(&value)
            .with_context(|| format!("{RUNTIME_ARGS_ENV} must be a JSON string array"))?,
        _ => Vec::new(),
    };
    let working_dir = env::var(RUNTIME_WORKDIR_ENV)
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from);
    Ok(RuntimeConfig {
        command,
        args,
        working_dir,
    })
}

fn parse_runtime_approval_payload(approval: &domain::Approval) -> Result<RuntimeApprovalPayload> {
    let payload_json = approval
        .payload_json
        .as_deref()
        .ok_or_else(|| anyhow!("runtime approval payload is missing"))?;
    let payload = serde_json::from_str::<serde_json::Value>(payload_json)
        .context("failed to decode runtime approval payload")?;
    Ok(RuntimeApprovalPayload {
        run_id: payload
            .get("run_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("runtime approval payload is missing run_id"))?,
        tool_call_id: payload
            .get("tool_call_id")
            .and_then(serde_json::Value::as_str)
            .map(str::to_string)
            .ok_or_else(|| anyhow!("runtime approval payload is missing tool_call_id"))?,
    })
}

fn spawn_runtime_worker(
    config: RuntimeConfig,
    request: RunRequest,
    command_rx: Receiver<RuntimeCommand>,
    update_tx: Sender<RuntimeUpdate>,
) {
    std::thread::spawn(move || {
        if let Err(error) = run_runtime_worker(config, request, command_rx, &update_tx) {
            let _ = update_tx.send(RuntimeUpdate::Failed(error.to_string()));
        }
        let _ = update_tx.send(RuntimeUpdate::Closed);
    });
}

fn run_runtime_worker(
    config: RuntimeConfig,
    request: RunRequest,
    command_rx: Receiver<RuntimeCommand>,
    update_tx: &Sender<RuntimeUpdate>,
) -> Result<()> {
    let run_id = request.run_id.clone();
    let (mut writer, mut events) =
        pi_bridge::PiBridgeClient::spawn_split(config.command, &config.args, config.working_dir)?;
    writer.send(&ClientRequest::Handshake(RuntimeHandshake {
        protocol_version: 1,
        app_name: "AgentCompany-Rust".to_string(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
    }))?;
    update_tx
        .send(RuntimeUpdate::Event(events.read_event()?))
        .context("failed to deliver runtime handshake event")?;
    writer.send(&ClientRequest::StartRun(Box::new(request)))?;

    loop {
        let event = events.read_event()?;
        let pending_tool_call = match &event {
            RuntimeEvent::ToolCall { tool_call_id, .. } => Some(tool_call_id.clone()),
            _ => None,
        };
        let run_finished = matches!(event, RuntimeEvent::RunFinished { .. });
        update_tx
            .send(RuntimeUpdate::Event(event))
            .context("failed to deliver runtime event")?;

        if let Some(expected_tool_call_id) = pending_tool_call {
            loop {
                match command_rx
                    .recv()
                    .context("runtime command channel closed")?
                {
                    RuntimeCommand::ToolApproval {
                        run_id: command_run_id,
                        tool_call_id,
                        approved,
                        note,
                    } if command_run_id == run_id && tool_call_id == expected_tool_call_id => {
                        writer.send(&ClientRequest::ToolApproval(ToolApprovalDecision {
                            run_id: command_run_id,
                            tool_call_id,
                            approved,
                            note,
                        }))?;
                        break;
                    }
                    RuntimeCommand::Steer {
                        run_id: command_run_id,
                        body,
                    } if command_run_id == run_id => {
                        writer.send(&ClientRequest::Steer(SteerRequest {
                            run_id: command_run_id,
                            body,
                        }))?;
                    }
                    RuntimeCommand::FollowUp {
                        run_id: command_run_id,
                        body,
                    } if command_run_id == run_id => {
                        writer.send(&ClientRequest::FollowUp(FollowUpRequest {
                            run_id: command_run_id,
                            body,
                        }))?;
                    }
                    _ => {}
                }
            }
        }

        if run_finished {
            loop {
                match command_rx
                    .recv()
                    .context("runtime command channel closed")?
                {
                    RuntimeCommand::Steer {
                        run_id: command_run_id,
                        body,
                    } if command_run_id == run_id => {
                        writer.send(&ClientRequest::Steer(SteerRequest {
                            run_id: command_run_id,
                            body,
                        }))?;
                        update_tx
                            .send(RuntimeUpdate::Event(events.read_event()?))
                            .context("failed to deliver steer runtime event")?;
                    }
                    RuntimeCommand::FollowUp {
                        run_id: command_run_id,
                        body,
                    } if command_run_id == run_id => {
                        writer.send(&ClientRequest::FollowUp(FollowUpRequest {
                            run_id: command_run_id,
                            body,
                        }))?;
                        update_tx
                            .send(RuntimeUpdate::Event(events.read_event()?))
                            .context("failed to deliver follow-up runtime event")?;
                    }
                    RuntimeCommand::ToolApproval { .. } => {}
                    _ => {}
                }
            }
        }
    }
}
