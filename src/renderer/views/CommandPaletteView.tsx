import { AnimatePresence, motion } from "framer-motion";
import {
  Kanban,
  ListChecks,
  MagnifyingGlass,
  Target,
  TerminalWindow,
  UsersThree,
} from "@phosphor-icons/react";
import type { AgentRecord, GoalRecord, ProjectRecord, RunRecord, SectionId, TaskRecord } from "@shared/types";
import { ListFrame, ListRow, StatusPill } from "../components/ui";

type NavItem = { id: SectionId; label: string; icon: typeof MagnifyingGlass };
type PaletteAction = {
  key: string;
  section: SectionId;
  entityId?: string;
};

interface CommandPaletteViewProps {
  commandPaletteOpen: boolean;
  setCommandPaletteOpen: (value: boolean) => void;
  commandPaletteSearch: string;
  setCommandPaletteSearch: (value: string) => void;
  selectedPaletteIndex: number;
  setSelectedPaletteIndex: (value: number) => void;
  paletteTrapRef: React.RefObject<HTMLDivElement | null>;
  filteredNavItems: NavItem[];
  matchedAgents: AgentRecord[];
  matchedTasks: TaskRecord[];
  matchedRuns: RunRecord[];
  matchedGoals: GoalRecord[];
  matchedProjects: ProjectRecord[];
  hasEntityResults: boolean;
  paletteActions: PaletteAction[];
  paletteActionIndex: Map<string, number>;
  runs: RunRecord[];
  navigateTo: (section: SectionId, entityId?: string) => void;
  panelTransition: { duration: number; ease?: readonly [number, number, number, number] } | { duration: number };
  t: (key: string) => string;
}

interface PaletteResultSectionProps<T extends { id: string }> {
  label: string;
  items: T[];
  keyPrefix: string;
  icon: typeof MagnifyingGlass;
  selectedPaletteIndex: number;
  paletteActionIndex: Map<string, number>;
  onSelect: (item: T) => void;
  renderPrimary: (item: T) => React.ReactNode;
  renderRight: (item: T) => React.ReactNode;
}

