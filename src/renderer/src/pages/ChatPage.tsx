import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Field } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import { t } from "../i18n/i18n";
import { ChatSidebar } from "./chat/ChatSidebar";
import { ChatConversation } from "./chat/ChatConversation";
import type { SendState } from "./chat/ChatComposer";
import {
  buildConversations,
  collectParticipants,
  filterApprovalsForSpace,
  messageReaders,
} from "./chat/chat-helpers";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";

type SpaceType = "company" | "division" | "department" | "project" | "pod" | "ad_hoc" | "direct";
type Visibility = "workspace" | "restricted";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

const IDLE_SEND: SendState = { pending: false, error: null };

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
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [attachmentFileId, setAttachmentFileId] = useState<string>("");
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
  const latestActiveMessageId = useMemo(() => {
    if (!activeSpaceId) return null;
    const inSpace = messagesAll.filter((message) => message.spaceId === activeSpaceId);
    if (inSpace.length === 0) return null;
    return inSpace[inSpace.length - 1].id;
  }, [messagesAll, activeSpaceId]);

  useEffect(() => {
    if (!activeSpaceId || !latestActiveMessageId) return;
    void actions.run(() => window.agentCompany.markChatSpaceRead({
      orgId,
      employeeId: employee.id,
      spaceId: activeSpaceId,
    }));
  }, [activeSpaceId, latestActiveMessageId, orgId, employee.id, actions]);

  const messagesInSpace = useMemo(
    () => (activeSpace ? messagesAll.filter((m) => m.spaceId === activeSpace.id) : []),
    [messagesAll, activeSpace],
  );
  const participants = useMemo(
    () => collectParticipants(messagesInSpace, employees, agents),
    [messagesInSpace, employees, agents],
  );
  const pendingApprovalsInSpace = filterApprovalsForSpace(approvalsAll, activeSpace);

  const sendInChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace || sends[activeSpace.id]?.pending) return;
    const spaceId = activeSpace.id;
    const sentAttachment = attachmentFileId;
    const formElement = event.currentTarget;
    const body = value(new FormData(formElement), "message");
    if (!body) return;
    setSends((current) => ({ ...current, [spaceId]: { pending: true, error: null } }));
    // The draft and attachment stay until the message is saved, so a refused send loses nothing.
    actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId,
      threadId: null,
      senderType: "employee",
      senderId: employee.id,
      bodyMd: body,
      attachmentFileIds: sentAttachment ? [sentAttachment] : [],
    })).then(() => {
      formElement.reset();
      setAttachmentFileId((current) => (current === sentAttachment ? "" : current));
      setSends((current) => ({ ...current, [spaceId]: { pending: false, error: null } }));
    }).catch((error: unknown) => {
      const reason = error instanceof Error ? error.message : String(error);
      console.error(`[chat] send failed: ${reason}`);
      setSends((current) => ({ ...current, [spaceId]: { pending: false, error: reason } }));
    });
  };

  const createSpace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const existingSpaceIds = new Set(spaces.map((space) => space.id));
    void actions.run(() => window.agentCompany.createChatSpace({
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

  const editChatMessage = (messageId: string, bodyMd: string) =>
    void actions.run(() => window.agentCompany.editMessage({
      orgId,
      messageId,
      actorType: "employee",
      actorId: employee.id,
      bodyMd,
    }));

  const deleteChatMessage = (messageId: string) =>
    void actions.run(() => window.agentCompany.deleteMessage({
      orgId,
      messageId,
      actorType: "employee",
      actorId: employee.id,
    }));

  const attachFile = () => {
    importAttachment(setAttachmentFileId);
  };

  const importAttachment = (onSelect: (fileId: string) => void) => {
    void window.agentCompany.importFile({ orgId, ...(activeSpaceId ? { spaceId: activeSpaceId } : {}) }).then((result) => {
      if (!result.ok) throw new Error(result.error.message);
      if (result.data) onSelect(result.data);
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
        onSelect={setSelectedSpaceId}
        onCreateSpace={() => setCreateOpen(true)}
      />

      <ChatConversation
        key={activeSpace?.id ?? "none"}
        space={activeSpace}
        participants={participants}
        messagesInSpace={messagesInSpace}
        pendingApprovals={pendingApprovalsInSpace}
        attachments={snapshot.chatAttachments}
        mentions={mentionsAll}
        slashInvocations={slashInvocationsAll}
        files={files}
        context={{ employees, agents, readersByMessage }}
        attachmentFileId={attachmentFileId}
        currentEmployeeId={employee.id}
        onAttachmentChange={setAttachmentFileId}
        onAttach={attachFile}
        onApprove={(approvalId) => decideApproval(approvalId, "approved")}
        onDecline={(approvalId) => decideApproval(approvalId, "declined")}
        onEditMessage={editChatMessage}
        onDeleteMessage={deleteChatMessage}
        onOpenFile={openFile}
        onSubmit={sendInChannel}
        send={(activeSpaceId ? sends[activeSpaceId] : undefined) ?? IDLE_SEND}
        composerRef={composerRef}
      />

      <Dialog
        title={t("New space")}
        open={createOpen}
        submitLabel={t("Create")}
        onClose={() => setCreateOpen(false)}
        onSubmit={createSpace}
      >
        <Field label={t("Name")}><input className="input" name="name" required /></Field>
        <Field label={t("Topic")}><input className="input" name="topic" required /></Field>
        <Field label={t("Type")}>
          <select className="input" name="spaceType" defaultValue="project">
            <option value="company">{t("Company")}</option>
            <option value="division">{t("Division")}</option>
            <option value="department">{t("Department")}</option>
            <option value="project">{t("Project")}</option>
            <option value="pod">{t("Pod")}</option>
            <option value="ad_hoc">{t("Ad-hoc")}</option>
            <option value="direct">{t("Direct")}</option>
          </select>
        </Field>
        <Field label={t("Visibility")}>
          <select className="input" name="visibility" defaultValue="workspace">
            <option value="workspace">{t("Workspace")}</option>
            <option value="restricted">{t("Restricted")}</option>
          </select>
        </Field>
        <Field label={t("Employees")}>
          <select className="input" name="memberEmployeeIds" multiple size={Math.max(1, Math.min(4, employees.length))}>
            {employees.filter((item) => item.id !== employee.id).map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </Field>
        <Field label={t("Agents")}>
          <select className="input" name="memberAgentIds" multiple size={Math.max(1, Math.min(4, agents.length))}>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}
