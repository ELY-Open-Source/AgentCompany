import { useState } from "react"
import { ShieldCheck } from "@phosphor-icons/react"
import { useT } from "../../i18n"
import { unwrap } from "../../lib/desktop"
import { ActionButton, InlineNotice, Input, TextArea } from "../ui"
import { describeActionError } from "./execution-utils"

export function SecretCreator({ companyId, onSaved }: { companyId: string; onSaved: () => Promise<void> }) {
  const t = useT()
  const [name, setName] = useState(""); const [description, setDescription] = useState(""); const [value, setValue] = useState("")
  const [errors, setErrors] = useState<{ name?: string; value?: string }>({}); const [submitError, setSubmitError] = useState<string | null>(null); const [submitting, setSubmitting] = useState(false)

  function validate(): boolean {
    const next: typeof errors = {}
    if (!name.trim()) next.name = "Secret name is required."
    else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name.trim())) next.name = "Name must be alphanumeric with underscores, starting with a letter or underscore."
    if (!value.trim()) next.value = "Secret value cannot be empty."
    setErrors(next); return Object.keys(next).length === 0
  }

  return (
    <div className="grid gap-4">
      <div><Input label={t("exec.secretNameLabel")} value={name} onChange={(v) => { setName(v); if (errors.name) setErrors((e) => ({ ...e, name: undefined })) }} placeholder="e.g. ANTHROPIC_API_KEY" />{errors.name ? <div className="mt-1 text-[12px] text-[color:var(--danger)]" role="alert">{errors.name}</div> : null}</div>
      <Input label="Description" value={description} onChange={setDescription} placeholder="What this secret is used for" />
      <div><TextArea label="Secret value" value={value} onChange={(v) => { setValue(v); if (errors.value) setErrors((e) => ({ ...e, value: undefined })) }} rows={5} placeholder="Paste the secret value" />{errors.value ? <div className="mt-1 text-[12px] text-[color:var(--danger)]" role="alert">{errors.value}</div> : null}</div>
      {submitError ? <InlineNotice message={submitError} /> : null}
      <ActionButton label={t("exec.storeSecret")} tone="accent" onClick={() => void (async () => { if (!validate()) return; setSubmitError(null); setSubmitting(true); try { unwrap(await window.agentCompany.saveSecret({ companyId, name: name.trim(), description, value })); setName(""); setDescription(""); setValue(""); setErrors({}); await onSaved() } catch (e) { setSubmitError(describeActionError(e)) } finally { setSubmitting(false) } })()} icon={ShieldCheck} loading={submitting} />
      <div className="border-t border-[color:var(--line)] pt-4 text-[12px] leading-relaxed text-[color:var(--muted)]">Connector secret bindings use `ENV_NAME=secret-name` lines. Values stay outside renderer state after submission.</div>
    </div>
  )
}
