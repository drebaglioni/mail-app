import { expect, test } from "@playwright/test";
import {
  classifySenderByHeuristics,
  hasDefinitiveAutomatedSignal,
} from "../../src/main/services/sender-classifier";
import { senderBucket } from "../../src/shared/sender-bucket";

test.describe("sender classification boundary", () => {
  test("only explicit person classifications enter People", () => {
    expect(senderBucket("person")).toBe("people");
    expect(senderBucket("automated")).toBe("automated");
    expect(senderBucket(undefined)).toBe("uncategorized");
  });

  test("detects embedded and dotted no-reply addresses", () => {
    expect(classifySenderByHeuristics({ from: "Gusto <gustonoreply@example.com>" })).toBe(
      "automated",
    );
    expect(classifySenderByHeuristics({ from: "no.reply.alerts@example.com" })).toBe("automated");
  });

  test("uses Gmail bulk-mail headers before asking the model", () => {
    expect(
      classifySenderByHeuristics({
        from: "Friendly Digest <hello@example.com>",
        listUnsubscribe: "<mailto:unsubscribe@example.com>",
      }),
    ).toBe("automated");
    expect(classifySenderByHeuristics({ from: "updates@example.com", precedence: "bulk" })).toBe(
      "automated",
    );
    expect(classifySenderByHeuristics({ from: "digest@example.com", xMailer: "Mailchimp" })).toBe(
      "automated",
    );
  });

  test("keeps ambiguous senders unknown", () => {
    expect(classifySenderByHeuristics({ from: "Alice <alice@example.com>" })).toBeNull();
  });

  test("only definitive signals may correct an existing person result", () => {
    expect(hasDefinitiveAutomatedSignal({ from: "Employee <person@google.com>" })).toBe(false);
    expect(hasDefinitiveAutomatedSignal({ from: "Marie <customersupport@example.com>" })).toBe(
      false,
    );
    expect(hasDefinitiveAutomatedSignal({ from: "Gusto <gustonoreply@example.com>" })).toBe(true);
    expect(
      hasDefinitiveAutomatedSignal({
        from: "Digest <hello@example.com>",
        listUnsubscribe: "<https://example.com/unsubscribe>",
      }),
    ).toBe(true);
  });
});
