import type { ResolvedMention } from "./chat-mentions";

export interface ChatMessageStructureInput {
  slash: { command: string; args: string } | null;
  mentions: ResolvedMention[];
  attachmentFileIds: string[];
}

export function buildChatMessageStructure(input: ChatMessageStructureInput): string {
  return JSON.stringify({
    format: "markdown",
    slashInvocation: input.slash ? { command: input.slash.command, args: input.slash.args } : null,
    mentions: input.mentions.map((mention) => ({
      targetType: mention.target.type,
      targetId: mention.target.id,
      offsetStart: mention.offsetStart,
      offsetEnd: mention.offsetEnd,
    })),
    attachmentFileIds: input.attachmentFileIds,
  });
}
