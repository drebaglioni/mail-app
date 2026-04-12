import { useState, useRef, useEffect } from "react";
import type { SendAsAlias } from "../../shared/types";

/** Format an alias as "Display Name <email>" or just "email" */
function formatAlias(alias: SendAsAlias): string {
  return alias.displayName ? `${alias.displayName} <${alias.email}>` : alias.email;
}

/** Extract bare email from a potentially formatted "Name <email>" address. */
function extractEmail(addr: string): string {
  const match = addr.match(/<([^>]+)>$/);
  return match ? match[1] : addr;
}

interface FromSelectorProps {
  aliases: SendAsAlias[];
  selected: string | undefined;
  onChange: (formatted: string) => void;
}

/**
 * Custom dropdown for selecting which send-as address to use.
 * Only renders when the account has 2+ aliases.
 * Uses a custom popover instead of native <select> to avoid OS chrome.
 */
export function FromSelector({ aliases, selected, onChange }: FromSelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  if (aliases.length < 2) return null;

  const selectedBare = selected ? extractEmail(selected).toLowerCase() : "";
  const currentAlias =
    aliases.find((a) => a.email.toLowerCase() === selectedBare) ||
    aliases.find((a) => a.isDefault) ||
    aliases[0];

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div
      ref={ref}
      className="relative flex items-center gap-2 py-1.5 border-b border-[var(--exo-border-subtle)]"
    >
      <label className="w-10 text-sm exo-text-muted flex-shrink-0">From</label>
      <div className="flex-1 flex flex-wrap items-center">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="min-w-0 text-left text-sm exo-text-primary truncate cursor-pointer pl-1.5"
        >
          {currentAlias.email}
        </button>
      </div>
      {open && (
        <div className="absolute left-10 top-full mt-1 z-50 min-w-[280px] max-w-[400px] exo-elevated border exo-border-subtle rounded-lg shadow-lg py-1">
          {aliases.map((alias) => (
            <button
              key={alias.email}
              type="button"
              onClick={() => {
                onChange(formatAlias(alias));
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm truncate transition-colors ${
                alias.email.toLowerCase() === currentAlias.email.toLowerCase()
                  ? "bg-[var(--exo-accent-soft)] text-[var(--exo-accent)]"
                  : "exo-text-primary hover:bg-[var(--exo-bg-surface-hover)]"
              }`}
            >
              {alias.displayName ? `${alias.displayName} <${alias.email}>` : alias.email}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
