import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useAppStore } from "../store";
import type { IpcResponse, DashboardEmail } from "../../shared/types";
import { trackEvent } from "../services/posthog";

type SearchResult = {
  id: string;
  threadId: string;
  accountId: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
  rank: number;
};

// Result decorated with where it came from, so we can show an "Archive" badge
// for hits that aren't in the local INBOX-only DB.
type DisplayResult = SearchResult & { source: "local" | "remote" };

declare global {
  interface Window {
    api: {
      search: {
        query: (
          query: string,
          options?: { accountId?: string; limit?: number },
        ) => Promise<IpcResponse<SearchResult[]>>;
        suggestions: (query: string, limit?: number) => Promise<IpcResponse<string[]>>;
      };
      emails: {
        search: (
          query: string,
          accountId: string,
          maxResults?: number,
        ) => Promise<IpcResponse<DashboardEmail[]>>;
        searchRemote: (
          query: string,
          accountId: string,
          maxResults?: number,
          pageToken?: string,
        ) => Promise<IpcResponse<{ emails: DashboardEmail[]; nextPageToken?: string }>>;
      };
    };
  }
}

function decodeHtmlEntities(text: string): string {
  const textarea = document.createElement("textarea");
  textarea.innerHTML = text;
  return textarea.value;
}

// Snippets from FTS5's snippet() come as plain text with literal <mark>...</mark>
// markers around matched terms. body_text is HTML-stripped at ingest, so the
// only tags present are the markers we asked FTS5 to insert.
function renderSnippet(snippet: string): React.ReactNode {
  const parts = snippet.split(/(<mark>[^<]*<\/mark>)/g);
  return parts.map((part, i) => {
    const m = part.match(/^<mark>([^<]*)<\/mark>$/);
    if (m) {
      return (
        <mark key={i} className="bg-[var(--exo-accent-soft)] text-inherit rounded-sm px-0.5">
          {decodeHtmlEntities(m[1])}
        </mark>
      );
    }
    return <span key={i}>{decodeHtmlEntities(part)}</span>;
  });
}

function mergeUniqueById(lists: DashboardEmail[][]): DashboardEmail[] {
  const seen = new Map<string, DashboardEmail>();
  for (const list of lists) {
    for (const email of list) {
      if (!seen.has(email.id)) seen.set(email.id, email);
    }
  }
  return Array.from(seen.values());
}

