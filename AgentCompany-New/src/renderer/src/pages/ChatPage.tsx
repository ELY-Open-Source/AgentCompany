import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Field } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import { ChatSidebar } from "./chat/ChatSidebar";
import { ChatConversation } from "./chat/ChatConversation";
import {
  collectParticipants,
  filterApprovalsForSpace,
  isRootMessage,
} from "./chat/chat-helpers";
import { ROLE_KEY } from "../../../shared/domain";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";

type SpaceType = "company" | "division" | "department" | "project" | "pod" | "ad_hoc" | "direct";
type Visibility = "workspace" | "restricted";

function value(form: FormData, key: string): string {
  return String(form.get(key) ?? "").trim();
}

export function ChatPage({ snapshot, actions }: PageProps) {
  const orgId = activeOrgId(snapshot);
  const employee = requireActiveEmployee(snapshot);
  const spaces = useMemo(() => snapshot.chatSpaces.filter((space) => space.orgId === orgId), [snapshot.chatSpaces, orgId]);
  const employees = useMemo(() => snapshot.employees.filter((item) => item.orgId === orgId), [snapshot.employees, orgId]);
  const agents = useMemo(() => snapshot.agents.filter((item) => item.orgId === orgId), [snapshot.agents, orgId]);
  const files = useMemo(() => snapshot.files.filter((item) => item.orgId === orgId), [snapshot.files, orgId]);
  const messagesAll = useMemo(() => snapshot.chatMessages.filter((m) => m.orgId === orgId), [snapshot.chatMessages, orgId]);
  const threadsAll = useMemo(() => snapshot.chatThreads.filter((t) => t.orgId === orgId), [snapshot.chatThreads, orgId]);
  const messageIds = useMemo(() => new Set(messagesAll.map((message) => message.id)), [messagesAll]);
  const mentionsAll = useMemo(
    () => snapshot.chatMentions.filter((mention) => messageIds.has(mention.messageId)),
    [snapshot.chatMentions, messageIds],
  );
  const slashInvocationsAll = useMemo(
    () => snapshot.chatSlashInvocations.filter((invocation) => messageIds.has(invocation.messageId)),
    [snapshot.chatSlashInvocations, messageIds],
  );
  const boardInterventionsAll = useMemo(
    () => snapshot.boardInterventions.filter((item) => item.orgId === orgId),
    [snapshot.boardInterventions, orgId],
  );
  const approvalsAll = useMemo(
    () => snapshot.approvals.filter((a) => a.orgId === orgId && a.state === "pending"),
    [snapshot.approvals, orgId],
  );
  const channels = useMemo(() => spaces.filter((space) => space.spaceType !== "direct"), [spaces]);
  const directs = useMemo(() => spaces.filter((space) => space.spaceType === "direct"), [spaces]);
  const canBoardIntervene = useMemo(
    () =>
      snapshot.roleGrants.some(
        (grant) =>
          grant.orgId === orgId &&
          grant.principalType === "employee" &&
          grant.principalId === employee.id &&
          (grant.roleKey === ROLE_KEY.APPROVAL_DECIDER || grant.roleKey === ROLE_KEY.ORG_ADMIN),
      ),
    [snapshot.roleGrants, orgId, employee.id],
  );

  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [attachmentFileId, setAttachmentFileId] = useState<string>("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const firstAvailableSpaceId = channels[0]?.id ?? directs[0]?.id ?? null;
  const activeSpaceId = selectedSpaceId && spaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : firstAvailableSpaceId;
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
  const threadsInSpace = useMemo(
    () => (activeSpace ? threadsAll.filter((t) => t.spaceId === activeSpace.id) : []),
    [threadsAll, activeSpace],
  );
  const rootMessages = messagesInSpace.filter((message) => isRootMessage(message, threadsInSpace));
  const participants = useMemo(
    () => collectParticipants(messagesInSpace, employees, agents),
    [messagesInSpace, employees, agents],
  );
  const pendingApprovalsInSpace = filterApprovalsForSpace(approvalsAll, activeSpace);

  const sendInChannel = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace) return;
    const form = new FormData(event.currentTarget);
    const body = value(form, "message");
    if (!body) return;
    event.currentTarget.reset();
    setAttachmentFileId("");
    void actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId: null,
      senderType: "employee",
      senderId: employee.id,
      bodyMd: body,
      attachmentFileIds: attachmentFileId ? [attachmentFileId] : [],
    }));
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
    void window.agentCompany.importFile({ orgId }).then((result) => {
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
        channels={channels}
        directs={directs}
        agents={agents}
        messages={messagesAll}
        presence={snapshot.chatPresence}
        activeSpaceId={activeSpaceId}
        onSelect={(spaceId) => {
          setSelectedSpaceId(spaceId);
        }}
        onCreateSpace={() => setCreateOpen(true)}
      />

      <ChatConversation
        space={activeSpace}
        participants={participants}
        rootMessages={rootMessages}
        messagesInSpace={messagesInSpace}
        threadsInSpace={threadsInSpace}
        pendingApprovals={pendingApprovalsInSpace}
        attachments={snapshot.chatAttachments}
        mentions={mentionsAll}
        slashInvocations={slashInvocationsAll}
        files={files}
        context={{ employees, agents }}
        attachmentFileId={attachmentFileId}
        currentEmployeeId={employee.id}
        onAttachmentChange={setAttachmentFileId}
        onAttach={attachFile}
        onOpenThread={() => {}}
        onApprove={(approvalId) => decideApproval(approvalId, "approved")}
        onDecline={(approvalId) => decideApproval(approvalId, "declined")}
        onEditMessage={editChatMessage}
        onDeleteMessage={deleteChatMessage}
        onOpenFile={openFile}
        onSubmit={sendInChannel}
        composerRef={composerRef}
      />

      <Dialog
        title="New space"
        open={createOpen}
        submitLabel="Create"
        onClose={() => setCreateOpen(false)}
        onSubmit={createSpace}
      >
        <Field label="Name"><input className="input" name="name" required /></Field>
        <Field label="Topic"><input className="input" name="topic" required /></Field>
        <Field label="Type">
          <select className="input" name="spaceType" defaultValue="project">
            <option value="company">Company</option>
            <option value="division">Division</option>
            <option value="department">Department</option>
            <option value="project">Project</option>
            <option value="pod">Pod</option>
            <option value="ad_hoc">Ad-hoc</option>
            <option value="direct">Direct</option>
          </select>
        </Field>
        <Field label="Visibility">
          <select className="input" name="visibility" defaultValue="workspace">
            <option value="workspace">Workspace</option>
            <option value="restricted">Restricted</option>
          </select>
        </Field>
        <Field label="Employees">
          <select className="input" name="memberEmployeeIds" multiple size={Math.max(1, Math.min(4, employees.length))}>
            {employees.filter((item) => item.id !== employee.id).map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
        </Field>
        <Field label="Agents">
          <select className="input" name="memberAgentIds" multiple size={Math.max(1, Math.min(4, agents.length))}>
            {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}
          </select>
        </Field>
      </Dialog>
    </div>
  );
}
