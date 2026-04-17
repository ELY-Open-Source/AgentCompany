import { useMemo, useState } from "react"
import { CaretDown, CaretUp } from "@phosphor-icons/react"
import type { AgentRecord, ApprovalRecord, DocumentRecord } from "@shared/types"
import { useApprovalPayload } from "./useApprovalPayload"

interface DocRef {
  id: string
  type: string
  title: string
}

function toDocRefs(value: unknown): DocRef[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (entry): entry is DocRef =>
      !!entry && typeof entry === "object" &&
      typeof (entry as DocRef).id === "string" &&
      typeof (entry as DocRef).type === "string" &&
      typeof (entry as DocRef).title === "string",
  )
}

function toDocIds(value: unknown, fallback: DocRef[]): string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string")
  }
  return fallback.map((d) => d.id)
}

export function DeliverableReviewPanel({
  approval,
  documents,
  agents,
}: {
  approval: ApprovalRecord
  documents?: DocumentRecord[]
  agents: AgentRecord[]
}) {
  const payload = useApprovalPayload(approval)
  const docRefs = useMemo(() => toDocRefs(payload?.documents), [payload])
  const docIds = useMemo(() => toDocIds(payload?.documentIds, docRefs), [payload, docRefs])
  const fullDocs = useMemo(() => {
    if (!documents) return [] as DocumentRecord[]
    return docIds
      .map((id) => documents.find((d) => d.id === id))
      .filter((entry): entry is DocumentRecord => entry != null)
  }, [documents, docIds])

  const [expandedDocId, setExpandedDocId] = useState<string | null>(
    fullDocs.length === 1 ? fullDocs[0]!.id : null,
  )

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">Deliverable Review</div>
      {fullDocs.length > 0 ? (
        fullDocs.map((doc) => {
          const isExpanded = expandedDocId === doc.id
          const author = doc.authorAgentId ? agents.find((a) => a.id === doc.authorAgentId) : null
          return (
            <div key={doc.id} className="rounded-lg border border-border overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedDocId(isExpanded ? null : doc.id)}
                className="flex w-full cursor-pointer items-center gap-3 bg-muted px-4 py-3 text-left transition hover:bg-card"
              >
                <span className="shrink-0 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
                  {doc.type.replaceAll("_", " ")}
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-foreground">{doc.title}</span>
                {isExpanded ? (
                  <CaretUp size={14} className="shrink-0 text-muted-foreground" />
                ) : (
                  <CaretDown size={14} className="shrink-0 text-muted-foreground" />
                )}
              </button>
              {isExpanded ? (
                <div className="border-t border-border px-4 py-3">
                  {author ? (
                    <div className="mb-2 text-[11px] text-muted-foreground">
                      Author: <span className="font-medium text-foreground">{author.name}</span> ({author.role})
                    </div>
                  ) : null}
                  <div className="whitespace-pre-wrap text-[12px] leading-relaxed text-foreground">
                    {doc.content || "No content."}
                  </div>
                </div>
              ) : null}
            </div>
          )
        })
      ) : docRefs.length > 0 ? (
        docRefs.map((doc) => (
          <div
            key={doc.id}
            className="flex items-center gap-2 rounded-lg border border-border bg-muted px-4 py-3 text-[12px]"
          >
            <span className="rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase text-primary">
              {doc.type.replaceAll("_", " ")}
            </span>
            <span className="font-medium text-foreground">{doc.title}</span>
          </div>
        ))
      ) : (
        <div className="text-[12px] text-muted-foreground">{approval.payloadSummary}</div>
      )}
      {approval.impactSummary ? (
        <div className="text-[11px] text-muted-foreground">{approval.impactSummary}</div>
      ) : null}
    </div>
  )
}
