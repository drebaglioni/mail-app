import { useMemo, memo } from "react";
import { useAppStore, useThreadedEmails, type EmailThread } from "../store";
import { threadMatchesSplit as threadMatchesSplitShared } from "../utils/split-conditions";
import type { AutomatedCategory, InboxSplit } from "../../shared/types";

// Thin wrapper around the shared util so the rest of the file can pass
// EmailThread objects directly. Preserves our fork's per-thread split
// assignment override (assignedSplitId).
function threadMatchesSplit(
  thread: EmailThread,
  split: InboxSplit,
  assignedSplitId?: string,
): boolean {
  if (assignedSplitId === split.id) return true;
  return threadMatchesSplitShared(thread.latestEmail, split);
}

interface TabProps {
  active: boolean;
  onClick: () => void;
  count?: number;
  variant?: "masthead" | "switch";
  children: React.ReactNode;
}

function Tab({ active, onClick, count, variant = "switch", children }: TabProps) {
  return (
    <button
      onClick={onClick}
      data-active={active ? "true" : undefined}
      data-variant={variant}
      className={`
        exo-signal-tab whitespace-nowrap
        transition-colors focus:outline-none
        ${
          active
            ? "text-[var(--exo-accent)]"
            : "text-[var(--exo-text-muted)] hover:text-[var(--exo-text-primary)]"
        }
      `}
    >
      {children}
      {count !== undefined && (
        <span
          className={`ml-2 align-baseline ${active ? "text-[var(--exo-accent)]" : "exo-text-muted"}`}
        >
          {count}
        </span>
      )}
    </button>
  );
}

// Subcategory filter chip for the Automated tab
interface ChipProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function Chip({ active, onClick, children }: ChipProps) {
  return (
    <button
      onClick={onClick}
      data-active={active ? "true" : undefined}
      className={`
        exo-signal-chip px-3 py-1 text-xs font-medium transition-colors focus:outline-none
        ${
          active
            ? "pl-5 text-[var(--exo-accent)]"
            : "text-[var(--exo-text-secondary)] hover:text-[var(--exo-text-primary)]"
        }
      `}
    >
      {children}
    </button>
  );
}

const AUTOMATED_CATEGORIES = [
  { id: null, label: "All" },
  { id: "orders", label: "Orders" },
  { id: "travel", label: "Travel" },
  { id: "receipts", label: "Receipts" },
  { id: "newsletters", label: "Newsletters" },
  { id: "notifications", label: "Notifications" },
  { id: "other", label: "Other" },
] as const;

// memo: SplitTabs takes no props, so parent-triggered renders are wasted
// work. EmailList is the parent; under bursts (sync events, prefetch
// progress) it re-renders frequently, and SplitTabs's counts useMemo
// recomputes a regex test per (700 threads × N splits) on each render.
export const SplitTabs = memo(SplitTabsImpl);

