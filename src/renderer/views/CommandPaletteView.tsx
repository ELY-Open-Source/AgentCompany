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
  runs,
  navigateTo,
  panelTransition,
  t,
}: CommandPaletteViewProps) {
  const paletteQuery = commandPaletteSearch.trim().toLowerCase();

  return (
    <AnimatePresence>
      {commandPaletteOpen ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-start justify-center bg-background/72 px-4 pt-24 backdrop-blur-sm"
          onClick={() => { setCommandPaletteOpen(false); setCommandPaletteSearch(""); }}
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
                      onClick={() => {
                        navigateTo(item.id);
                        setCommandPaletteOpen(false);
                        setCommandPaletteSearch("");
                        setSelectedPaletteIndex(0);
                      }}
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
                {matchedAgents.length > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.agents")}</div>
                    <ListFrame>
                      {matchedAgents.map((agent) => (
                        <ListRow
                          key={agent.id}
                          className={`py-3 ${paletteActionIndex.get(`agent:${agent.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                          onClick={() => {
                            navigateTo("agents", agent.id);
                            setCommandPaletteOpen(false);
                            setCommandPaletteSearch("");
                            setSelectedPaletteIndex(0);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-foreground">
                              <UsersThree size={16} />
                              <span className="text-[13px] tracking-[0.005em]">{agent.name}</span>
                              <span className="text-[11px] text-muted-foreground">{agent.role}</span>
                            </div>
                            <StatusPill status={agent.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </>
                ) : null}

                {matchedTasks.length > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.tasks")}</div>
                    <ListFrame>
                      {matchedTasks.map((task) => (
                        <ListRow
                          key={task.id}
                          className={`py-3 ${paletteActionIndex.get(`task:${task.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                          onClick={() => {
                            navigateTo("tasks", task.id);
                            setCommandPaletteOpen(false);
                            setCommandPaletteSearch("");
                            setSelectedPaletteIndex(0);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-foreground">
                              <ListChecks size={16} />
                              <span className="text-[13px] tracking-[0.005em]">{task.title}</span>
                            </div>
                            <StatusPill status={task.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </>
                ) : null}

                {matchedRuns.length > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.runs")}</div>
                    <ListFrame>
                      {matchedRuns.map((run) => (
                        <ListRow
                          key={run.id}
                          className={`py-3 ${paletteActionIndex.get(`run:${run.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                          onClick={() => {
                            navigateTo("runs", run.id);
                            setCommandPaletteOpen(false);
                            setCommandPaletteSearch("");
                            setSelectedPaletteIndex(0);
                          }}
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-3 text-foreground">
                              <TerminalWindow size={16} />
                              <span className="truncate text-[13px] tracking-[0.005em]">
                                {run.summary || runs.find((entry) => entry.id === run.id)?.id.slice(0, 8) || run.id.slice(0, 8)}
                              </span>
                            </div>
                            <StatusPill status={run.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </>
                ) : null}

                {matchedGoals.length > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.goals")}</div>
                    <ListFrame>
                      {matchedGoals.map((goal) => (
                        <ListRow
                          key={goal.id}
                          className={`py-3 ${paletteActionIndex.get(`goal:${goal.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                          onClick={() => {
                            navigateTo("goals", goal.id);
                            setCommandPaletteOpen(false);
                            setCommandPaletteSearch("");
                            setSelectedPaletteIndex(0);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-foreground">
                              <Target size={16} />
                              <span className="text-[13px] tracking-[0.005em]">{goal.title}</span>
                            </div>
                            <StatusPill status={goal.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </>
                ) : null}

                {matchedProjects.length > 0 ? (
                  <>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("entity.projects")}</div>
                    <ListFrame>
                      {matchedProjects.map((project) => (
                        <ListRow
                          key={project.id}
                          className={`py-3 ${paletteActionIndex.get(`project:${project.id}`) === selectedPaletteIndex ? "bg-muted" : ""}`}
                          onClick={() => {
                            navigateTo("projects", project.id);
                            setCommandPaletteOpen(false);
                            setCommandPaletteSearch("");
                            setSelectedPaletteIndex(0);
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3 text-foreground">
                              <Kanban size={16} />
                              <span className="text-[13px] tracking-[0.005em]">{project.name}</span>
                            </div>
                            <StatusPill status={project.status} />
                          </div>
                        </ListRow>
                      ))}
                    </ListFrame>
                  </>
                ) : null}
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
