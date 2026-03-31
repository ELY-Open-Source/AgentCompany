import type { AppLocale } from "./locale";

/**
 * Returns a locale-appropriate system prompt instruction for AI agents.
 * When locale is "zh", the instruction tells the agent to respond entirely in Chinese.
 * For "en" (or any other locale), returns an empty string (no additional instruction needed).
 */
export function getLocalePromptInstruction(locale: AppLocale): string {
  if (locale === "zh") {
    return [
      "重要语言要求：你必须全程使用中文进行所有沟通。",
      "这包括：任务描述、评论、消息、报告、文档、审批、通知 — 所有输出必须是中文。",
      "即使系统提示和 API 文档是英文的，你的所有回复和创建的内容必须是中文。",
      "不要使用英文回复，除非是代码、变量名、API 端点等技术术语。",
    ].join("\n");
  }
  return "";
}