function PaletteResultSection<T extends { id: string }>({
  label,
  items,
  keyPrefix,
  icon: Icon,
  selectedPaletteIndex,
  paletteActionIndex,
  onSelect,
  renderPrimary,
  renderRight,
}: PaletteResultSectionProps<T>) {
  if (items.length === 0) return null;
  return (
    <>
      <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{label}</div>
      <ListFrame>
        {items.map((item) => (
          <ListRow
            key={item.id}
            className={`py-3 ${paletteActionIndex.get(`${keyPrefix}:${item.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
            onClick={() => onSelect(item)}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0 flex items-center gap-3 text-foreground">
                <Icon size={16} />
                {renderPrimary(item)}
              </div>
              {renderRight(item)}
            </div>
          </ListRow>
        ))}
      </ListFrame>
    </>
  );
}

export function CommandPaletteView({
  commandPaletteOpen,
  setCommandPaletteOpen,
  commandPaletteSearch,
  setCommandPaletteSearch,
  selectedPaletteIndex,
  setSelectedPaletteIndex,
  paletteTrapRef,
  filteredNavItems,
  matchedAgents,
  matchedTasks,
  matchedRuns,
  matchedGoals,
  matchedProjects,
  hasEntityResults,
  paletteActionIndex,
  navigateTo,
  panelTransition,
  t,
}: CommandPaletteViewProps) {
  const paletteQuery = commandPaletteSearch.trim().toLowerCase();

  const closeAndReset = () => {
    setCommandPaletteOpen(false);
    setCommandPaletteSearch("");
    setSelectedPaletteIndex(0);
  };

  const selectAndClose = (section: SectionId, entityId?: string) => {
    navigateTo(section, entityId);
    closeAndReset();
  };

  return (
    <AnimatePresence>
      {commandPaletteOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/72 px-4 pt-24 backdrop-blur-sm"
          onClick={closeAndReset}
        >
          <motion.div
            ref={paletteTrapRef}
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={panelTransition}
            className="w-full max-w-[560px] rounded-lg border border-border bg-card px-5 py-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-3">
              <MagnifyingGlass size={18} className="text-primary" />
              <input
                type="text"
                aria-label="Search"
                className="flex-1 bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground outline-none"
                placeholder={t("app.search")}
                value={commandPaletteSearch}
                onChange={(e) => setCommandPaletteSearch(e.target.value)}
                autoFocus
              />
              {commandPaletteSearch && (
                <button
                  className="text-[12px] text-muted-foreground hover:text-foreground"
                  onClick={() => setCommandPaletteSearch("")}
                >
                  {t("app.clear")}
                </button>
              )}
            </div>

            {filteredNavItems.length > 0 ? (
              <>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.sections")}</div>
                <ListFrame>
                  {filteredNavItems.map((item) => (
                    <ListRow
                      key={item.id}
                      className={`py-3 ${paletteActionIndex.get(`section:${item.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                      onClick={() => selectAndClose(item.id)}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 text-foreground">
                          <item.icon size={16} />
                          <span className="text-[13px] tracking-[0.005em]">{item.label}</span>
                        </div>
                        <span className="font-mono text-[11px] text-muted-foreground">{item.id}</span>
                      </div>
                    </ListRow>
                  ))}
                </ListFrame>
              </>
            ) : null}

            {hasEntityResults ? (
              <div className="mt-3 space-y-3">
                <PaletteResultSection
                  label={t("entity.agents")}
                  items={matchedAgents}
                  keyPrefix="agent"
                  icon={UsersThree}
                  selectedPaletteIndex={selectedPaletteIndex}
                  paletteActionIndex={paletteActionIndex}
                  onSelect={(agent) => selectAndClose("agents", agent.id)}
                  renderPrimary={(agent) => (
                    <>
                      <span className="text-[13px] tracking-[0.005em]">{agent.name}</span>
                      <span className="text-[11px] text-muted-foreground">{agent.role}</span>
                    </>
                  )}
                  renderRight={(agent) => <StatusPill status={agent.status} />}
                />
                <PaletteResultSection
                  label={t("entity.tasks")}
                  items={matchedTasks}
                  keyPrefix="task"
                  icon={ListChecks}
                  selectedPaletteIndex={selectedPaletteIndex}
                  paletteActionIndex={paletteActionIndex}
                  onSelect={(task) => selectAndClose("tasks", task.id)}
                  renderPrimary={(task) => (
                    <span className="text-[13px] tracking-[0.005em]">{task.title}</span>
                  )}
                  renderRight={(task) => <StatusPill status={task.status} />}
                />
                <PaletteResultSection
                  label={t("entity.runs")}
                  items={matchedRuns}
                  keyPrefix="run"
                  icon={TerminalWindow}
                  selectedPaletteIndex={selectedPaletteIndex}
                  paletteActionIndex={paletteActionIndex}
                  onSelect={(run) => selectAndClose("runs", run.id)}
                  renderPrimary={(run) => (
                    <span className="truncate text-[13px] tracking-[0.005em]">
                      {run.summary || run.id.slice(0, 8)}
                    </span>
                  )}
                  renderRight={(run) => <StatusPill status={run.status} />}
                />
                <PaletteResultSection
                  label={t("entity.goals")}
                  items={matchedGoals}
                  keyPrefix="goal"
                  icon={Target}
                  selectedPaletteIndex={selectedPaletteIndex}
                  paletteActionIndex={paletteActionIndex}
                  onSelect={(goal) => selectAndClose("goals", goal.id)}
                  renderPrimary={(goal) => (
                    <span className="text-[13px] tracking-[0.005em]">{goal.title}</span>
                  )}
                  renderRight={(goal) => <StatusPill status={goal.status} />}
                />
                <PaletteResultSection
                  label={t("entity.projects")}
                  items={matchedProjects}
                  keyPrefix="project"
                  icon={Kanban}
                  selectedPaletteIndex={selectedPaletteIndex}
                  paletteActionIndex={paletteActionIndex}
                  onSelect={(project) => selectAndClose("projects", project.id)}
                  renderPrimary={(project) => (
                    <span className="text-[13px] tracking-[0.005em]">{project.name}</span>
                  )}
                  renderRight={(project) => <StatusPill status={project.status} />}
                />
              </div>
            ) : null}

            {paletteQuery && filteredNavItems.length === 0 && !hasEntityResults ? (
              <div className="py-6 text-center text-[13px] text-muted-foreground">{t("app.noResults")} "{commandPaletteSearch}"</div>
            ) : null}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
