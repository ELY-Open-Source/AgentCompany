// Backward-compatible re-exports from decomposed communication components
export { CommunicationHub } from "./communication/CommunicationHub"
export { ChannelSidebar, FilterBar } from "./communication/ChannelSidebar"
export { MessageList } from "./communication/MessageList"
export { MessageBubble, TaskCommentBubble, AgentAvatar } from "./communication/MessageItem"
export { MessageComposer, TaskDiscussionComposer, ComposeModal, NoChannelComposer } from "./communication/MessageComposer"
export { ChannelHeader } from "./communication/ChannelHeader"
export type { ChannelDescriptor, TaskDiscussionDescriptor, AnyChannel } from "./communication/ChannelHeader"
export type { FilterState } from "./communication/ChannelSidebar"
