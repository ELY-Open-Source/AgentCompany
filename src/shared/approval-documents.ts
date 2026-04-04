export interface ApprovalDocumentReference {
  id: string
  title?: string
  type?: string
}

function parsePayload(payloadJson: string | null): Record<string, unknown> | null {
  if (!payloadJson) return null
  try {
    const parsed = JSON.parse(payloadJson)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null
  } catch {
    return null
  }
}

export function extractApprovalDocumentReferences(payloadJson: string | null): ApprovalDocumentReference[] {
  const payload = parsePayload(payloadJson)
  if (!payload) return []

  const refs = new Map<string, ApprovalDocumentReference>()
  const addRef = (id: unknown, title?: unknown, type?: unknown) => {
    if (typeof id !== "string" || id.length === 0) return
    refs.set(id, {
      id,
      title: typeof title === "string" && title.length > 0 ? title : undefined,
      type: typeof type === "string" && type.length > 0 ? type : undefined,
    })
  }

  addRef(payload.documentId, payload.documentTitle, payload.documentType)

  const documentIds = payload.documentIds
  if (Array.isArray(documentIds)) {
    for (const entry of documentIds) addRef(entry)
  }

  const documents = payload.documents
  if (Array.isArray(documents)) {
    for (const entry of documents) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      addRef(record.id, record.title, record.type)
    }
  }

  return [...refs.values()]
}

export function extractApprovalDocumentIds(payloadJson: string | null): string[] {
  return extractApprovalDocumentReferences(payloadJson).map((entry) => entry.id)
}
