import type { AppLocale } from "./locale";

/**
 * Returns a locale-appropriate system prompt instruction for AI agents.
 * When locale is "zh", the instruction tells the agent to respond entirely in Chinese.
 * For "en" (or any other locale), returns an empty string (no additional instruction needed).
 */
export function getLocalePromptInstruction(locale: AppLocale): string {
  if (locale === "zh") {
    return "重要：你必须全程使用中文进行所有沟通、回复、任务描述、评论和消息。所有输出内容必须是中文。";
  }
  return "";
}
