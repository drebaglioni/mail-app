import { useAppStore } from "../store";

type Hint = {
  key: string;
  label: string;
};

const DEFAULT_HINTS: Hint[] = [
  { key: "j/k", label: "navigate" },
  { key: "Enter", label: "open" },
  { key: "r", label: "reply" },
  { key: "e", label: "archive" },
  { key: "u", label: "unread" },
  { key: "x", label: "select" },
  { key: "c", label: "compose" },
  { key: "/", label: "search" },
  { key: "\u2318K", label: "commands" },
];

const BATCH_HINTS: Hint[] = [
  { key: "e", label: "archive" },
  { key: "#", label: "trash" },
  { key: "u", label: "unread" },
  { key: "Cmd+A", label: "select all" },
  { key: "Esc", label: "deselect" },
];

const FULL_VIEW_HINTS: Hint[] = [
  { key: "Esc", label: "back" },
  { key: "j/k", label: "prev/next" },
  { key: "Enter", label: "reply" },
  { key: "R", label: "reply all" },
  { key: "f", label: "forward" },
  { key: "e", label: "archive" },
  { key: "u", label: "unread" },
];

const SEARCH_RESULTS_HINTS: Hint[] = [
  { key: "j/k", label: "navigate" },
  { key: "Enter", label: "open" },
  { key: "e", label: "archive" },
  { key: "r", label: "reply" },
  { key: "Esc", label: "back to inbox" },
];

const COMPOSE_HINTS: Hint[] = [
  { key: "Cmd+Enter", label: "send" },
  { key: "Esc", label: "cancel" },
];

function HintItem({ hint }: { hint: Hint }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <kbd className="px-2 py-0.5 text-xs bg-transparent exo-text-secondary rounded-sm">
        {hint.key}
      </kbd>
      <span className="exo-text-secondary">{hint.label}</span>
    </span>
  );
}

export function KeyboardHints() {
  const {
    viewMode,
    composeState,
    isSearchOpen,
    isCommandPaletteOpen,
    activeSearchQuery,
    selectedThreadIds,
  } = useAppStore();

  // Don't show hints when search or command palette is open
  if (isSearchOpen || isCommandPaletteOpen) {
    return null;
  }

  // Show compose hints when composing
  if (composeState?.isOpen) {
    return (
      <div className="h-10 exo-surface-soft flex items-center justify-center gap-7 text-xs">
        {COMPOSE_HINTS.map((hint) => (
          <HintItem key={hint.key} hint={hint} />
        ))}
      </div>
    );
  }

  // Select hints based on context
  const hints =
    selectedThreadIds.size > 0
      ? BATCH_HINTS
      : activeSearchQuery && viewMode !== "full"
        ? SEARCH_RESULTS_HINTS
        : viewMode === "full"
          ? FULL_VIEW_HINTS
          : DEFAULT_HINTS;

  return (
    <div className="h-10 exo-surface-soft flex items-center justify-center gap-7 text-xs">
      {hints.map((hint) => (
        <HintItem key={hint.key} hint={hint} />
      ))}
    </div>
  );
}
