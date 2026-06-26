import { memo } from "react";
import type { InboxDensity, SnoozedEmail } from "../../shared/types";
import { type EmailThread } from "../store";
import { formatSnoozeTime } from "./SnoozeMenu";

interface EmailRowProps {
  thread: EmailThread;
  isSelected: boolean;
  isChecked: boolean;
  isMultiSelectActive: boolean;
  density: InboxDensity;
  onClick: (e: React.MouseEvent) => void;
  onCheckboxChange: () => void;
  onKeepToggle?: () => void; // Only provided in Automated tab
  snoozeInfo?: SnoozedEmail;
  returnTime?: number; // Unsnooze return time — shown instead of last message time
}

// Density-specific style maps
const densityStyles = {
  default: {
    row: "h-[104px] px-10 gap-0 text-base",
    senderWidth: "w-60",
    priorityBadge: "text-[11px] px-0 py-0.5",
    time: "w-20 text-[15px]",
    threadBadge: "text-xs w-6 h-6",
    unreadDot: "w-2 h-2",
  },
  compact: {
    row: "h-10 px-4 gap-2 text-xs",
    senderWidth: "w-32",
    priorityBadge: "text-[10px] px-1.5 py-0.5",
    time: "w-10 text-[11px]",
    threadBadge: "text-[10px] w-5 h-5",
    unreadDot: "w-1.5 h-1.5",
  },
} as const;

