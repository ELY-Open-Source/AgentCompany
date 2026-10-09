import { isIdOrNull, usePersistentState } from "../shared/view-state";
import { useLeaveGuard } from "../app/leave-guard";
import { setDrafts, useDrafts } from "./chat/draft-store";
import { useCallback, useMemo, useRef, useState, type FormEvent } from "react";
import { ChatSidebar } from "./chat/ChatSidebar";
import { ChatConversation } from "./chat/ChatConversation";
import { NewSpaceDialog, type SpaceType, type Visibility } from "./chat/NewSpaceDialog";
import type { Draft, SendState } from "./chat/ChatComposer";
import {
  buildConversations,
  spaceMembers,
  filterApprovalsForSpace,
  messageReaders,
} from "./chat/chat-helpers";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";


function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

const IDLE_SEND: SendState = { pending: false, error: null };
const EMPTY_DRAFT: Draft = { body: "", attachmentFileIds: [] };

export function ChatPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const spaces = useMemo(() => snapshot.chatSpaces.filter((space) => space.orgId === orgId), [snapshot.chatSpaces, orgId]);
  const employees = useMemo(() => snapshot.employees.filter((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const files = useMemo(() => snapshot.files.filter((item) => item.orgId === orgId), [snapshot.files, orgId]);
  const messagesAll = useMemo(() => snapshot.chatMessages.filter((m) => m.orgId === orgId), [snapshot.chatMessages, orgId]);
  const readersByMessage = useMemo(
    () => messageReaders(snapshot.taskRuns.filter((run) => run.orgId === orgId), agents, messagesAll),
    [snapshot.taskRuns, orgId, agents, messagesAll],
  );
  const messageIds = useMemo(() => new Set(messagesAll.map((message) => message.id)), [messagesAll]);
  const mentionsAll = useMemo(
    () => snapshot.chatMentions.filter((mention) => messageIds.has(mention.messageId)),
    [snapshot.chatMentions, messageIds],
  );
  const slashInvocationsAll = useMemo(
    () => snapshot.chatSlashInvocations.filter((invocation) => messageIds.has(invocation.messageId)),
    [snapshot.chatSlashInvocations, messageIds],
  );
  const approvalsAll = useMemo(
    () => snapshot.approvals.filter((a) => a.orgId === orgId && a.state === "pending"),
    [snapshot.approvals, orgId],
  );
  // The CEO is the c_suite agent — the same predicate the runtime enforces.
  // Snapshot agents arrive oldest-first, so .find is the founding CEO.
  const ceoAgentId = useMemo(
    () => agents.find((agent) => agent.roleLevel === "c_suite" && agent.lifecycle === "active")?.id ?? null,
    [agents],
  );
  const conversations = useMemo(
    () => buildConversations({
      spaces,
      memberships: snapshot.chatMemberships,
      messages: messagesAll,
      readStates: snapshot.chatReadStates,
      employees,
      agents,
      currentEmployeeId: employee.id,
      ceoAgentId,
    }),
    [spaces, snapshot.chatMemberships, messagesAll, snapshot.chatReadStates, employees, agents, employee.id, ceoAgentId],
  );
  const [selectedSpaceId, setSelectedSpaceId] = usePersistentState<string | null>(`${orgId}:chat.space`, null, isIdOrNull);
  const [createOpen, setCreateOpen] = useState(false);
  const requestLeave = useLeaveGuard();
  // Text and attachment are kept per conversation, outside the page, so switching conversations or pages loses neither.
  const drafts = useDrafts();
  const [attachErrors, setAttachErrors] = useState<Record<string, string | null>>({});
  const updateDraft = useCallback((spaceId: string, change: Partial<Draft>) =>
    setDrafts((current) => ({ ...current, [spaceId]: { ...(current[spaceId] ?? EMPTY_DRAFT), ...change } })), []);
  const saveDraftBody = useCallback((spaceId: string, body: string) => updateDraft(spaceId, { body }), [updateDraft]);
  // Sends are tracked per conversation, so a late answer lands in the conversation that sent it.
  const [sends, setSends] = useState<Record<string, SendState>>({});
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const firstAvailableSpaceId = conversations[0]?.space.id ?? null;
  const activeSpaceId = selectedSpaceId && spaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : firstAvailableSpaceId;
  // Pin the implicit default as soon as one exists (render-time state
  // adjustment): the conversation list re-sorts by recency on every
  // snapshot, and an unpinned default would follow it - yanking the view to
  // whichever space just got a message and marking it read unseen.
  if (!selectedSpaceId && firstAvailableSpaceId) setSelectedSpaceId(firstAvailableSpaceId);
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) ?? null;
  // The conversation reports what the reader actually has in view; only that counts as read.
  const markRead = useCallback((spaceId: string, upToMessageId: string) => {
    void actions.run(() => window.agentCompany.markChatSpaceRead({ orgId, employeeId: employee.id, spaceId, upToMessageId }));
  }, [actions, orgId, employee.id]);

  const messagesInSpace = useMemo(
    () => (activeSpace ? messagesAll.filter((m) => m.spaceId === activeSpace.id) : []),
    [messagesAll, activeSpace],
  );
  const members = useMemo(() => {
    if (!activeSpace) return [];
    const anchor = snapshot.chatSpaceAnchors.find((item) => item.spaceId === activeSpace.id)?.agentId ?? null;
    return spaceMembers(activeSpace, snapshot.chatMemberships, employees, agents, anchor);
  }, [activeSpace, snapshot.chatSpaceAnchors, snapshot.chatMemberships, employees, agents]);
  const pendingApprovalsInSpace = filterApprovalsForSpace(approvalsAll, activeSpace);

  const sendInChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace || sends[activeSpace.id]?.pending) return;
    const spaceId = activeSpace.id;
    const sentAttachments = (drafts[spaceId] ?? EMPTY_DRAFT).attachmentFileIds;
    const body = value(new FormData(event.currentTarget), "message");
    if (!body && sentAttachments.length === 0) return;
    setSends((current) => ({ ...current, [spaceId]: { pending: true, error: null } }));
    // The draft and attachment stay until the message is saved, so a refused send loses nothing.
    actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "employee",
      senderId: employee.id,
      bodyMd: body,
      attachmentFileIds: sentAttachments,
    })).then(() => {
      // Clear this conversation's mounted composer directly; reset() could restore the sent text as its default.
      const node = composerRef.current;
      if (node?.form?.dataset.spaceId === spaceId) node.value = "";
      setDrafts((current) => {
        const kept = (current[spaceId] ?? EMPTY_DRAFT).attachmentFileIds.filter((fileId) => !sentAttachments.includes(fileId));
        return { ...current, [spaceId]: { body: "", attachmentFileIds: kept } };
      });
      setSends((current) => ({ ...current, [spaceId]: { pending: false, error: null } }));
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[chat] send failed: ${reason}`);
      setSends((current) => ({ ...current, [spaceId]: { pending: false, error: reason } }));
    });
  };

  const replyInThread = async (threadId: string, body: string) => {
    if (!activeSpace) throw new Error("Open a conversation before replying.");
    await actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId,
      senderType: "employee",
      senderId: employee.id,
      bodyMd: body,
      attachmentFileIds: [],
    }));
  };

  const createSpace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existingSpaceIds = new Set(spaces.map((space) => space.id));
    return actions.run(() => window.agentCompany.createChatSpace({
      orgId,
      spaceType: value(form, "spaceType") as SpaceType,
      name: value(form, "name"),
      topic: value(form, "topic"),
      visibility: value(form, "visibility") as Visibility,
      memberEmployeeIds: [employee.id, ...form.getAll("memberEmployeeIds").map(String)].filter(Boolean),
      memberAgentIds: form.getAll("memberAgentIds").map(String).filter(Boolean),
    })).then((result) => {
      if (!result) throw new Error("Chat space creation returned no snapshot.");
      const created = result.chatSpaces.find((space) => space.orgId === orgId && !existingSpaceIds.has(space.id));
      if (!created) throw new Error("Created chat space is missing from snapshot.");
      setSelectedSpaceId(created.id);
      setCreateOpen(false);
    });
  };

  const decideApproval = (approvalId: string, state: "approved" | "declined") =>
    void actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId,
      state,
      decidedByEmployeeId: employee.id,
    }));

  const editChatMessage = async (messageId: string, bodyMd: string) => {
    await actions.run(() => window.agentCompany.editMessage({
      orgId,
      messageId,
      actorType: "employee",
      actorId: employee.id,
      bodyMd,
    }));
  };

  const deleteChatMessage = (messageId: string) =>
    void actions.run(() => window.agentCompany.deleteMessage({
      orgId,
      messageId,
      actorType: "employee",
      actorId: employee.id,
    }));

  const attachFile = () => {
    if (!activeSpaceId) return;
    const spaceId = activeSpaceId;
    void window.agentCompany.importFile({ orgId, spaceId }).then((result) => {
      if (!result.ok) {
        setAttachErrors((current) => ({ ...current, [spaceId]: result.error.message }));
        return;
      }
      const { fileIds, failures } = result.data;
      setDrafts((current) => {
        const draft = current[spaceId] ?? EMPTY_DRAFT;
        const added = fileIds.filter((fileId) => !draft.attachmentFileIds.includes(fileId));
        return { ...current, [spaceId]: { ...draft, attachmentFileIds: [...draft.attachmentFileIds, ...added] } };
      });
      const reason = failures.map((failure) => `${failure.name} (${failure.reason})`).join("; ");
      setAttachErrors((current) => ({ ...current, [spaceId]: reason || null }));
    });
  };

  const openFile = (fileId: string) => {
    void window.agentCompany.openFile({ orgId, fileId }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
    });
  };

  return (
    <div className="split-main">
      <ChatSidebar
        conversations={conversations}
        presence={snapshot.chatPresence}
        activeSpaceId={activeSpaceId}
        onSelect={(spaceId) => requestLeave(() => setSelectedSpaceId(spaceId))}
        onCreateSpace={() => setCreateOpen(true)}
      />

      <ChatConversation
        key={activeSpace?.id ?? "none"}
        space={activeSpace}
        members={members}
        messagesInSpace={messagesInSpace}
        threads={snapshot.chatThreads}
        replyStatuses={snapshot.chatReplyStatuses}
        pendingApprovals={pendingApprovalsInSpace}
        attachments={snapshot.chatAttachments}
        mentions={mentionsAll}
        slashInvocations={slashInvocationsAll}
        files={files}
        context={{ employees, agents, readersByMessage }}
        draft={(activeSpaceId ? drafts[activeSpaceId] : undefined) ?? EMPTY_DRAFT}
        attachError={(activeSpaceId ? attachErrors[activeSpaceId] : undefined) ?? null}
        onDraftLeave={saveDraftBody}
        currentEmployeeId={employee.id}
        onAttachmentRemove={(fileId) => {
          if (!activeSpaceId) return;
          const remaining = ((drafts[activeSpaceId] ?? EMPTY_DRAFT).attachmentFileIds).filter((id) => id !== fileId);
          updateDraft(activeSpaceId, { attachmentFileIds: remaining });
        }}
        onAttach={attachFile}
        onApprove={(approvalId) => decideApproval(approvalId, "approved")}
        onDecline={(approvalId) => decideApproval(approvalId, "declined")}
        onEditMessage={editChatMessage}
        onDeleteMessage={deleteChatMessage}
        onOpenFile={openFile}
        onSubmit={sendInChannel}
        onRead={markRead}
        onReplyInThread={replyInThread}
        send={(activeSpaceId ? sends[activeSpaceId] : undefined) ?? IDLE_SEND}
        composerRef={composerRef}
      />

      <NewSpaceDialog
        key={createOpen ? "open" : "closed"}
        open={createOpen}
        employee={employee}
        employees={employees}
        agents={agents}
        onClose={() => setCreateOpen(false)}
        onSubmit={createSpace}
      />
    </div>
  );
}
