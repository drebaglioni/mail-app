import React from "react";
import type { InboxDensity, LocalDraft } from "../../shared/types";

interface DraftRowProps {
  draft: LocalDraft;
  previewSnippet?: string;
  isSelected: boolean;
  density: InboxDensity;
  onClick: () => void;
}

// Density-specific style maps (matches EmailRow)
const densityStyles = {
  default: {
    row: "h-[104px] px-10 gap-8 text-base",
    recipientWidth: "w-60",
    badge: "text-[11px] px-0 py-0.5",
    time: "w-20 text-[15px]",
  },
  compact: {
    row: "h-10 px-4 gap-2 text-xs",
    recipientWidth: "w-32",
    badge: "text-[10px] px-1.5 py-0.5",
    time: "w-10 text-[11px]",
  },
} as const;

function formatRelativeDate(timestamp: number): string {
  const now = Date.now();
  const diffMs = now - timestamp;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return "now";
  if (diffMins < 60) return `${diffMins}m`;
  if (diffHours < 24) return `${diffHours}h`;
  if (diffDays < 7) return `${diffDays}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Named HTML entities commonly found in email content and tiptap output
const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  mdash: "\u2014",
  ndash: "\u2013",
  hellip: "\u2026",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201C",
  rdquo: "\u201D",
  bull: "\u2022",
  middot: "\u00B7",
  copy: "\u00A9",
  reg: "\u00AE",
  trade: "\u2122",
  deg: "\u00B0",
  plusmn: "\u00B1",
  times: "\u00D7",
};

// Lightweight regex strip — avoids DOMParser overhead in the hot render path
function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => {
      const cp = parseInt(hex, 16);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    })
    .replace(/&#(\d+);/g, (_, dec) => {
      const cp = Number(dec);
      return cp <= 0x10ffff ? String.fromCodePoint(cp) : "\uFFFD";
    })
    .replace(/&([a-zA-Z]+);/g, (match, name) => NAMED_ENTITIES[name] ?? match)
    .trim();
}

export const DraftRow = React.memo(
  function DraftRow({ draft, previewSnippet, isSelected, density, onClick }: DraftRowProps) {
    const ds = densityStyles[density] ?? densityStyles.default;
    const isCompact = density === "compact";
    const recipients = draft.to.join(", ");
    const snippet = previewSnippet
      ? stripHtmlTags(previewSnippet)
      : draft.bodyText || stripHtmlTags(draft.bodyHtml);
    const time = formatRelativeDate(draft.updatedAt);

    return (
      <button
        onClick={onClick}
        data-edge="draft"
        className={`
        w-full ${ds.row} flex items-center text-left
        exo-list-row exo-message-object group
        ${isSelected ? "exo-list-row-selected exo-text-primary" : "exo-text-primary"}
      `}
      >
        {/* Draft indicator dot area */}
        <div
          className={`${isCompact ? "w-5" : "w-0"} flex-shrink-0 flex items-center justify-center`}
        >
          {isCompact ? (
            <div
              className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-[var(--exo-accent)]" : "bg-orange-400"}`}
            />
          ) : null}
        </div>

        {/* Recipients */}
        <div
          className={`${ds.recipientWidth} truncate ${isCompact ? "font-semibold" : "text-xl leading-6 font-bold"} flex-shrink-0 ${
            isSelected ? "text-[var(--exo-text-primary)]" : "text-[var(--exo-text-secondary)]"
          }`}
        >
          {recipients || "(no recipients)"}
        </div>

        {/* Subject + Snippet */}
        {isCompact ? (
          <>
            <span
              className={`
                ${ds.badge} flex-shrink-0 uppercase font-semibold exo-micro-label
                ${isSelected ? "text-[var(--exo-accent)]" : "text-[var(--exo-accent)]"}
              `}
            >
              Draft
            </span>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <span
                className={`font-semibold truncate ${
                  isSelected ? "text-[var(--exo-text-primary)]" : "text-[var(--exo-text-secondary)]"
                }`}
              >
                {draft.subject || "(no subject)"}
              </span>
              {snippet && (
                <>
                  <span
                    className={`flex-shrink-0 ${isSelected ? "text-[var(--exo-text-muted)]" : "text-[var(--exo-border-strong)]"}`}
                  >
                    —
                  </span>
                  <span
                    className={`truncate ${isSelected ? "text-[var(--exo-text-secondary)]" : "text-[var(--exo-text-muted)]"}`}
                  >
                    {snippet}
                  </span>
                </>
              )}
            </div>
          </>
        ) : (
          <div className="exo-message-plane flex-1 min-w-0 flex flex-col justify-center gap-2">
            <span
              className={`font-bold truncate max-w-full text-2xl leading-8 ${
                isSelected ? "text-[var(--exo-text-primary)]" : "text-[var(--exo-text-secondary)]"
              }`}
            >
              {draft.subject || "(no subject)"}
            </span>
            <span className="flex min-w-0 items-center gap-2 text-base leading-6">
              <span
                className={`
                  ${ds.badge} flex-shrink-0 uppercase font-semibold exo-micro-label
                  ${isSelected ? "text-[var(--exo-accent)]" : "text-[var(--exo-accent)]"}
                `}
              >
                Draft
              </span>
              {snippet && (
                <span
                  className={`truncate ${isSelected ? "text-[var(--exo-text-secondary)]" : "text-[var(--exo-text-muted)]"}`}
                >
                  {snippet}
                </span>
              )}
            </span>
          </div>
        )}

        {/* Time */}
        <span
          className={`${ds.time} text-right flex-shrink-0 tabular-nums exo-micro-label ${
            isSelected ? "text-[var(--exo-text-secondary)]" : "text-[var(--exo-text-muted)]"
          }`}
        >
          {time}
        </span>
      </button>
    );
  },
  (prev, next) =>
    // onClick excluded — its behavior only changes when draft content changes, tracked via updatedAt
    prev.draft.id === next.draft.id &&
    prev.draft.updatedAt === next.draft.updatedAt &&
    prev.previewSnippet === next.previewSnippet &&
    prev.isSelected === next.isSelected &&
    prev.density === next.density,
);
