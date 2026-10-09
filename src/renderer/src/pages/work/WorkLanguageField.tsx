import type { WorkLanguage } from "../../../../shared/domain";
import { Field } from "../../shared/ui";
import { t } from "../../i18n/i18n";
import { WORK_LANGUAGE_NAMES } from "./task-helpers";

/** A task's working language; blank follows the company's, named so the user sees what blank means. */
export function WorkLanguageField({ companyLanguage, defaultValue }: { companyLanguage: WorkLanguage; defaultValue: WorkLanguage | null }) {
  return (
    <Field label={t("Working language")}>
      <select className="input" name="workLanguage" defaultValue={defaultValue ?? ""}>
        <option value="">{t("Company default ({language})", { language: WORK_LANGUAGE_NAMES[companyLanguage] })}</option>
        <option value="en">{WORK_LANGUAGE_NAMES.en}</option>
        <option value="zh">{WORK_LANGUAGE_NAMES.zh}</option>
      </select>
    </Field>
  );
}