interface SearchBarProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SearchBar({ isOpen, onClose }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [remoteResults, setRemoteResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(-1); // -1 means no selection
  const [hasNavigated, setHasNavigated] = useState(false); // Track if user used arrow keys
  const [isSearching, setIsSearching] = useState(false);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const {
    setSelectedEmailId,
    setSelectedThreadId,
    setSelectedDraftId,
    currentAccountId,
    accounts,
    setActiveSearch,
    setViewMode,
    isOnline,
    setRemoteSearchResults,
    setRemoteSearchError,
  } = useAppStore();

  // Local results take precedence on dedupe (they have FTS5 ranking +
  // <mark> highlighting); remote-only hits append below. Capped at 20 so
  // the dropdown stays bounded.
  const displayResults: DisplayResult[] = useMemo(() => {
    const localIds = new Set(results.map((r) => r.id));
    const local: DisplayResult[] = results.map((r) => ({ ...r, source: "local" }));
    const remoteOnly: DisplayResult[] = remoteResults
      .filter((r) => !localIds.has(r.id))
      .map((r) => ({ ...r, source: "remote" }));
    return [...local, ...remoteOnly].slice(0, 20);
  }, [results, remoteResults]);

  // The "search all mail" affordance is at index === displayResults.length
  const searchAllMailIndex = displayResults.length;

  const openQuickResult = useCallback(
    (result: SearchResult) => {
      setSelectedDraftId(null);
      setSelectedThreadId(result.threadId);
      setSelectedEmailId(result.id);
      setViewMode("full");
      onClose();
    },
    [onClose, setSelectedDraftId, setSelectedEmailId, setSelectedThreadId, setViewMode],
  );

  // Focus input when opened
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // Reset state when closed
  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      setResults([]);
      setRemoteResults([]);
      setSelectedIndex(-1);
      setHasNavigated(false);
    }
  }, [isOpen]);

  // Debounced local FTS5 search (fast path)
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(-1);
      setHasNavigated(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const response = await window.api.search.query(query, {
          accountId: currentAccountId || undefined,
          limit: 20,
        });
        if (response.success) {
          setResults(response.data);
          // Don't auto-select, keep selection at -1 unless user navigates
        }
      } catch (error) {
        console.error("Search failed:", error);
      } finally {
        setIsSearching(false);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [query, currentAccountId]);

  // Debounced Gmail remote search so the dropdown can surface archived /
  // sent / all-mail hits the local INBOX-only DB doesn't have. Longer
  // debounce than local since each call is a Gmail API roundtrip.
  useEffect(() => {
    if (!query.trim() || !currentAccountId || !isOnline) {
      setRemoteResults([]);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearchingRemote(true);
      try {
        const response = await window.api.emails.searchRemote(query, currentAccountId, 20);
        if (cancelled) return;
        if (response.success && response.data) {
          const converted: SearchResult[] = response.data.emails.map((e: DashboardEmail) => ({
            id: e.id,
            threadId: e.threadId,
            accountId: e.accountId ?? currentAccountId,
            subject: e.subject,
            from: e.from,
            to: e.to,
            date: e.date,
            snippet: e.snippet ?? "",
            rank: 0,
          }));
          setRemoteResults(converted);
        }
      } catch (error) {
        // Non-fatal: dropdown still shows local results
        console.error("Remote search failed:", error);
      } finally {
        if (!cancelled) setIsSearchingRemote(false);
      }
    }, 400);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, currentAccountId, isOnline]);

  // Perform full Gmail search and show results (local + remote in parallel).
  // In unified ("all inboxes") mode, currentAccountId is null and we fan out
  // across every connected account, merging results by email id.
  const performFullSearch = useCallback(() => {
    if (!query.trim()) return;

    const targetAccountIds = currentAccountId ? [currentAccountId] : accounts.map((a) => a.id);
    if (targetAccountIds.length === 0) return;

    trackEvent("search_performed");

    // Close modal immediately and show SearchResultsView with loading state.
    // setActiveSearch closes the modal, sets remoteSearchStatus: 'searching'.
    setActiveSearch(query, []);

    // Fire local search across every target account in parallel
    Promise.all(
      targetAccountIds.map((accountId) =>
        window.api.emails
          .search(query, accountId, 500)
          .then((r: IpcResponse<DashboardEmail[]>) => (r.success && r.data ? r.data : []))
          .catch((error: unknown) => {
            console.error("Local search failed:", error);
            return [];
          }),
      ),
    )
      .then((perAccount) => {
        if (useAppStore.getState().activeSearchQuery !== query) return;
        useAppStore.getState().setActiveSearchResults(mergeUniqueById(perAccount));
      })
      .catch((error: unknown) => {
        console.error("Local search result processing failed:", error);
      });

    // Fire remote search (slow) across every target account in parallel.
    // Pagination is per-account, so when fanning out across multiple accounts
    // we don't expose a nextPageToken — users can refine the query for more results.
    if (isOnline) {
      type RemoteOutcome =
        | { ok: true; emails: DashboardEmail[]; next: string | undefined }
        | { ok: false; error: string };
      Promise.all(
        targetAccountIds.map(
          (accountId): Promise<RemoteOutcome> =>
            window.api.emails
              .searchRemote(query, accountId, 500)
              .then(
                (
                  response: IpcResponse<{
                    emails: DashboardEmail[];
                    nextPageToken?: string;
                  }>,
                ): RemoteOutcome => {
                  if (response.success) {
                    return {
                      ok: true,
                      emails: response.data.emails,
                      next: response.data.nextPageToken,
                    };
                  }
                  return { ok: false, error: response.error || "Gmail search failed" };
                },
              )
              .catch(
                (err: unknown): RemoteOutcome => ({
                  ok: false,
                  error: err instanceof Error ? err.message : "Gmail search failed",
                }),
              ),
        ),
      )
        .then((results) => {
          if (useAppStore.getState().activeSearchQuery !== query) return;
          const successes = results.filter((r): r is Extract<RemoteOutcome, { ok: true }> => r.ok);
          if (successes.length === 0) {
            const firstError = results.find(
              (r): r is Extract<RemoteOutcome, { ok: false }> => !r.ok,
            );
            setRemoteSearchError(firstError ? firstError.error : "Gmail search failed");
            return;
          }
          setRemoteSearchResults(mergeUniqueById(successes.map((r) => r.emails)));
          useAppStore
            .getState()
            .setRemoteSearchNextPageToken(
              targetAccountIds.length === 1 ? (successes[0].next ?? null) : null,
            );
        })
        .catch((error: unknown) => {
          if (useAppStore.getState().activeSearchQuery !== query) return;
          setRemoteSearchError(error instanceof Error ? error.message : "Gmail search failed");
        });
    } else {
      setRemoteSearchResults([]);
    }
  }, [
    query,
    currentAccountId,
    accounts,
    isOnline,
    setActiveSearch,
    setRemoteSearchResults,
    setRemoteSearchError,
    onClose,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onClose();
          break;
        case "ArrowDown":
          e.preventDefault();
          setHasNavigated(true);
          // Allow navigating to the "search all mail" row at the end
          setSelectedIndex((i) => Math.min(i + 1, searchAllMailIndex));
          break;
        case "ArrowUp":
          e.preventDefault();
          setHasNavigated(true);
          setSelectedIndex((i) => Math.max(i - 1, i === -1 ? -1 : 0));
          break;
        case "Enter":
          e.preventDefault();
          if (
            hasNavigated &&
            selectedIndex >= 0 &&
            selectedIndex < displayResults.length &&
            displayResults[selectedIndex]
          ) {
            // User explicitly navigated to a result, select it
            // Use displayResults (which includes Gmail remote dropdown hits)
            // so the auto-search Gmail dropdown (#13) wins when the user
            // navigated into it. openQuickResult handles routing + close.
            openQuickResult(displayResults[selectedIndex] as SearchResult);
          } else {
            // Either: no navigation, or selected "search all mail" row, or just pressed Enter
            if (query.trim()) {
              performFullSearch();
            }
          }
          break;
      }
    },
    [
      displayResults,
      selectedIndex,
      hasNavigated,
      searchAllMailIndex,
      query,
      performFullSearch,
      openQuickResult,
    ],
  );

  const handleResultClick = (result: SearchResult) => {
    openQuickResult(result);
  };

  // Format date for display
  const formatDate = (dateStr: string) => {
    try {
      const date = new Date(dateStr);
      const now = new Date();
      const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays === 0) {
        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } else if (diffDays === 1) {
        return "Yesterday";
      } else if (diffDays < 7) {
        return date.toLocaleDateString([], { weekday: "short" });
      } else {
        return date.toLocaleDateString([], { month: "short", day: "numeric" });
      }
    } catch {
      return "";
    }
  };

  // Extract sender name from email
  const getSenderName = (from: string) => {
    const match = from.match(/^([^<]+)/);
    return match ? match[1].trim() : from;
  };

  // Determine footer hint text
  const footerHint =
    hasNavigated && selectedIndex >= 0 && selectedIndex < displayResults.length
      ? "Enter to open"
      : "Enter to search all mail";

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-md" onClick={onClose} />

      {/* Search panel */}
      <div className="relative w-full max-w-3xl exo-elevated rounded-md shadow-2xl dark:shadow-black/60 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-4 px-6 py-5">
          <svg
            className="w-5 h-5 text-[var(--exo-text-muted)] flex-shrink-0"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search emails... (try from:, to:, subject:)"
            className="flex-1 text-xl border-none appearance-none outline-none focus:outline-none focus:ring-0 placeholder-[var(--exo-text-muted)] bg-transparent"
            style={{ outline: "none", border: "none", boxShadow: "none" }}
          />
          {(isSearching || isSearchingRemote) && (
            <svg
              className="w-5 h-5 text-[var(--exo-accent)] animate-spin"
              fill="none"
              viewBox="0 0 24 24"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
          )}
          <kbd className="px-2 py-1 text-xs text-[var(--exo-text-muted)] bg-[var(--exo-bg-surface-soft)] rounded-sm">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[30rem] overflow-y-auto" data-testid="search-modal-results">
          {displayResults.length > 0 ? (
            <div className="py-2">
              {displayResults.map((result, index) => (
                <button
                  key={result.id}
                  onClick={() => handleResultClick(result)}
                  data-search-selected={
                    index === selectedIndex && selectedIndex >= 0 ? "true" : undefined
                  }
                  className={`w-full px-6 py-4 text-left transition-colors ${
                    index === selectedIndex && selectedIndex >= 0
                      ? "exo-list-row-selected"
                      : "hover:bg-[var(--exo-bg-surface-hover)]"
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium exo-text-primary truncate">
                          {getSenderName(result.from)}
                        </span>
                        <span className="text-sm exo-text-muted">{formatDate(result.date)}</span>
                        {result.source === "remote" && (
                          <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-[var(--exo-bg-surface-soft)] exo-text-muted">
                            Archive
                          </span>
                        )}
                      </div>
                      <div className="text-sm exo-text-secondary truncate mt-0.5">
                        {result.subject}
                      </div>
                      {result.snippet && (
                        <div className="text-sm exo-text-muted truncate mt-0.5">
                          {renderSnippet(result.snippet)}
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              ))}
              {/* "Search all mail" affordance row */}
              {query.trim() && (
                <button
                  onClick={performFullSearch}
                  data-search-all-mail="true"
                  data-search-selected={selectedIndex === searchAllMailIndex ? "true" : undefined}
                  className={`w-full px-6 py-4 text-left transition-colors ${
                    selectedIndex === searchAllMailIndex
                      ? "exo-list-row-selected"
                      : "hover:bg-[var(--exo-bg-surface-hover)]"
                  }`}
                >
                  <div className="flex items-center gap-2 text-[var(--exo-accent)]">
                    <svg
                      className="w-4 h-4 flex-shrink-0"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                    <span className="text-sm font-medium">
                      Search all mail for &quot;{query}&quot;
                    </span>
                  </div>
                </button>
              )}
            </div>
          ) : query.trim() && !isSearching && !isSearchingRemote ? (
            <div className="py-2">
              <div className="px-5 py-6 text-center exo-text-muted text-sm">
                No local results for &quot;{query}&quot;
              </div>
              {/* "Search all mail" affordance when no local results */}
              <button
                onClick={performFullSearch}
                data-search-all-mail="true"
                data-search-selected={selectedIndex === searchAllMailIndex ? "true" : undefined}
                className={`w-full px-6 py-4 text-left transition-colors ${
                  selectedIndex === searchAllMailIndex
                    ? "exo-list-row-selected"
                    : "hover:bg-[var(--exo-bg-surface-hover)]"
                }`}
              >
                <div className="flex items-center gap-2 text-[var(--exo-accent)]">
                  <svg
                    className="w-4 h-4 flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                    />
                  </svg>
                  <span className="text-sm font-medium">
                    Search all mail for &quot;{query}&quot;
                  </span>
                </div>
              </button>
            </div>
          ) : !query.trim() ? (
            <div className="px-5 py-7 text-sm exo-text-muted">
              <div className="font-medium mb-2">Search operators:</div>
              <ul className="space-y-1">
                <li>
                  <code className="bg-[var(--exo-bg-surface-soft)] px-1 rounded">
                    from:email@example.com
                  </code>{" "}
                  - Search by sender
                </li>
                <li>
                  <code className="bg-[var(--exo-bg-surface-soft)] px-1 rounded">
                    to:email@example.com
                  </code>{" "}
                  - Search by recipient
                </li>
                <li>
                  <code className="bg-[var(--exo-bg-surface-soft)] px-1 rounded">
                    subject:keyword
                  </code>{" "}
                  - Search in subject
                </li>
                <li>
                  <code className="bg-[var(--exo-bg-surface-soft)] px-1 rounded">
                    "exact phrase"
                  </code>{" "}
                  - Search exact phrase
                </li>
                <li>
                  <code className="bg-[var(--exo-bg-surface-soft)] px-1 rounded">in:draft</code> -
                  View drafts
                </li>
              </ul>
            </div>
          ) : null}
        </div>

        {/* Footer hints */}
        <div className="flex items-center gap-5 px-6 py-3 text-xs text-[var(--exo-text-muted)] exo-surface-soft">
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--exo-border-subtle)] rounded-sm">↑↓</kbd> to
            navigate
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--exo-border-subtle)] rounded">Enter</kbd>{" "}
            {footerHint}
          </span>
          <span>
            <kbd className="px-1.5 py-0.5 bg-[var(--exo-border-subtle)] rounded">Esc</kbd> to close
          </span>
        </div>
      </div>
    </div>
  );
}

export default SearchBar;