function SplitTabsImpl() {
  const allSplits = useAppStore((state) => state.splits);
  const currentAccountId = useAppStore((state) => state.currentAccountId);
  const currentSplitId = useAppStore((state) => state.currentSplitId);
  const setCurrentSplitId = useAppStore((state) => state.setCurrentSplitId);
  const automatedFilter = useAppStore((state) => state.automatedFilter);
  const setAutomatedFilter = useAppStore((state) => state.setAutomatedFilter);
  const recentlyUnsnoozedThreadIds = useAppStore((state) => state.recentlyUnsnoozedThreadIds);
  const splitAssignments = useAppStore((state) => state.splitAssignments);
  const { peopleThreads, automatedThreads, uncategorizedThreads, snoozedCount } =
    useThreadedEmails();

  // Filter splits for current account. In unified mode (currentAccountId
  // === null) include every account's splits — threadMatchesSplit enforces
  // per-account scoping so they don't cross-pollinate.
  const splits = useMemo(
    () =>
      currentAccountId === null
        ? allSplits
        : allSplits.filter((s) => s.accountId === currentAccountId),
    [allSplits, currentAccountId],
  );

  // Shared predicate: threads NOT matching any exclusive split (unless recently unsnoozed)
  const isNonExclusive = useMemo(() => {
    const exclusiveSplits = splits.filter((s) => s.exclusive);
    return (t: EmailThread) =>
      recentlyUnsnoozedThreadIds.has(t.threadId) ||
      !exclusiveSplits.some((s) => threadMatchesSplit(t, s, splitAssignments.get(t.threadId)));
  }, [splits, recentlyUnsnoozedThreadIds, splitAssignments]);

  // Counts for People and Automated tabs (fork-specific).
  const peopleCount = useMemo(
    () => peopleThreads.filter(isNonExclusive).length,
    [peopleThreads, isNonExclusive],
  );
  const automatedCount = useMemo(
    () => automatedThreads.filter(isNonExclusive).length,
    [automatedThreads, isNonExclusive],
  );
  const automatedCategoryCounts = useMemo(() => {
    const counts = new Map<AutomatedCategory, number>();
    for (const thread of automatedThreads.filter(isNonExclusive)) {
      const category = thread.analysis?.automatedCategory;
      if (category) counts.set(category, (counts.get(category) ?? 0) + 1);
    }
    return counts;
  }, [automatedThreads, isNonExclusive]);
  const categorizingCount = useMemo(
    () =>
      automatedThreads.filter(
        (thread) => isNonExclusive(thread) && !thread.analysis?.automatedCategory,
      ).length,
    [automatedThreads, isNonExclusive],
  );
  // Recovery must include every unknown thread, even if it happens to match an
  // exclusive Automated split. Custom splits only consume classified automation.
  const uncategorizedCount = uncategorizedThreads.length;

  // Sort splits by order. In unified mode, two accounts may have splits with
  // the same name (e.g. both have "Newsletter") — disambiguate with a "(2)",
  // "(3)" suffix on subsequent occurrences (sort order is preserved).
  const sortedSplits = useMemo(() => {
    const sorted = [...splits].sort((a, b) => a.order - b.order);
    const seen = new Map<string, number>();
    return sorted.map((s) => {
      const conflictsWithBuiltIn = AUTOMATED_CATEGORIES.some(
        (category) => category.label.toLowerCase() === s.name.toLowerCase(),
      );
      const baseName = conflictsWithBuiltIn ? `${s.name} · Rule` : s.name;
      const n = (seen.get(baseName) ?? 0) + 1;
      seen.set(baseName, n);
      const displayName = n === 1 ? baseName : `${baseName} (${n})`;
      const count = automatedThreads.filter((thread) =>
        threadMatchesSplit(thread, s, splitAssignments.get(thread.threadId)),
      ).length;
      return { split: s, displayName, count };
    });
  }, [splits, automatedThreads, splitAssignments]);

  const isAutomatedView = currentSplitId === "__automated__";
  const isPeopleView = currentSplitId === "__people__";
  const isUncategorizedView = currentSplitId === "__uncategorized__";
  const isSnoozedView = currentSplitId === "__snoozed__";

  const currentMode = isAutomatedView
    ? { id: "__automated__", label: "Automated", count: automatedCount }
    : isUncategorizedView
      ? { id: "__uncategorized__", label: "Uncategorized", count: uncategorizedCount }
      : isSnoozedView
        ? { id: "__snoozed__", label: "Snoozed", count: snoozedCount }
        : { id: "__people__", label: "People", count: peopleCount };

  return (
    <div className="flex flex-col">
      <div className="exo-mode-masthead flex h-28 items-end justify-between px-10 pb-6">
        <button
          type="button"
          data-active="true"
          className="exo-mode-title min-w-0 text-left focus:outline-none"
          onClick={() => setCurrentSplitId(currentMode.id)}
        >
          <span className="truncate">{currentMode.label}</span>
          <span className="exo-mode-count">{currentMode.count}</span>
        </button>

        <div className="exo-hide-scrollbar flex min-w-0 items-center gap-2 overflow-x-auto pb-1">
          {!isPeopleView && (
            <Tab
              active={false}
              variant="switch"
              onClick={() => setCurrentSplitId("__people__")}
              count={peopleCount}
            >
              People
            </Tab>
          )}

          {!isAutomatedView && (
            <Tab
              active={false}
              variant="switch"
              onClick={() => setCurrentSplitId("__automated__")}
              count={automatedCount}
            >
              Automated
            </Tab>
          )}

          {!isUncategorizedView && (
            <Tab
              active={false}
              variant="switch"
              onClick={() => setCurrentSplitId("__uncategorized__")}
              count={uncategorizedCount}
            >
              Uncategorized
            </Tab>
          )}

          {!isSnoozedView && snoozedCount > 0 && (
            <Tab
              active={false}
              variant="switch"
              onClick={() => setCurrentSplitId("__snoozed__")}
              count={snoozedCount}
            >
              <span className="inline-flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                Snoozed
              </span>
            </Tab>
          )}
        </div>
      </div>

      {/* Subcategory filter chips for Automated tab */}
      {isAutomatedView && (
        <div className="exo-hide-scrollbar flex items-center gap-4 px-5 py-2 overflow-x-auto">
          {AUTOMATED_CATEGORIES.map((cat) => (
            <Chip
              key={cat.id ?? "all"}
              active={
                cat.id === null
                  ? automatedFilter.kind === "all"
                  : automatedFilter.kind === "category" && automatedFilter.category === cat.id
              }
              onClick={() =>
                setAutomatedFilter(
                  cat.id === null ? { kind: "all" } : { kind: "category", category: cat.id },
                )
              }
            >
              {cat.label}{" "}
              <span className="exo-text-muted">
                {cat.id === null ? automatedCount : (automatedCategoryCounts.get(cat.id) ?? 0)}
              </span>
            </Chip>
          ))}
          {/* Custom splits as additional filter chips */}
          {sortedSplits.map(({ split, displayName, count }) => (
            <Chip
              key={split.id}
              active={automatedFilter.kind === "split" && automatedFilter.splitId === split.id}
              onClick={() => setAutomatedFilter({ kind: "split", splitId: split.id })}
            >
              {split.icon && <span className="mr-0.5">{split.icon}</span>}
              {displayName} <span className="exo-text-muted">{count}</span>
            </Chip>
          ))}
          {categorizingCount > 0 && (
            <span className="whitespace-nowrap text-xs exo-text-muted">
              Categorizing {categorizingCount}…
            </span>
          )}
        </div>
      )}
    </div>
  );
}
