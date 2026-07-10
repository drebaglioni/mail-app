import type { DashboardEmail } from "../../shared/types";

export type CapsuleMode =
  | "newsletter"
  | "personal"
  | "meeting"
  | "transactional"
  | "cold"
  | "unknown";

export interface SenderIdentity {
  name: string;
  email: string;
  domain: string;
}

export type CapsuleIconKey = "sparkles" | "calendar" | "package" | "paperclip" | "link" | "shield";

export interface CapsuleInsight {
  mode: CapsuleMode;
  label: string;
  trustLabel: string;
  summary: string;
  actionLabels: string[];
  contextCards: Array<{
    key: string;
    label: string;
    title: string;
    body: string;
    icon: CapsuleIconKey;
  }>;
  hasRemoteImages: boolean;
}

export function stripHtmlForCapsule(body: string): string {
  return body
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

export function getSenderIdentity(email: DashboardEmail): SenderIdentity {
  const nameMatch = email.from.match(/^([^<]+)/);
  const emailMatch = email.from.match(/<([^>]+)>/);
  const rawEmail = (emailMatch?.[1] || email.from).trim().replace(/^mailto:/i, "");
  const cleanEmail = rawEmail.includes("@") ? rawEmail : "";
  const domain = cleanEmail.split("@")[1]?.toLowerCase() || "";
  const fallbackName = cleanEmail ? cleanEmail.split("@")[0] : email.from;
  return {
    name: (nameMatch?.[1] || fallbackName).trim().replace(/^"|"$/g, "") || fallbackName,
    email: cleanEmail || email.from,
    domain,
  };
}

export function countRemoteImages(bodies: string[]): number {
  return bodies.reduce((count, body) => {
    return count + (body.match(/<img\b[^>]*\bsrc\s*=\s*["']https?:\/\//gi) || []).length;
  }, 0);
}

function extractLikelyAsk(text: string): string | null {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return (
    sentences.find((s) => /\?|please|could you|can you|would you|let me know|confirm/i.test(s)) ??
    null
  );
}

function extractLikelyDeadline(text: string): string | null {
  const match = text.match(
    /\b(today|tomorrow|this week|next week|by (?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|eod|[A-Z][a-z]+ \d{1,2})|on [A-Z][a-z]+ \d{1,2}|at \d{1,2}(?::\d{2})?\s?(?:am|pm))\b/i,
  );
  return match?.[0] ?? null;
}

export function classifyEmailCapsule({
  threadEmails,
  latestEmail,
  sender,
  unsubscribeUrl,
  trackingCount,
}: {
  threadEmails: DashboardEmail[];
  latestEmail: DashboardEmail;
  sender: SenderIdentity;
  unsubscribeUrl: string | null;
  trackingCount: number;
}): CapsuleInsight {
  const bodies = threadEmails.map((e) => e.body ?? "").filter(Boolean);
  const text = stripHtmlForCapsule(bodies.join(" "));
  const subject = latestEmail.subject ?? "";
  const combined = `${subject} ${text}`;
  const latestFromMe = latestEmail.labelIds?.includes("SENT") ?? false;
  const hasAttachments = threadEmails.some((e) => (e.attachments?.length ?? 0) > 0);
  const attachmentCount = threadEmails.reduce((sum, e) => sum + (e.attachments?.length ?? 0), 0);
  const remoteImageCount = countRemoteImages(bodies);
  const isNewsletter =
    Boolean(unsubscribeUrl) ||
    /newsletter|digest|update|weekly|roundup|announce|launch|marketing|unsubscribe/i.test(combined);
  const isMeeting =
    /meeting|calendar|invite|schedule|reschedule|availability|zoom|google meet|agenda|call|demo/i.test(
      combined,
    );
  const isTransactional =
    trackingCount > 0 ||
    /receipt|invoice|order|shipped|delivered|tracking|itinerary|booking|reservation|payment|statement|total/i.test(
      combined,
    );
  const isCold =
    !latestFromMe &&
    !threadEmails.some((e) => e.labelIds?.includes("SENT")) &&
    /quick question|following up|bumping|intro|partnership|sponsor|sales|demo|book a time/i.test(
      combined,
    );

  const mode: CapsuleMode = isTransactional
    ? "transactional"
    : isMeeting
      ? "meeting"
      : isNewsletter
        ? "newsletter"
        : isCold
          ? "cold"
          : threadEmails.length > 0
            ? "personal"
            : "unknown";

  const modeCopy: Record<CapsuleMode, Pick<CapsuleInsight, "label" | "summary" | "trustLabel">> = {
    newsletter: {
      label: "Publication",
      summary:
        "A broadcast-style email. Read it like a publication, then decide whether it earns your attention.",
      trustLabel: unsubscribeUrl ? "List sender" : "Broadcast signal",
    },
    personal: {
      label: "Letter",
      summary:
        "A relationship-centered thread. Keep the message readable and the reply path close.",
      trustLabel: sender.domain ? `Known surface: ${sender.domain}` : "Direct sender",
    },
    meeting: {
      label: "Agenda",
      summary:
        "This email appears to contain scheduling intent. Extract the time pressure before replying.",
      trustLabel: "Calendar signal",
    },
    transactional: {
      label: "Artifact",
      summary:
        "This looks like an operational email. Pull out facts, dates, totals, and tracking first.",
      trustLabel: "System sender",
    },
    cold: {
      label: "Triage",
      summary: "Likely outreach. Decide quickly: reply, archive, unsubscribe, or block.",
      trustLabel: "Unverified outreach",
    },
    unknown: {
      label: "Capsule",
      summary: "A neutral reading surface with actions close by.",
      trustLabel: "Unknown pattern",
    },
  };

  const likelyAsk = extractLikelyAsk(text);
  const likelyDeadline = extractLikelyDeadline(combined);
  const cards: CapsuleInsight["contextCards"] = [
    {
      key: "intent",
      label: modeCopy[mode].label,
      title:
        mode === "cold" ? "Decide fast" : mode === "meeting" ? "Scheduling intent" : "Capsule read",
      body: likelyAsk ? likelyAsk.slice(0, 150) : modeCopy[mode].summary,
      icon: "sparkles",
    },
  ];

  if (likelyDeadline) {
    cards.push({
      key: "deadline",
      label: "Time",
      title: likelyDeadline,
      body: "Detected timing language worth checking before you answer.",
      icon: "calendar",
    });
  }

  if (trackingCount > 0) {
    cards.push({
      key: "tracking",
      label: "Tracking",
      title: `${trackingCount} package signal${trackingCount > 1 ? "s" : ""}`,
      body: "Shipment links are available from the action row.",
      icon: "package",
    });
  }

  if (hasAttachments) {
    cards.push({
      key: "attachments",
      label: "Files",
      title: `${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`,
      body: "Attachments stay with the message body for preview.",
      icon: "paperclip",
    });
  }

  if (unsubscribeUrl) {
    cards.push({
      key: "unsubscribe",
      label: "Control",
      title: "Unsubscribe available",
      body: "This sender exposes a list-management link.",
      icon: "link",
    });
  }

  if (remoteImageCount > 0) {
    cards.push({
      key: "privacy",
      label: "Privacy",
      title: `${remoteImageCount} remote image${remoteImageCount === 1 ? "" : "s"} blocked`,
      body: "Images are held locally so opens and location are not leaked.",
      icon: "shield",
    });
  }

  const actionLabels = [
    mode === "meeting" ? "Schedule" : mode === "transactional" ? "Extract facts" : "Summarize",
    mode === "cold" ? "Triage sender" : "Draft reply",
    likelyAsk ? "Find ask" : "Show context",
    ...(unsubscribeUrl ? ["Unsubscribe"] : []),
  ];

  return {
    mode,
    hasRemoteImages: remoteImageCount > 0,
    actionLabels,
    contextCards: cards.slice(0, 5),
    ...modeCopy[mode],
  };
}
