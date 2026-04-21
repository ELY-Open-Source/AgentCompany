import { useMemo, useState } from "react"
import { CheckCircle, FileText } from "../../ui/icons"
import type { ApprovalRecord, DocumentRecord, WorkProductRecord } from "@shared/types"
import {
  extractApprovalDocumentReferences,
  extractApprovalWorkProductIds,
  inspectApprovalPayload,
  type ApprovalDocumentReference,
} from "@shared/approval-documents"
import { unwrap } from "../../../lib/desktop"
import { useAppStore } from "../../../state/store"
import { ActionButton, Card, Eyebrow, InlineNotice, Input, StatusPill, TextArea } from "../../ui"
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

function ApprovalWorkProductRow({
  product,
  companyId,
}: {
  product: WorkProductRecord
  companyId: string
}) {
  // Mirror DocumentCenter's WorkProductRow: route through openWorkProduct so
  // main can join workspace-relative paths against the correct root. Only
  // rows with a URL or a filesystem externalId are openable — for anything
  // else we fall back to a non-interactive display (still lets the reviewer
  // see what's attached even if it can't be opened right now).
  const canOpen = Boolean(product.url || (product.provider === "filesystem" && product.externalId))
  const subtitle = [
    product.type.replaceAll("_", " "),
    product.provider,
    product.externalId ?? product.url ?? null,
    product.updatedAt.slice(0, 10),
  ]
    .filter((v): v is string => Boolean(v))
    .join(" · ")

  const rowBody = (
    <div className="min-w-0 flex-1 text-left">
      <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
        <FileText size={15} className="text-muted-foreground" />
        <span className="truncate">{product.title}</span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">{subtitle}</div>
    </div>
  )

  return (
    <Card padding="sm">
      <div className="flex items-start justify-between gap-3">
        {canOpen ? (
          <button
            type="button"
            className="min-w-0 flex-1 text-left"
            onClick={() => {
              void window.agentCompany.openWorkProduct({ companyId, id: product.id })
            }}
          >
            {rowBody}
          </button>
        ) : (
          rowBody
        )}
        <StatusPill status={product.status} />
      </div>
    </Card>
  )
}

// Shimmer skeleton for pending attachment resolution. A skeleton reads as
// "content is on its way" — swapping text between "loading" and "missing"
// made both states look like errors. Tailwind's animate-pulse is enough; no
// new deps.
function ApprovalAttachmentSkeleton() {
  return (
    <Card padding="sm" className="bg-muted">
      <div className="animate-pulse space-y-2" aria-hidden="true">
        <div className="h-3 w-1/3 rounded bg-[color:var(--muted-foreground)]/20" />
        <div className="h-2 w-1/2 rounded bg-[color:var(--muted-foreground)]/15" />
      </div>
    </Card>
  )
}

