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
      <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
        <div className="flex items-start gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Analysis</p>
            <p className="text-sm text-gray-700 dark:text-gray-300">
              {analysis.needsReply ? "Needs reply" : "No reply needed"}
              {analysis.priority && (
                <span className="text-gray-400 dark:text-gray-500"> · {analysis.priority}</span>
              )}
            </p>
            {analysis.reason && (
              <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 line-clamp-2">
                {analysis.reason}
              </p>
            )}
          </div>
          <button
            onClick={() => setIsEditing(true)}
            className="text-xs text-gray-400 hover:text-blue-500 dark:hover:text-blue-400 transition-colors flex-shrink-0 mt-0.5"
          >
            Change
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700/50">
      <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">Analysis</p>
      <div className="flex flex-col gap-2">
        <div className="flex gap-1">
          {PRIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => setSelectedValue(opt.value)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                selectedValue === opt.value
                  ? "bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-600"
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
              className="w-full px-2.5 py-1.5 text-xs rounded border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-400"
              autoFocus
            />
            <div className="flex items-center gap-2 justify-end">
              <button
                onClick={() => {
                  setIsEditing(false);
                  setSelectedValue(current);
                  setReason("");
                }}
                className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-2.5 py-1 text-xs font-medium rounded bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50"
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
              className="px-2.5 py-1 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
