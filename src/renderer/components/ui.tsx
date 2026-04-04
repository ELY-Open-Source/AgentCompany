// Barrel re-export — all consumers of "../components/ui" continue to work unchanged.
export { Badge, SectionButton, Panel, Field, Input, TextArea, Select, ActionButton } from "./ui/primitives";
export { StatusPill, InlineNotice, ConfirmDialog, EmptyState } from "./ui/feedback";
export { Modal, ListFrame, ListRow } from "./ui/layout";
export { useFocusTrap, useReducedMotion, ErrorBoundary } from "./ui/hooks";
