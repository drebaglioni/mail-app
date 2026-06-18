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
  children: React.ReactNode;
}

function Tab({ active, onClick, count, children }: TabProps) {
  return (
    <button
      onClick={onClick}
      className={`
        px-3 py-2 text-sm font-medium whitespace-nowrap
        border-b transition-colors focus:outline-none
        ${
          active
            ? "border-[var(--exo-accent)] text-[var(--exo-accent)] bg-[var(--exo-accent-soft)]"
            : "border-transparent text-[var(--exo-text-muted)] hover:text-[var(--exo-text-primary)] hover:border-[var(--exo-border-strong)] hover:bg-[var(--exo-bg-surface-hover)]"
        }
      `}
    >
      {children}
      {count !== undefined && (
        <span
          className={`ml-1.5 text-xs ${active ? "text-[var(--exo-accent)]" : "exo-text-muted"}`}
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
      className={`
        px-2.5 py-0.5 text-xs font-medium rounded-full transition-colors focus:outline-none
        ${
          active
            ? "bg-[var(--exo-accent-soft)] text-[var(--exo-accent)] border border-[var(--exo-accent)]"
            : "bg-[var(--exo-bg-surface-soft)] text-[var(--exo-text-secondary)] border border-[var(--exo-border-subtle)] hover:bg-[var(--exo-bg-surface-hover)]"
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
  const { threads, peopleThreads, automatedThreads, snoozedCount } = useThreadedEmails();

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

  const counts = useMemo(() => {
    const map = new Map<string | null, number>();

    const inboxCount = threads.filter(isNonExclusive).length;
    map.set(null, inboxCount);

    for (const split of splits) {
      const matchingThreads = threads.filter((t) =>
        threadMatchesSplit(t, split, splitAssignments.get(t.threadId)),
      );
      map.set(split.id, matchingThreads.length);
    }

    return map;
  }, [threads, splits, isNonExclusive, splitAssignments]);

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

  return (
    <div className="flex flex-col border-b exo-border-subtle">
      {/* Primary tabs row */}
      <div className="flex h-10 px-2 overflow-x-auto">
        <Tab
          active={currentSplitId === "__people__"}
          onClick={() => setCurrentSplitId("__people__")}
          count={peopleCount}
        >
          People
        </Tab>
        <Tab
          active={isAutomatedView}
          onClick={() => setCurrentSplitId("__automated__")}
          count={automatedCount}
        >
          Automated
        </Tab>

        {sortedSplits.map(({ split, displayName }) => (
          <Tab
            key={split.id}
            active={currentSplitId === split.id}
            onClick={() => setCurrentSplitId(split.id)}
            count={counts.get(split.id)}
          >
            {split.icon && <span className="mr-1">{split.icon}</span>}
            {displayName}
          </Tab>
        ))}

        {/* Conditional virtual tabs */}
        {snoozedCount > 0 && (
          <Tab
            active={currentSplitId === "__snoozed__"}
            onClick={() => setCurrentSplitId("__snoozed__")}
            count={snoozedCount}
          >
            <span className="inline-flex items-center gap-1">
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

      {/* Subcategory filter chips for Automated tab */}
      {isAutomatedView && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 overflow-x-auto">
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
