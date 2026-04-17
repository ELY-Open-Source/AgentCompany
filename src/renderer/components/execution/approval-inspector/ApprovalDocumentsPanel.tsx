import { useMemo, useState } from "react"
import { CheckCircle } from "../../ui/icons"
import type { ApprovalRecord, DocumentRecord } from "@shared/types"
import { extractApprovalDocumentReferences, type ApprovalDocumentReference } from "@shared/approval-documents"
import { unwrap } from "../../../lib/desktop"
import { useAppStore } from "../../../state/store"
import { ActionButton, Card, Eyebrow, InlineNotice, Input, TextArea } from "../../ui"
import { useT } from "../../../i18n"
import { describeActionError } from "../execution-utils"

function ApprovalDocumentEditor({
  companyId,
  document,
  fallback,
}: {
  companyId: string
  document: DocumentRecord
  fallback?: ApprovalDocumentReference
}) {
  const t = useT()
  const addToast = useAppStore((s) => s.addToast)
  const [title, setTitle] = useState(document.title)
  const [content, setContent] = useState(document.content ?? "")
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  async function handleSave() {
    if (!title.trim()) {
      setSaveError(t("approval.documentTitleRequired"))
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      unwrap(
        await window.agentCompany.saveDocument({
          id: document.id,
          companyId,
          type: document.type,
          title: title.trim(),
          content,
          authorAgentId: document.authorAgentId ?? null,
          reviewerAgentId: document.reviewerAgentId ?? null,
          projectId: document.projectId ?? null,
          goalId: document.goalId ?? null,
          parentDocId: document.parentDocId ?? null,
          version: document.version,
          status: document.status,
          tagsJson: document.tagsJson,
        }),
      )
      addToast(t("approval.documentSavedToast").replace("{title}", title.trim()), "success")
    } catch (error) {
      setSaveError(describeActionError(error))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card padding="sm" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-medium text-foreground">{fallback?.title ?? document.title}</div>
          <div className="text-[11px] text-muted-foreground">
            {(fallback?.type ?? document.type).replaceAll("_", " ")} · v{document.version} · {document.status}
          </div>
        </div>
        <ActionButton
          label={saving ? t("approval.saving") : t("approval.saveChanges")}
          icon={CheckCircle}
          tone="accent"
          onClick={() => void handleSave()}
          loading={saving}
        />
      </div>
      {saveError ? <InlineNotice message={saveError} /> : null}
      <Input label={t("approval.docTitle")} value={title} onChange={setTitle} placeholder={t("approval.docTitlePlaceholder")} />
      <TextArea label={t("approval.docContent")} value={content} onChange={setContent} rows={12} placeholder={t("approval.docContentPlaceholder")} />
    </Card>
  )
}

export function ApprovalDocumentsPanel({
  approval,
  documents,
  companyId,
}: {
  approval: ApprovalRecord
  documents?: DocumentRecord[]
  companyId: string
}) {
  const t = useT()
  const references = useMemo(
    () => extractApprovalDocumentReferences(approval.payloadJson),
    [approval.payloadJson],
  )

  if (references.length === 0) return null

  const fullDocs = documents
    ? references
        .map((reference) => ({
          reference,
          document: documents.find((entry) => entry.id === reference.id) ?? null,
        }))
        .filter(
          (entry): entry is typeof entry & { document: NonNullable<typeof entry.document> } =>
            entry.document != null,
        )
    : []

  return (
    <div className="space-y-3">
      <Eyebrow tone="primary">{t("approval.linkedDocuments")}</Eyebrow>
      {fullDocs.length > 0
        ? fullDocs.map(({ reference, document }) => (
            <ApprovalDocumentEditor
              key={document.id}
              companyId={companyId}
              document={document}
              fallback={reference}
            />
          ))
        : references.map((reference) => (
            <Card key={reference.id} padding="sm" className="bg-muted">
              <div className="text-[13px] font-medium text-foreground">{reference.title ?? reference.id}</div>
              <div className="text-[11px] text-muted-foreground">
                {reference.type?.replaceAll("_", " ") ?? "document"} · {reference.id}
              </div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                {t("approval.documentNotLoaded")}
              </div>
            </Card>
          ))}
      {approval.impactSummary ? (
        <div className="text-[11px] text-muted-foreground">{approval.impactSummary}</div>
      ) : null}
    </div>
  )
}
