import { test, expect } from "@playwright/test";
import type { DashboardEmail } from "../../src/shared/types";
import {
  classifyEmailCapsule,
  countRemoteImages,
  getSenderIdentity,
} from "../../src/renderer/services/email-capsule";

function email(overrides: Partial<DashboardEmail>): DashboardEmail {
  return {
    id: "email-1",
    threadId: "thread-1",
    accountId: "account-1",
    from: "Sender <sender@example.com>",
    to: "Me <me@example.com>",
    subject: "Hello",
    date: "2026-07-10T12:00:00Z",
    body: "Hello",
    snippet: "Hello",
    labelIds: ["INBOX"],
    ...overrides,
  } as DashboardEmail;
}

function classify(input: {
  latestEmail: DashboardEmail;
  threadEmails?: DashboardEmail[];
  unsubscribeUrl?: string | null;
  trackingCount?: number;
}) {
  return classifyEmailCapsule({
    latestEmail: input.latestEmail,
    threadEmails: input.threadEmails ?? [input.latestEmail],
    sender: getSenderIdentity(input.latestEmail),
    unsubscribeUrl: input.unsubscribeUrl ?? null,
    trackingCount: input.trackingCount ?? 0,
  });
}

test.describe("email capsule classification", () => {
  test("classifies newsletter-style mail as publication and exposes unsubscribe/privacy context", () => {
    const latestEmail = email({
      from: "Snacks <hello@snacks.example>",
      subject: "Weekly product update",
      body: '<p>Hey snackers</p><img src="https://cdn.example.com/hero.png" width="600"><a href="https://example.com/unsubscribe">unsubscribe</a>',
    });

    const capsule = classify({
      latestEmail,
      unsubscribeUrl: "https://example.com/unsubscribe",
    });

    expect(capsule.mode).toBe("newsletter");
    expect(capsule.label).toBe("Publication");
    expect(capsule.actionLabels).toContain("Unsubscribe");
    expect(capsule.contextCards.map((card) => card.key)).toEqual(
      expect.arrayContaining(["unsubscribe", "privacy"]),
    );
  });

  test("classifies scheduling language as agenda mode with schedule action", () => {
    const latestEmail = email({
      subject: "Can we schedule a demo tomorrow?",
      body: "Could you meet tomorrow at 2pm? Here's a Zoom link for the call.",
    });

    const capsule = classify({ latestEmail });

    expect(capsule.mode).toBe("meeting");
    expect(capsule.label).toBe("Agenda");
    expect(capsule.actionLabels).toContain("Schedule");
    expect(capsule.contextCards.map((card) => card.key)).toContain("deadline");
  });

  test("classifies tracking or receipt mail as artifact mode", () => {
    const latestEmail = email({
      from: "Shop <orders@shop.example>",
      subject: "Your order shipped",
      body: "Receipt total $42.00. UPS tracking 1Z999AA10123456784.",
    });

    const capsule = classify({ latestEmail, trackingCount: 1 });

    expect(capsule.mode).toBe("transactional");
    expect(capsule.label).toBe("Artifact");
    expect(capsule.actionLabels).toContain("Extract facts");
    expect(capsule.contextCards.map((card) => card.key)).toContain("tracking");
  });

  test("counts remote images but ignores inline and local images", () => {
    expect(
      countRemoteImages([
        '<img src="https://cdn.example.com/a.png"><img src="data:image/png;base64,abc"><img src="/local.png">',
      ]),
    ).toBe(1);
  });
});
