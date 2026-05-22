import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Field } from "../shared/ui";
import { Dialog } from "../shared/Dialog";
import { ChatSidebar } from "./chat/ChatSidebar";
import { ChatConversation } from "./chat/ChatConversation";
import { ChatThreadPanel } from "./chat/ChatThreadPanel";
import {
  collectParticipants,
  filterApprovalsForSpace,
  isRootMessage,
} from "./chat/chat-helpers";
import type { PageProps } from "./types";
import { activeOrgId, requireActiveEmployee } from "./types";

type SpaceType = "company" | "department" | "project" | "direct";
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
  const approvalsAll = useMemo(
    () => snapshot.approvals.filter((a) => a.orgId === orgId && a.state === "pending"),
    [snapshot.approvals, orgId],
  );
  const channels = useMemo(() => spaces.filter((space) => space.spaceType !== "direct"), [spaces]);
  const directs = useMemo(() => spaces.filter((space) => space.spaceType === "direct"), [spaces]);

  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null);
  const [openThreadId, setOpenThreadId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [attachmentFileId, setAttachmentFileId] = useState<string>("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const fallbackSpaceId = channels[0]?.id ?? directs[0]?.id ?? null;
  const activeSpaceId = selectedSpaceId && spaces.some((space) => space.id === selectedSpaceId)
    ? selectedSpaceId
    : fallbackSpaceId;
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
  const selectedThread = threadsInSpace.find((t) => t.id === openThreadId) ?? null;
  const threadMessages = selectedThread
    ? messagesInSpace.filter((m) => m.threadId === selectedThread.id && m.id !== selectedThread.rootMessageId)
    : [];
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

  const sendInThread = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!activeSpace || !selectedThread) return;
    const form = new FormData(event.currentTarget);
    const body = value(form, "message");
    if (!body) return;
    event.currentTarget.reset();
    void actions.run(() => window.agentCompany.sendMessage({
      orgId,
      spaceId: activeSpace.id,
      threadId: selectedThread.id,
      senderType: "employee",
      senderId: employee.id,
      bodyMd: body,
      attachmentFileIds: [],
    }));
  };

  const createSpace = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void actions.run(() => window.agentCompany.createChatSpace({
      orgId,
      spaceType: value(form, "spaceType") as SpaceType,
      name: value(form, "name"),
      topic: value(form, "topic"),
      visibility: value(form, "visibility") as Visibility,
    })).then((result) => { if (result) setCreateOpen(false); });
  };

  const decideApproval = (approvalId: string, state: "approved" | "declined") =>
    void actions.run(() => window.agentCompany.decideApproval({
      orgId,
      approvalId,
      state,
      decidedByEmployeeId: employee.id,
    }));

  return (
    <div className="split-main" style={{ height: "calc(100vh - 44px)", margin: "-28px -32px -40px" }}>
      <ChatSidebar
        channels={channels}
        directs={directs}
        agents={agents}
        messages={messagesAll}
        activeSpaceId={activeSpaceId}
        onSelect={(spaceId) => {
          setSelectedSpaceId(spaceId);
          setOpenThreadId(null);
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
        files={files}
        context={{ employees, agents }}
        attachmentFileId={attachmentFileId}
        onAttachmentChange={setAttachmentFileId}
        onOpenThread={setOpenThreadId}
        onApprove={(approvalId) => decideApproval(approvalId, "approved")}
        onDecline={(approvalId) => decideApproval(approvalId, "declined")}
        onSubmit={sendInChannel}
        composerRef={composerRef}
      />

      {selectedThread && (
        <ChatThreadPanel
          thread={selectedThread}
          rootMessage={messagesInSpace.find((m) => m.id === selectedThread.rootMessageId) ?? null}
          messages={threadMessages}
          attachments={snapshot.chatAttachments}
          files={files}
          context={{ employees, agents }}
          onClose={() => setOpenThreadId(null)}
          onSubmit={sendInThread}
        />
      )}

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
            <option value="department">Department</option>
            <option value="project">Project</option>
            <option value="direct">Direct</option>
          </select>
        </Field>
        <Field label="Visibility">
          <select className="input" name="visibility" defaultValue="workspace">
            <option value="workspace">Workspace</option>
            <option value="restricted">Restricted</option>
          </select>
        </Field>
      </Dialog>
    </div>
  );
}
