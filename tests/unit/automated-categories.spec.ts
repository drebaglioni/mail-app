import { expect, test } from "@playwright/test";
import {
  HEURISTIC_ANALYSIS_REASON,
  needsSemanticAnalysis,
  type DashboardEmail,
  type InboxSplit,
} from "../../src/shared/types";
import {
  splitConditionPatterns,
  threadMatchesSplit,
} from "../../src/renderer/utils/split-conditions";
import { useAppStore } from "../../src/renderer/store";

function email(overrides: Partial<DashboardEmail> = {}): DashboardEmail {
  return {
    id: "email-1",
    threadId: "thread-1",
    accountId: "account-1",
    subject: "Trip update",
    from: "Travel <updates@uber.com>",
    to: "user@example.com",
    date: "2026-08-15T12:00:00Z",
    ...overrides,
  };
}

test.describe("Automated semantic analysis completeness", () => {
  test("requeues provisional heuristic Other classifications", () => {
    expect(
      needsSemanticAnalysis(
        email({
          analysis: {
            needsReply: false,
            reason: HEURISTIC_ANALYSIS_REASON,
            senderType: "automated",
            automatedCategory: "other",
            analyzedAt: 1,
          },
        }),
      ),
    ).toBe(true);
  });

  test("requeues automated analyses with no visible category", () => {
    expect(
      needsSemanticAnalysis(
        email({
          analysis: {
            needsReply: false,
            reason: "Incomplete model result",
            senderType: "automated",
            analyzedAt: 1,
          },
        }),
      ),
    ).toBe(true);
  });

  test("accepts semantic automated categories and person classifications", () => {
    expect(
      needsSemanticAnalysis(
        email({
          analysis: {
            needsReply: false,
            reason: "Travel confirmation",
            senderType: "automated",
            automatedCategory: "travel",
            analyzedAt: 1,
          },
        }),
      ),
    ).toBe(false);
    expect(
      needsSemanticAnalysis(
        email({
          analysis: {
            needsReply: true,
            reason: "Direct question",
            senderType: "person",
            analyzedAt: 1,
          },
        }),
      ),
    ).toBe(false);
  });
});

test.describe("comma-separated split alternatives", () => {
  const split: InboxSplit = {
    id: "travel-rule",
    accountId: "account-1",
    name: "Travel",
    conditions: [
      {
        type: "from",
        value: "*@uber.com*, *@united.com, *@delta.com",
      },
    ],
    conditionLogic: "or",
    order: 0,
  };

  test("parses comma and newline separated patterns", () => {
    expect(splitConditionPatterns(" a*, b*\nc* ")).toEqual(["a*", "b*", "c*"]);
  });

  test("matches any configured sender alternative", () => {
    expect(threadMatchesSplit(email(), split)).toBe(true);
    expect(threadMatchesSplit(email({ from: "Airline <alerts@delta.com>" }), split)).toBe(true);
    expect(threadMatchesSplit(email({ from: "Person <person@example.com>" }), split)).toBe(false);
  });
});

test.describe("Automated filter state", () => {
  test.afterEach(() => {
    useAppStore.setState({ currentSplitId: "__people__", automatedFilter: { kind: "all" } });
  });

  test("selecting built-in and custom filters keeps one active mode", () => {
    useAppStore.getState().setAutomatedFilter({ kind: "category", category: "travel" });
    expect(useAppStore.getState().currentSplitId).toBe("__automated__");
    expect(useAppStore.getState().automatedFilter).toEqual({
      kind: "category",
      category: "travel",
    });

    useAppStore.getState().setAutomatedFilter({ kind: "split", splitId: "travel-rule" });
    expect(useAppStore.getState().currentSplitId).toBe("__automated__");
    expect(useAppStore.getState().automatedFilter).toEqual({
      kind: "split",
      splitId: "travel-rule",
    });

    useAppStore.getState().setCurrentSplitId("__automated__");
    expect(useAppStore.getState().automatedFilter).toEqual({ kind: "all" });
  });
});
