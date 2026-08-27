import type { InboxSplit, DashboardEmail, LocalDraft } from "../../shared/types";

// Convert a glob-like pattern to a regex
// Supports: * (matches anything), ? (matches single char)
function patternToRegex(pattern: string): RegExp {
  const cached = patternRegexCache.get(pattern);
  if (cached) return cached;
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const regexStr = escaped.replace(/\*/g, ".*").replace(/\?/g, ".");
  const regex = new RegExp(`^${regexStr}$`, "i");
  patternRegexCache.set(pattern, regex);
  return regex;
}

const patternRegexCache = new Map<string, RegExp>();
const alternativePatternCache = new Map<string, readonly string[]>();
const emailSplitMatchCache = new WeakMap<DashboardEmail, WeakMap<InboxSplit, boolean>>();

// Check if a value matches a pattern (supports wildcards)
// If pattern has no wildcards, does a case-insensitive substring match
function matchesPattern(value: string, pattern: string): boolean {
  const hasWildcard = pattern.includes("*") || pattern.includes("?");
  if (hasWildcard) {
    return patternToRegex(pattern).test(value);
  }
  return value.toLowerCase().includes(pattern.toLowerCase());
}

// Users commonly paste a comma-separated sender/domain list into one rule.
// Treat commas and newlines as alternatives instead of one impossible literal
// glob. Empty entries are ignored.
export function splitConditionPatterns(input: string): string[] {
  return [...getConditionPatterns(input, true)];
}

function getConditionPatterns(input: string, allowCommaAlternatives: boolean): readonly string[] {
  const cacheKey = `${allowCommaAlternatives ? "comma" : "newline"}\0${input}`;
  const cached = alternativePatternCache.get(cacheKey);
  if (cached) return cached;
  const patterns = input
    .split(allowCommaAlternatives ? /[\n,]+/ : /\n+/)
    .map((pattern) => pattern.trim())
    .filter(Boolean);
  alternativePatternCache.set(cacheKey, patterns);
  return patterns;
}

function matchesAnyPattern(value: string, input: string, allowCommaAlternatives: boolean): boolean {
  return getConditionPatterns(input, allowCommaAlternatives).some((pattern) =>
    matchesPattern(value, pattern),
  );
}

// Extract email address from "Name <email>" format
function extractEmailAddress(fromField: string): string {
  const match = fromField.match(/<([^>]+)>/);
  return match ? match[1] : fromField;
}

// Evaluate a split condition against an email
export function evaluateCondition(
  email: DashboardEmail,
  condition: InboxSplit["conditions"][0],
): boolean {
  let matches = false;
  switch (condition.type) {
    case "from": {
      const emailAddr = extractEmailAddress(email.from);
      matches =
        matchesAnyPattern(email.from, condition.value, true) ||
        matchesAnyPattern(emailAddr, condition.value, true);
      break;
    }
    case "to": {
      const emailAddr = extractEmailAddress(email.to);
      matches =
        matchesAnyPattern(email.to, condition.value, true) ||
        matchesAnyPattern(emailAddr, condition.value, true);
      break;
    }
    case "subject": {
      matches = matchesAnyPattern(email.subject, condition.value, false);
      break;
    }
    case "label": {
      const labels = new Set(email.labelIds ?? []);
      matches = getConditionPatterns(condition.value, false).some((label) => labels.has(label));
      break;
    }
    case "has_attachment": {
      matches =
        email.attachments?.some((a) => matchesAnyPattern(a.filename, condition.value, false)) ??
        false;
      break;
    }
  }
  return condition.negate ? !matches : matches;
}

// Check if a thread matches a split's conditions.
// Takes the email to evaluate against (typically the latest email in the thread).
export function emailMatchesSplit(email: DashboardEmail, split: InboxSplit): boolean {
  const results = split.conditions.map((c) => evaluateCondition(email, c));
  return split.conditionLogic === "and" ? results.every(Boolean) : results.some(Boolean);
}

// Check if a thread matches a split, scoped to the thread's owning account.
// Splits are per-account: in unified ("All Inboxes") mode multiple accounts'
// splits are visible at once, so an exclusive split from account A must not
// hide threads from account B. Callers pass the thread's latestEmail so we
// can avoid an import cycle with the store's EmailThread type.
//
// Emails with no accountId (legacy / partially-synced data — DashboardEmail.
// accountId is optional) also fail this check, so they stay in the global
// "All"/"Priority" inbox instead of being routed into some arbitrary account's
// exclusive split tab and disappearing from the main view.
export function threadMatchesSplit(latestEmail: DashboardEmail, split: InboxSplit): boolean {
  if (!latestEmail.accountId || latestEmail.accountId !== split.accountId) {
    return false;
  }
  let splitMatches = emailSplitMatchCache.get(latestEmail);
  if (!splitMatches) {
    splitMatches = new WeakMap();
    emailSplitMatchCache.set(latestEmail, splitMatches);
  }
  const cached = splitMatches.get(split);
  if (cached !== undefined) return cached;
  const matches = emailMatchesSplit(latestEmail, split);
  splitMatches.set(split, matches);
  return matches;
}

// Evaluate a split condition against a local draft's available fields.
// Drafts have to/cc/bcc/subject but no from/labels/attachments.
function evaluateConditionForDraft(
  draft: LocalDraft,
  condition: InboxSplit["conditions"][0],
): boolean {
  let matches = false;
  switch (condition.type) {
    case "from":
      // Drafts don't have a meaningful "from" — skip (no match)
      break;
    case "to": {
      const allRecipients = [...draft.to, ...(draft.cc ?? []), ...(draft.bcc ?? [])];
      matches = allRecipients.some(
        (r) =>
          matchesAnyPattern(r, condition.value, true) ||
          matchesAnyPattern(extractEmailAddress(r), condition.value, true),
      );
      break;
    }
    case "subject":
      matches = matchesAnyPattern(draft.subject, condition.value, false);
      break;
    case "label":
      // Drafts don't have Gmail labels
      break;
    case "has_attachment":
      // Drafts don't track attachments in LocalDraft
      break;
  }
  return condition.negate ? !matches : matches;
}

// Check if a local draft matches a split's conditions.
export function draftMatchesSplit(draft: LocalDraft, split: InboxSplit): boolean {
  const results = split.conditions.map((c) => evaluateConditionForDraft(draft, c));
  return split.conditionLogic === "and" ? results.every(Boolean) : results.some(Boolean);
}
