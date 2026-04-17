import { UserCircle } from "../../ui/icons";
import { useT } from "../../../i18n";

interface ComposerSubjectRowProps {
  subject: string;
  onSubjectChange: (value: string) => void;
  showSubjectInput: boolean;
}

export function ComposerSubjectRow({
  subject,
  onSubjectChange,
  showSubjectInput,
}: ComposerSubjectRowProps) {
  const t = useT();
  return (
    <div className="mb-2 flex items-center gap-2">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary">
        <UserCircle size={16} weight="fill" />
      </div>
      <span className="text-[11px] font-medium text-foreground">{t("composer.youBoard")}</span>
      {showSubjectInput ? (
        <input
          type="text"
          value={subject}
          onChange={(e) => onSubjectChange(e.target.value)}
          placeholder={t("composer.subjectOptional")}
          aria-label={t("composer.messageSubject")}
          className="min-w-0 flex-1 rounded-lg border border-border bg-card px-2.5 py-1 text-[11px] text-foreground placeholder:text-muted-foreground"
        />
      ) : null}
    </div>
  );
}