export function ApprovalDocumentsPanel({
  approval,
  documents,
  workProducts,
  companyId,
}: {
  approval: ApprovalRecord
  documents?: DocumentRecord[]
  workProducts?: WorkProductRecord[]
  companyId: string
}) {
  const t = useT()
  const inspection = useMemo(
    () => inspectApprovalPayload(approval.payloadJson),
    [approval.payloadJson],
  )
  const references = useMemo(
    () => extractApprovalDocumentReferences(approval.payloadJson),
    [approval.payloadJson],
  )
  const workProductIds = useMemo(
    () => extractApprovalWorkProductIds(approval.payloadJson),
    [approval.payloadJson],
  )

  // Undefined = parent hasn't delivered the snapshot yet (loading). An empty
  // or populated array = snapshot is authoritative; any id that fails to
  // resolve against it is genuinely missing (record deleted since the
  // approval was filed). The two states render as different shells — a
  // shimmer skeleton for loading, a muted card with a proper title for
  // missing.
  const workProductsLoading = workProducts === undefined
  const documentsLoading = documents === undefined

  const resolvedWorkProducts = useMemo(() => {
    if (!workProducts || workProductIds.length === 0) return []
    const byId = new Map(workProducts.map((wp) => [wp.id, wp] as const))
    return workProductIds
      .map((id) => byId.get(id))
      .filter((wp): wp is WorkProductRecord => wp != null)
  }, [workProducts, workProductIds])

  // A malformed payloadJson survived into persistence (legacy row written
  // before the write-time guard existed, or a direct DB edit). The write
  // boundary now catches this, but the read side must still render a
  // dignified card rather than silently showing nothing — a reviewer who
  // expected attachments would otherwise stare at a blank modal and
  // wonder if the approval was filed correctly.
  if (inspection.kind === "malformed") {
    return (
      <div className="space-y-3">
        <Eyebrow tone="primary">{t("approval.linkedDocuments")}</Eyebrow>
        <Card padding="sm" className="bg-muted">
          <div className="text-[13px] font-medium text-foreground">
            {t("approval.malformedPayloadTitle")}
          </div>
          <div className="mt-2 text-[12px] text-muted-foreground">
            {t("approval.malformedPayloadBody")}
          </div>
          <div className="mt-2 text-[11px] font-mono text-muted-foreground break-all">
            {inspection.reason}
          </div>
        </Card>
      </div>
    )
  }

  if (references.length === 0 && resolvedWorkProducts.length === 0 && workProductIds.length === 0) {
    return null
  }

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

  const unresolvedWorkProductIds = workProductIds.filter(
    (id) => !resolvedWorkProducts.some((wp) => wp.id === id),
  )
  // When documents snapshot is loaded and a reference id is not in it, the
  // document has been deleted. When the snapshot is still loading, every
  // reference is "pending resolution" — render the skeleton shell instead.
  const unresolvedDocumentReferences = documentsLoading
    ? []
    : references.filter((reference) => !fullDocs.some((entry) => entry.document.id === reference.id))
  const loadingDocumentCount = documentsLoading ? references.length : 0
  const loadingWorkProductCount = workProductsLoading ? workProductIds.length : 0

  return (
    <div className="space-y-3">
      <Eyebrow tone="primary">{t("approval.linkedDocuments")}</Eyebrow>
      {resolvedWorkProducts.map((product) => (
        <ApprovalWorkProductRow key={product.id} product={product} companyId={companyId} />
      ))}
      {Array.from({ length: loadingWorkProductCount }).map((_, index) => (
        <ApprovalAttachmentSkeleton key={`wp-skeleton-${index}`} />
      ))}
      {!workProductsLoading
        ? unresolvedWorkProductIds.map((id) => (
            <Card key={id} padding="sm" className="bg-muted">
              <div className="text-[13px] font-medium text-foreground">
                {t("approval.missingWorkProductTitle")}
              </div>
              <div className="mt-1 text-[11px] font-mono text-muted-foreground break-all">{id}</div>
              <div className="mt-2 text-[12px] text-muted-foreground">
                {t("approval.documentMissing")}
              </div>
            </Card>
          ))
        : null}
      {fullDocs.map(({ reference, document }) => (
        <ApprovalDocumentEditor
          key={document.id}
          companyId={companyId}
          document={document}
          fallback={reference}
        />
      ))}
      {Array.from({ length: loadingDocumentCount }).map((_, index) => (
        <ApprovalAttachmentSkeleton key={`doc-skeleton-${index}`} />
      ))}
      {unresolvedDocumentReferences.map((reference) => (
        <Card key={reference.id} padding="sm" className="bg-muted">
          <div className="text-[13px] font-medium text-foreground">
            {reference.title ?? t("approval.missingDocumentTitle")}
          </div>
          <div className="mt-1 text-[11px] font-mono text-muted-foreground break-all">
            {reference.type?.replaceAll("_", " ") ?? "document"} · {reference.id}
          </div>
          <div className="mt-2 text-[12px] text-muted-foreground">
            {t("approval.documentMissing")}
          </div>
        </Card>
      ))}
    </div>
  )
}