// Format relative date compactly
function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatSnoozeCountdown(snoozeUntil: number): string {
  const diffMs = snoozeUntil - Date.now();
  if (diffMs <= 0) return "now";
  const diffMins = Math.ceil(diffMs / 60000);
  const diffHours = Math.ceil(diffMs / 3600000);
  const diffDays = Math.ceil(diffMs / 86400000);

  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(snoozeUntil).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Extract sender name from email address
function extractSenderName(from: string): string {
  const match = from.match(/^([^<]+)/);
  return match ? match[1].trim() : from;
}

// Decode HTML entities (Gmail API returns snippets/subjects with entities like &#39;)
function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

// Get the row's status pill. Returns null when no pill should render.
//
// Pills only show in non-priority tabs (the Priority tab is implicitly all
// priority emails, so the pill would just be visual noise there). When the tab
// is mixed (All / custom splits / Drafts / Snoozed / Archive Ready / Other),
// the pill helps the user spot priority emails vs. completed drafts.
function getPriorityLabel(
  thread: EmailThread,
  inPriorityTab: boolean,
): { text: string; className: string } | null {
  if (inPriorityTab) return null;

  if (thread.draft?.status === "created") {
    return {
      text: "Done",
      className: "priority-done",
    };
  }
  if (!thread.analysis) {
    return null; // Unanalyzed - no label
  }
  // Note: the store's categorization uses effectiveUserReplied (with a grace period)
  // while we check userReplied directly. During the ~3 min grace window, the badge
  // may show no badge while the thread still sits in Priority. This is acceptable.
  if (!thread.analysis.needsReply || thread.userReplied) {
    return null; // No badge for threads that don't need a reply
  }
  // Prefer the fork-specific priority hint when present; otherwise fall back
  // to upstream's flat "Priority" badge.
  if (thread.analysis.priority === "high") {
    return { text: "High", className: "priority-high" };
  }
  if (thread.analysis.priority === "low") {
    return { text: "Low", className: "priority-low" };
  }
  return {
    text: "Priority",
    className:
      "bg-[var(--exo-accent-soft)] text-[var(--exo-accent)] dark:bg-[var(--exo-accent-soft)] dark:text-[var(--exo-accent)]",
  };
}

// Memoized so that j/k navigation only re-renders the two rows whose
// isSelected changed, not every row in the list.  The custom comparator
// skips onClick/onCheckboxChange (always new arrow functions from the parent).
export const EmailRow = memo(
  function EmailRow({
    thread,
    isSelected,
    isChecked,
    isMultiSelectActive,
    density,
    onClick,
    onCheckboxChange,
    onKeepToggle,
    snoozeInfo,
    returnTime,
  }: EmailRowProps) {
    const senderName = extractSenderName(thread.displaySender);
    const time = returnTime
      ? formatRelativeDate(new Date(returnTime).toISOString())
      : formatRelativeDate(thread.latestReceivedEmail.date);
    const previewEmail = thread.draft ? thread.latestReceivedEmail : thread.latestEmail;
    const rawSnippet = previewEmail.snippet || "";
    const snippet = decodeHtmlEntities(rawSnippet);
    const priorityLabel = getPriorityLabel(thread, false);
    const priorityKind = priorityLabel?.text.toLowerCase();
    // Fallback to "default" if stored density is unrecognized (e.g. removed "comfortable")
    const ds = densityStyles[density] ?? densityStyles.default;
    const isCompact = density === "compact";

    const isUnread = thread.isUnread;
    const isRecentlyUnsnoozed = returnTime !== undefined;
    // Unsnoozed emails appear bold like unread emails (without marking unread in Gmail)
    const isVisuallyUnread = isUnread || isRecentlyUnsnoozed;

    const showChecked = isChecked || isMultiSelectActive;
    const edgeKind =
      priorityKind || (thread.draft ? "draft" : isVisuallyUnread ? "unread" : undefined);

    return (
      <div
        data-thread-id={thread.threadId}
        data-selected={isSelected ? "true" : undefined}
        data-edge={edgeKind}
        className={`
        w-full ${ds.row} flex items-center text-left exo-list-row exo-message-object group
        ${
          isSelected && !isChecked
            ? "exo-list-row-selected exo-text-primary"
            : isChecked
              ? "exo-list-row-checked exo-text-primary"
              : "exo-text-primary"
        }
      `}
      >
        {/* Checkbox / Unread indicator area */}
        <div
          className={`${isCompact || showChecked ? "w-5" : "w-0"} flex-shrink-0 flex items-center justify-center`}
        >
          {showChecked ? (
            <input
              type="checkbox"
              checked={isChecked}
              onChange={(e) => {
                e.stopPropagation();
                onCheckboxChange();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-3.5 h-3.5 rounded border-[var(--exo-border-strong)] text-[var(--exo-accent)] focus:ring-[var(--exo-focus-ring)] cursor-pointer"
              data-testid="thread-checkbox"
            />
          ) : isCompact ? (
            <div className="w-2 flex items-center justify-center">
              {isRecentlyUnsnoozed ? (
                <div
                  className={`${ds.unreadDot} rounded-full ${isSelected ? "bg-[var(--exo-accent)]" : "bg-fuchsia-500"}`}
                />
              ) : isUnread ? (
                <div className={`${ds.unreadDot} rounded-full bg-[var(--exo-accent)]`} />
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Clickable area for opening the thread */}
        <button
          onClick={onClick}
          className={`flex-1 flex items-center min-w-0 h-full text-left ${isCompact ? "gap-2" : "gap-8"}`}
        >
          {/* Sender name */}
          {isCompact ? (
            <div
              className={`${ds.senderWidth} truncate font-semibold flex-shrink-0 ${
                isSelected && !isChecked
                  ? "text-[var(--exo-text-primary)]"
                  : isVisuallyUnread
                    ? "text-[var(--exo-text-primary)]"
                    : "text-[var(--exo-text-secondary)]"
              }`}
            >
              {senderName}
            </div>
          ) : (
            <div className={`${ds.senderWidth} flex-shrink-0 flex flex-col justify-center gap-1`}>
              <div
                className={`truncate text-xl leading-6 font-bold ${
                  isSelected && !isChecked
                    ? "text-[var(--exo-text-primary)]"
                    : isVisuallyUnread
                      ? "text-[var(--exo-text-primary)]"
                      : "text-[var(--exo-text-secondary)]"
                }`}
              >
                {senderName}
              </div>
              <div className="h-6 flex items-center text-sm leading-5 text-[var(--exo-text-muted)]">
                {thread.hasMultipleEmails ? (
                  <span className="truncate">{thread.emails.length} messages</span>
                ) : (
                  <span aria-hidden="true">&nbsp;</span>
                )}
              </div>
            </div>
          )}

          {/* Priority label */}
          {isCompact && priorityLabel && (
            <span
              className={`
          ${ds.priorityBadge} flex-shrink-0 uppercase font-semibold exo-micro-label
          ${isSelected && !isChecked ? "text-[var(--exo-accent)]" : priorityLabel.className}
        `}
            >
              {priorityLabel.text}
            </span>
          )}

          {/* Subject + Snippet (combined to use available space) */}
          {isCompact ? (
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span
                className={`font-semibold truncate flex-shrink-0 max-w-[85%] ${
                  isSelected && !isChecked
                    ? "text-[var(--exo-text-primary)]"
                    : isVisuallyUnread
                      ? "text-[var(--exo-text-primary)]"
                      : "text-[var(--exo-text-secondary)]"
                }`}
              >
                {decodeHtmlEntities(thread.subject)}
              </span>
              <span
                className={`flex-shrink ${isSelected && !isChecked ? "text-[var(--exo-text-muted)]" : "text-[var(--exo-border-strong)]"}`}
              >
                —
              </span>
              {thread.draft && (
                <span className="flex-shrink-0 exo-micro-label uppercase font-semibold text-[var(--exo-accent)]">
                  Draft
                </span>
              )}
              <span
                className={`truncate min-w-0 ${
                  isSelected && !isChecked
                    ? "text-[var(--exo-text-secondary)]"
                    : "text-[var(--exo-text-secondary)]"
                }`}
              >
                {snippet}
              </span>
            </div>
          ) : (
            <div className="exo-message-plane flex-1 min-w-0 flex flex-col justify-center gap-2">
              <span
                className={`font-bold truncate max-w-full text-2xl leading-8 ${
                  isSelected && !isChecked
                    ? "text-[var(--exo-text-primary)]"
                    : isVisuallyUnread
                      ? "text-[var(--exo-text-primary)]"
                      : "text-[var(--exo-text-secondary)]"
                }`}
              >
                {decodeHtmlEntities(thread.subject)}
              </span>
              <span className="flex min-w-0 items-center gap-2 text-base leading-6">
                {thread.draft && (
                  <span className="flex-shrink-0 exo-micro-label uppercase font-semibold text-[var(--exo-accent)]">
                    <svg
                      className="w-3.5 h-3.5 inline-block mr-1 -mt-px opacity-80"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    Draft
                  </span>
                )}
                <span
                  className={`truncate min-w-0 ${
                    isSelected && !isChecked
                      ? "text-[var(--exo-text-secondary)]"
                      : "text-[var(--exo-text-secondary)]"
                  }`}
                >
                  {snippet}
                </span>
              </span>
            </div>
          )}

          {/* Keep toggle (Automated tab only) */}
          {onKeepToggle && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onKeepToggle();
              }}
              className={`flex-shrink-0 p-0.5 rounded transition-colors focus:outline-none ${
                thread.archiveKept
                  ? isSelected && !isChecked
                    ? "text-[var(--exo-text-primary)]"
                    : "text-amber-500 dark:text-amber-400"
                  : isSelected && !isChecked
                    ? "text-[var(--exo-text-muted)] opacity-0 group-hover:opacity-100"
                    : "text-[var(--exo-border-strong)] opacity-0 group-hover:opacity-100"
              }`}
              title={
                thread.archiveKept
                  ? "Remove Keep (allow bulk archive)"
                  : "Keep (exclude from bulk archive)"
              }
            >
              <svg
                className="w-3.5 h-3.5"
                fill={thread.archiveKept ? "currentColor" : "none"}
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z"
                />
              </svg>
            </button>
          )}

          {/* Snooze indicator */}
          {snoozeInfo && (
            <span
              className={`flex items-center gap-0.5 flex-shrink-0 ${
                isSelected && !isChecked
                  ? "text-[var(--exo-text-secondary)]"
                  : "text-[#9a6308] dark:text-[#e7bd68]"
              }`}
              title={`Snoozed until ${formatSnoozeTime(snoozeInfo.snoozeUntil)}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
            </span>
          )}

          {/* Time */}
          <span
            className={`${ds.time} text-right flex-shrink-0 tabular-nums exo-micro-label ${
              isSelected && !isChecked
                ? "text-[var(--exo-text-secondary)]"
                : snoozeInfo
                  ? "text-[#9a6308] dark:text-[#e7bd68]"
                  : "text-[var(--exo-text-muted)]"
            }`}
          >
            {snoozeInfo ? formatSnoozeCountdown(snoozeInfo.snoozeUntil) : time}
          </span>

          {/* Thread count badge */}
          {thread.hasMultipleEmails && (
            <span
              className={`
          ${ds.threadBadge} rounded-full flex items-center justify-center flex-shrink-0 exo-micro-label
          ${
            isSelected && !isChecked
              ? "bg-[var(--exo-bg-elevated)] text-[var(--exo-text-secondary)]"
              : "bg-transparent text-[var(--exo-text-muted)]"
          }
        `}
            >
              {thread.emails.length}
            </span>
          )}
        </button>
      </div>
    );
  },
  (prev, next) => {
    if (
      prev.isSelected !== next.isSelected ||
      prev.isChecked !== next.isChecked ||
      prev.isMultiSelectActive !== next.isMultiSelectActive ||
      prev.density !== next.density ||
      prev.snoozeInfo !== next.snoozeInfo ||
      prev.returnTime !== next.returnTime
    ) {
      return false;
    }
    if (prev.thread === next.thread) return true;
    // Thread object identity changes on every store mutation that touches
    // `emails` because groupByThread rebuilds the objects. Compare rendered
    // fields directly so unrelated state updates don't re-render every row.
    //
    // KEEP IN SYNC: if EmailRow's JSX reads a new EmailThread field, add it
    // here too — otherwise rows render stale data. `archiveKept` is read by
    // the Keep toggle (fork-specific) so it lives in this list.
    const pt = prev.thread;
    const nt = next.thread;
    return (
      pt.threadId === nt.threadId &&
      pt.isUnread === nt.isUnread &&
      pt.userReplied === nt.userReplied &&
      pt.displaySender === nt.displaySender &&
      pt.subject === nt.subject &&
      pt.latestReceivedDate === nt.latestReceivedDate &&
      pt.hasMultipleEmails === nt.hasMultipleEmails &&
      pt.emails.length === nt.emails.length &&
      pt.latestEmail.id === nt.latestEmail.id &&
      pt.latestEmail.snippet === nt.latestEmail.snippet &&
      pt.latestReceivedEmail.id === nt.latestReceivedEmail.id &&
      pt.latestReceivedEmail.date === nt.latestReceivedEmail.date &&
      pt.analysis === nt.analysis &&
      pt.draft === nt.draft &&
      pt.archiveKept === nt.archiveKept
    );
  },
  // onClick / onCheckboxChange / onKeepToggle intentionally omitted — they are
  // stable in behavior but are new arrow function references on each parent render.
);
