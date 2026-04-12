import { useState, useEffect } from "react";
import type { DashboardEmail } from "../../shared/types";

// Priority options for the override dropdown
const PRIORITY_OPTIONS = [
  { value: "skip", label: "Skip", needsReply: false, priority: null },
  { value: "low", label: "Low", needsReply: true, priority: "low" },
  { value: "medium", label: "Medium", needsReply: true, priority: "medium" },
  { value: "high", label: "High", needsReply: true, priority: "high" },
] as const;

function currentPriorityValue(analysis: { needsReply: boolean; priority?: string }): string {
  if (!analysis.needsReply) return "skip";
  return analysis.priority ?? "medium";
}

/** Interactive analysis section with priority override — designed for sidebar placement. */
export function AnalysisPrioritySection({
  email,
  onAnalysisUpdated,
}: {
  email: DashboardEmail;
  onAnalysisUpdated: (newNeedsReply: boolean, newPriority: string | null) => void;
}) {
  const analysis = email.analysis!;
  const current = currentPriorityValue(analysis);

  const [isEditing, setIsEditing] = useState(false);
  const [selectedValue, setSelectedValue] = useState(current);
  const [reason, setReason] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Reset state when email changes
  useEffect(() => {
    setIsEditing(false);
    setSelectedValue(currentPriorityValue(analysis));
    setReason("");
  }, [email.id]);

  const handleSave = async () => {
    const option = PRIORITY_OPTIONS.find((o) => o.value === selectedValue);
    if (!option || selectedValue === current) {
      setIsEditing(false);
      return;
    }

    setIsSaving(true);
    try {
      await window.api.analysis.overridePriority(
        email.id,
        option.needsReply,
        option.priority,
        reason.trim() || undefined,
      );
      onAnalysisUpdated(option.needsReply, option.priority);
      setIsEditing(false);
      setReason("");
    } catch (err) {
      console.error("Failed to override priority:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (!isEditing) {
    return (
      <div className="px-4 py-3 border-b exo-border-subtle">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium exo-text-muted mb-1">Analysis</p>
            <p className="text-sm exo-text-secondary">
              {analysis.needsReply ? "Needs reply" : "No reply needed"}
              {analysis.priority && (
                <span className="exo-text-muted"> · {analysis.priority}</span>
              )}
            </p>
            {analysis.reason && (
              <p className="text-xs exo-text-muted mt-1 line-clamp-2">
                {analysis.reason}
              </p>
            )}
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs exo-text-muted hover:text-[var(--exo-accent)] transition-colors flex-shrink-0 mt-0.5"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b exo-border-subtle">
      <p className="text-xs font-medium exo-text-muted mb-2">Analysis</p>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelectedValue(opt.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedValue === opt.value
                  ? "bg-[var(--exo-accent-soft)] text-[var(--exo-accent)]"
                  : "bg-[var(--exo-bg-surface-soft)] exo-text-muted hover:bg-[var(--exo-bg-surface-hover)]"
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {selectedValue !== current && (
          <>
            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSave();
                if (e.key === "Escape") {
                  setIsEditing(false);
                  setSelectedValue(current);
                  setReason("");
                }
              }}
              placeholder="Reason (optional) — helps improve future classification"
              className="w-full px-3 py-1.5 text-xs rounded border exo-border-subtle bg-[var(--exo-bg-elevated)] exo-text-secondary placeholder-[var(--exo-text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--exo-focus-ring)]"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setSelectedValue(current);
                  setReason("");
                }}
                className="px-3 py-1 text-xs exo-text-muted hover:text-[var(--exo-text-primary)]"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-3 py-1 text-xs font-medium rounded bg-[var(--exo-accent)] text-white hover:bg-[var(--exo-accent-strong)] disabled:opacity-50"
              >
                {isSaving ? "Saving..." : "Save"}
              </button>
            </div>
          </>
        )}
        {selectedValue === current && (
          <div className="flex justify-end">
            <button
              onClick={() => setIsEditing(false)}
              className="px-3 py-1 text-xs exo-text-muted hover:text-[var(--exo-text-primary)]"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
