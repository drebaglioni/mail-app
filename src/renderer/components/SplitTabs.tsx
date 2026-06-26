import { useMemo, memo } from "react";
import { useAppStore, useThreadedEmails, type EmailThread } from "../store";
import { threadMatchesSplit as threadMatchesSplitShared } from "../utils/split-conditions";
import type { InboxSplit } from "../../shared/types";

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
  const currentAutomatedCategory = useAppStore((state) => state.currentAutomatedCategory);
  const setCurrentAutomatedCategory = useAppStore((state) => state.setCurrentAutomatedCategory);
  const recentlyUnsnoozedThreadIds = useAppStore((state) => state.recentlyUnsnoozedThreadIds);
  const splitAssignments = useAppStore((state) => state.splitAssignments);
  const { peopleThreads, automatedThreads, snoozedCount } = useThreadedEmails();

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

  // Sort splits by order. In unified mode, two accounts may have splits with
  // the same name (e.g. both have "Newsletter") — disambiguate with a "(2)",
  // "(3)" suffix on subsequent occurrences (sort order is preserved).
  const sortedSplits = useMemo(() => {
    const sorted = [...splits].sort((a, b) => a.order - b.order);
    if (currentAccountId !== null) return sorted.map((s) => ({ split: s, displayName: s.name }));
    const seen = new Map<string, number>();
    return sorted.map((s) => {
      const n = (seen.get(s.name) ?? 0) + 1;
      seen.set(s.name, n);
      return { split: s, displayName: n === 1 ? s.name : `${s.name} (${n})` };
    });
  }, [splits, currentAccountId]);

  const customSplitIds = useMemo(() => new Set(splits.map((s) => s.id)), [splits]);
  const isAutomatedView =
    currentSplitId === "__automated__" || customSplitIds.has(currentSplitId ?? "");
  const isPeopleView = currentSplitId === "__people__";
  const isSnoozedView = currentSplitId === "__snoozed__";

  const currentMode = isAutomatedView
    ? { id: "__automated__", label: "Automated", count: automatedCount }
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
              active={currentAutomatedCategory === cat.id}
              onClick={() => setCurrentAutomatedCategory(cat.id)}
            >
              {cat.label}
            </Chip>
          ))}
          {/* Custom splits as additional filter chips */}
          {sortedSplits.map(({ split, displayName }) => (
            <Chip
              key={split.id}
              active={currentSplitId === split.id}
              onClick={() => setCurrentSplitId(split.id)}
            >
              {split.icon && <span className="mr-0.5">{split.icon}</span>}
              {displayName}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}
