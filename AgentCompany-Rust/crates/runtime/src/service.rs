use anyhow::Result;
use pi_bridge::{
    ClientRequest, FollowUpRequest, PiBridgeClient, RunRequest, RuntimeEvent, RuntimeHandshake,
    SteerRequest, ToolApprovalDecision,
};
use std::path::PathBuf;

#[derive(Clone, Debug, Default)]
pub struct RuntimeConfig {
    pub command: PathBuf,
    pub args: Vec<String>,
    pub working_dir: Option<PathBuf>,
}

pub struct RuntimeService {
    client: PiBridgeClient,
}

impl RuntimeService {
    pub fn connect(config: RuntimeConfig) -> Result<Self> {
        Ok(Self {
            client: PiBridgeClient::spawn(config.command, &config.args, config.working_dir)?,
        })
    }

    pub fn handshake(&mut self, message: RuntimeHandshake) -> Result<RuntimeEvent> {
        self.client.send(&ClientRequest::Handshake(message))?;
        self.client.read_event()
    }

    pub fn start_run(&mut self, request: RunRequest) -> Result<()> {
        self.client
            .send(&ClientRequest::StartRun(Box::new(request)))
    }

    pub fn decide_tool_call(&mut self, decision: ToolApprovalDecision) -> Result<()> {
        self.client.send(&ClientRequest::ToolApproval(decision))
    }

    pub fn steer(&mut self, request: SteerRequest) -> Result<()> {
        self.client.send(&ClientRequest::Steer(request))
    }

    pub fn follow_up(&mut self, request: FollowUpRequest) -> Result<()> {
        self.client.send(&ClientRequest::FollowUp(request))
    }

    pub fn next_event(&mut self) -> Result<RuntimeEvent> {
        self.client.read_event()
    }
}
