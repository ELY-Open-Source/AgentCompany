export interface ApprovalDocumentReference {
  id: string
  title?: string
  type?: string
}

export type ApprovalPayloadInspection =
  | { kind: "empty" }
  | { kind: "ok"; payload: Record<string, unknown> }
  | { kind: "malformed"; reason: string }

/**
 * Inspect an approval payloadJson and classify it. Unlike the tolerant
 * extractors (which collapse malformed rows to "no attachments"), this
 * returns an explicit "malformed" signal so the inspector can surface a
 * dignified error card instead of rendering as if nothing was attached.
 *
 * The HTTP route + file_approval tool both reject malformed payloads at
 * write time via mergeApprovalAttachments. This detector exists for the
 * read path, where a legacy row with a broken payload could otherwise
 * silently render as empty.
 */
export function inspectApprovalPayload(payloadJson: string | null | undefined): ApprovalPayloadInspection {
  if (payloadJson == null || payloadJson.length === 0) return { kind: "empty" }
  let parsed: unknown
  try {
    parsed = JSON.parse(payloadJson)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return { kind: "malformed", reason: `payloadJson is not valid JSON (${detail})` }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    const actual = Array.isArray(parsed) ? "array" : parsed === null ? "null" : typeof parsed
    return { kind: "malformed", reason: `payloadJson must be a JSON object (got ${actual})` }
  }
  return { kind: "ok", payload: parsed as Record<string, unknown> }
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

/**
 * Extract document references from an approval's persisted payloadJson.
 *
 * Priority order (canonical → legacy), with later sources providing
 * enrichment only for ids introduced by earlier sources:
 *   1. payload.documentIds — canonical schema top-level field (written by
 *      mergeApprovalAttachments). This is the authoritative id set.
 *   2. payload.documentId / documentTitle / documentType — singular legacy
 *      shape; kept for back-compat with old rows.
 *   3. payload.documents[] — legacy rich shape; used to enrich title/type
 *      metadata on ids already present from the canonical list, and to
 *      contribute ids that pre-date the canonical field.
 */
export function extractApprovalDocumentReferences(payloadJson: string | null): ApprovalDocumentReference[] {
  const payload = parsePayload(payloadJson)
  if (!payload) return []

  const refs = new Map<string, ApprovalDocumentReference>()
  const addId = (id: unknown) => {
    if (typeof id !== "string" || id.length === 0) return
    if (!refs.has(id)) refs.set(id, { id })
  }
  const enrich = (id: unknown, title?: unknown, type?: unknown) => {
    if (typeof id !== "string" || id.length === 0) return
    const prior = refs.get(id) ?? { id }
    refs.set(id, {
      id,
      title: prior.title ?? (typeof title === "string" && title.length > 0 ? title : undefined),
      type: prior.type ?? (typeof type === "string" && type.length > 0 ? type : undefined),
    })
  }

  // 1. Canonical top-level list first — establishes the authoritative ids.
  const documentIds = payload.documentIds
  if (Array.isArray(documentIds)) {
    for (const entry of documentIds) addId(entry)
  }

  // 2. Legacy singular shape.
  enrich(payload.documentId, payload.documentTitle, payload.documentType)

  // 3. Legacy rich shape — enriches metadata on canonical ids and adds
  // ids that only ever lived in the legacy form.
  const documents = payload.documents
  if (Array.isArray(documents)) {
    for (const entry of documents) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      enrich(record.id, record.title, record.type)
    }
  }

  return [...refs.values()]
}

export function extractApprovalDocumentIds(payloadJson: string | null): string[] {
  return extractApprovalDocumentReferences(payloadJson).map((entry) => entry.id)
}

/**
 * Mirror of extractApprovalDocumentReferences for work products. Work products
 * are filesystem-backed (or URL-backed) artifacts — the board inspector opens
 * them via the OS default handler rather than editing them inline.
 *
 * Canonical source is payload.workProductIds (schema top-level, folded in by
 * mergeApprovalAttachments). Legacy payload.workProducts[] is still read for
 * back-compat but new callers must not write it.
 */
export function extractApprovalWorkProductIds(payloadJson: string | null): string[] {
  const payload = parsePayload(payloadJson)
  if (!payload) return []
  const out = new Set<string>()
  // Canonical first.
  const workProductIds = payload.workProductIds
  if (Array.isArray(workProductIds)) {
    for (const entry of workProductIds) {
      if (typeof entry === "string" && entry.length > 0) out.add(entry)
    }
  }
  // Legacy rich shape; back-compat only.
  const workProducts = payload.workProducts
  if (Array.isArray(workProducts)) {
    for (const entry of workProducts) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue
      const record = entry as Record<string, unknown>
      if (typeof record.id === "string" && record.id.length > 0) out.add(record.id)
    }
  }
  return [...out]
}
