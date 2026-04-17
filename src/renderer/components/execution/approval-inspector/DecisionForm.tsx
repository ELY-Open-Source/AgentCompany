import { CheckCircle, ClockCounterClockwise, Trash, XCircle } from "../../ui/icons"
import { ActionButton, TextArea } from "../../ui"
import { useT } from "../../../i18n"

export type DecisionState = "approved" | "rejected" | "revision_requested"
export type ActingState = DecisionState | "delete" | null

export function DecisionForm({
  isDecided,
  isSocialPost,
  decisionNote,
  acting,
  onDecisionNoteChange,
  onDecide,
  onRequestDelete,
}: {
  isDecided: boolean
  isSocialPost: boolean
  decisionNote: string
  acting: ActingState
  onDecisionNoteChange: (value: string) => void
  onDecide: (state: DecisionState) => void
  onRequestDelete: () => void
}) {
  const t = useT()

  return (
    <>
      {!isDecided ? (
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Decision note
          </label>
          <TextArea
            value={decisionNote}
            onChange={onDecisionNoteChange}
            placeholder="Add a note (optional)"
            rows={3}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {!isDecided ? (
          <>
            <ActionButton
              label={isSocialPost ? "Approve & Post" : t("exec.approve")}
              tone="accent"
              onClick={() => onDecide("approved")}
              icon={CheckCircle}
              loading={acting === "approved"}
            />
            <ActionButton
              label={t("exec.requestRevision")}
              onClick={() => onDecide("revision_requested")}
              icon={ClockCounterClockwise}
              loading={acting === "revision_requested"}
            />
            <ActionButton
              label={t("exec.reject")}
              tone="danger"
              onClick={() => onDecide("rejected")}
              icon={XCircle}
              loading={acting === "rejected"}
            />
          </>
        ) : null}
        {isDecided ? (
          <ActionButton
            label="Delete"
            onClick={onRequestDelete}
            icon={Trash}
            tone="danger"
            loading={acting === "delete"}
          />
        ) : null}
      </div>
    </>
  )
}
