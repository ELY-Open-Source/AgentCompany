use pi_bridge::{
    FollowUpRequest, RunBudget, RunRequest, RuntimeEvent, RuntimeHandshake, SteerRequest,
    ToolApprovalDecision,
};
use runtime::{RuntimeConfig, RuntimeService};
use std::path::PathBuf;

fn fake_sidecar_script() -> &'static str {
    r#"
while IFS= read -r line; do
  case "$line" in
    *'"kind":"handshake"'*)
      printf '%s\n' '{"kind":"handshake_ack","protocol_version":1,"runtime_version":"pi-mono-test"}'
      ;;
    *'"kind":"start_run"'*)
      printf '%s\n' '{"kind":"message","run_id":"run-1","role":"assistant","body":"Run queued"}'
      printf '%s\n' '{"kind":"tool_call","run_id":"run-1","tool_call_id":"tool-1","tool_name":"write_file","input_json":{"path":"README.md"}}'
      ;;
    *'"kind":"tool_approval"'*)
      printf '%s\n' '{"kind":"tool_result","run_id":"run-1","tool_call_id":"tool-1","output_json":{"status":"approved"}}'
      printf '%s\n' '{"kind":"run_finished","run_id":"run-1","status":"completed","summary":"Run complete","session_id":"session-1","cost_usd":1.25}'
      ;;
    *'"kind":"steer"'*)
      printf '%s\n' '{"kind":"message","run_id":"run-1","role":"system","body":"Steer accepted"}'
      ;;
    *'"kind":"follow_up"'*)
      printf '%s\n' '{"kind":"message","run_id":"run-1","role":"system","body":"Follow-up accepted"}'
      ;;
  esac
done
"#
}

#[test]
fn runtime_service_round_trips_sidecar_contract() {
    let mut service = RuntimeService::connect(RuntimeConfig {
        command: PathBuf::from("/bin/sh"),
        args: vec!["-c".to_string(), fake_sidecar_script().to_string()],
        working_dir: None,
    })
    .expect("connect runtime");

    let handshake = service
        .handshake(RuntimeHandshake {
            protocol_version: 1,
            app_name: "AgentCompany-Rust".to_string(),
            app_version: "0.1.0".to_string(),
        })
        .expect("handshake");
    match handshake {
        RuntimeEvent::HandshakeAck {
            protocol_version,
            runtime_version,
        } => {
            assert_eq!(protocol_version, 1);
            assert_eq!(runtime_version, "pi-mono-test");
        }
        other => panic!("unexpected handshake event: {other:?}"),
    }

    service
        .start_run(RunRequest {
            run_id: "run-1".to_string(),
            session_id: Some("session-1".to_string()),
            company_id: "company-1".to_string(),
            task_id: Some("task-1".to_string()),
            agent_id: "agent-1".to_string(),
            workspace_path: Some("/tmp/agentcompany".to_string()),
            connector_id: "anthropic".to_string(),
            model: Some("claude-sonnet".to_string()),
            prompt: "Draft the weekly status update".to_string(),
            context_json: serde_json::json!({ "thread_id": "thread-1" }),
            budget: RunBudget {
                thinking_level: Some("high".to_string()),
                token_budget: Some(4096),
            },
        })
        .expect("start run");

    let first_event = service.next_event().expect("first event");
    match first_event {
        RuntimeEvent::Message { run_id, role, body } => {
            assert_eq!(run_id, "run-1");
            assert_eq!(role, "assistant");
            assert_eq!(body, "Run queued");
        }
        other => panic!("unexpected first event: {other:?}"),
    }

    let second_event = service.next_event().expect("second event");
    match second_event {
        RuntimeEvent::ToolCall {
            run_id,
            tool_call_id,
            tool_name,
            input_json,
        } => {
            assert_eq!(run_id, "run-1");
            assert_eq!(tool_call_id, "tool-1");
            assert_eq!(tool_name, "write_file");
            assert_eq!(input_json["path"], "README.md");
        }
        other => panic!("unexpected second event: {other:?}"),
    }

    service
        .decide_tool_call(ToolApprovalDecision {
            run_id: "run-1".to_string(),
            tool_call_id: "tool-1".to_string(),
            approved: true,
            note: "Approved from test.".to_string(),
        })
        .expect("tool approval");

    let third_event = service.next_event().expect("third event");
    match third_event {
        RuntimeEvent::ToolResult {
            run_id,
            tool_call_id,
            output_json,
        } => {
            assert_eq!(run_id, "run-1");
            assert_eq!(tool_call_id, "tool-1");
            assert_eq!(output_json["status"], "approved");
        }
        other => panic!("unexpected third event: {other:?}"),
    }

    let fourth_event = service.next_event().expect("fourth event");
    match fourth_event {
        RuntimeEvent::RunFinished {
            run_id,
            status,
            summary,
            session_id,
            cost_usd,
        } => {
            assert_eq!(run_id, "run-1");
            assert_eq!(status, "completed");
            assert_eq!(summary, "Run complete");
            assert_eq!(session_id.as_deref(), Some("session-1"));
            assert_eq!(cost_usd, Some(1.25));
        }
        other => panic!("unexpected fourth event: {other:?}"),
    }

    service
        .steer(SteerRequest {
            run_id: "run-1".to_string(),
            body: "Tighten the summary.".to_string(),
        })
        .expect("steer");
    let steer_event = service.next_event().expect("steer event");
    match steer_event {
        RuntimeEvent::Message { body, .. } => assert_eq!(body, "Steer accepted"),
        other => panic!("unexpected steer event: {other:?}"),
    }

    service
        .follow_up(FollowUpRequest {
            run_id: "run-1".to_string(),
            body: "Add customer risk notes.".to_string(),
        })
        .expect("follow up");
    let follow_up_event = service.next_event().expect("follow up event");
    match follow_up_event {
        RuntimeEvent::Message { body, .. } => assert_eq!(body, "Follow-up accepted"),
        other => panic!("unexpected follow-up event: {other:?}"),
    }
}
