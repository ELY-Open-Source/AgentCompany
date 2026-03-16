import { useEffect, useState } from "react";
import { CheckCircle } from "@phosphor-icons/react";
import type { ConnectorRecord } from "@shared/types";
import { ActionButton, Input, StatusPill, TextArea } from "./ui";

export function ConnectorEditor({ connector, onSaved }: { connector: ConnectorRecord; onSaved: () => Promise<void> }) {
  const [model, setModel] = useState(connector.model ?? "");
  const [envBindingText, setEnvBindingText] = useState(connector.envBindingText);
  const [notes, setNotes] = useState(connector.notes);

  useEffect(() => {
    setModel(connector.model ?? "");
    setEnvBindingText(connector.envBindingText);
    setNotes(connector.notes);
  }, [connector]);

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">Status</div>
          <div className="flex items-center gap-3">
            <StatusPill status={connector.status} />
            <span className="text-[12px] text-[color:var(--muted)]">{connector.version ?? "version unknown"}</span>
          </div>
        </div>
        <div>
          <div className="mb-1.5 text-[12px] font-medium text-[color:var(--muted-strong)]">Capability matrix</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(connector.capabilityMatrix).map(([key, value]) => (
              <div key={key} className={`rounded-[6px] border px-3 py-2 text-[12px] ${value ? "border-[color:var(--accent)] border-opacity-20 bg-[color:var(--accent-soft)] text-[color:var(--accent)]" : "border-[color:var(--line)] bg-[color:var(--panel-soft)] text-[color:var(--muted)]"}`}>
                {key}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div>
        <Input label="Command" value={connector.command} onChange={() => undefined} readOnly />
        <div className="mt-1.5 text-[12px] leading-relaxed text-[color:var(--muted)]">
          AgentCompany pins connector execution to the audited binary for this runtime. Command overrides are not accepted from the renderer.
        </div>
      </div>
      <Input label="Model" value={model} onChange={setModel} placeholder="Leave empty to use connector default" />
      <TextArea label="Secret bindings" value={envBindingText} onChange={setEnvBindingText} rows={4} placeholder={"OPENAI_API_KEY=my-vault-key\nANTHROPIC_API_KEY=my-anthropic-key"} />
      <TextArea label="Operational notes" value={notes} onChange={setNotes} rows={4} />
      <div className="grid gap-3 md:grid-cols-[auto_1fr]">
        <ActionButton
          label="Save connector"
          tone="accent"
          onClick={() => void (async () => {
            await window.agentCompany.saveConnector({
              id: connector.id,
              command: connector.command,
              model: model || null,
              envBindingText,
              notes,
            });
            await onSaved();
          })()}
          icon={CheckCircle}
        />
        <div className="rounded-[10px] border border-[color:var(--line)] bg-[color:var(--panel-soft)] px-4 py-4 text-[12px] leading-relaxed text-[color:var(--muted)]">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-[color:var(--muted)]">Configuration doc</div>
          <pre className="mono whitespace-pre-wrap">{connector.configurationDoc}</pre>
        </div>
      </div>
    </div>
  );
}
