import { CheckCircle, ClockCounterClockwise, Trash, XCircle } from "../../ui/icons"
import { ActionButton, Eyebrow, TextArea } from "../../ui"
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
          <Eyebrow className="mb-1">
            {t("approval.decisionNote")}
          </Eyebrow>
          <TextArea
            value={decisionNote}
            onChange={onDecisionNoteChange}
            placeholder={t("approval.decisionNotePlaceholder")}
            rows={3}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {!isDecided ? (
          <>
            <ActionButton
              label={isSocialPost ? t("approval.approvePost") : t("exec.approve")}
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
            label={t("approval.delete")}
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
