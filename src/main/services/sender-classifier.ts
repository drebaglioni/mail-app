import type { SenderType } from "../../shared/types";

export interface SenderClassificationHeaders {
  from: string;
  listUnsubscribe?: string;
  xMailer?: string;
  precedence?: string;
}

/** Signals strong enough to correct an existing person classification. */
export function hasDefinitiveAutomatedSignal(headers: SenderClassificationHeaders): boolean {
  const from = headers.from.toLowerCase();
  if (/(noreply|no-reply|no\.reply|donotreply|do-not-reply|do\.not\.reply|no_reply)/.test(from)) {
    return true;
  }
  if (headers.listUnsubscribe) return true;
  if (headers.precedence && /^(bulk|list)$/i.test(headers.precedence.trim())) return true;
  return Boolean(
    headers.xMailer &&
    /mailchimp|sendgrid|mailgun|constantcontact|postmark|mandrill|sendinblue|brevo|hubspot|marketo|pardot|campaign.monitor|intercom|customer\.io/i.test(
      headers.xMailer,
    ),
  );
}

/**
 * Heuristic sender classification based on email headers.
 * Returns "automated" for obvious non-person senders,
 * or null when ambiguous (let the LLM decide).
 */
export function classifySenderByHeuristics(
  headers: SenderClassificationHeaders,
): SenderType | null {
  const from = headers.from.toLowerCase();

  if (hasDefinitiveAutomatedSignal(headers)) return "automated";

  // Known automated sender domains
  const automatedDomains = [
    "github.com",
    "gitlab.com",
    "bitbucket.org",
    "linear.app",
    "atlassian.net",
    "jira.com",
    "slack.com",
    "notion.so",
    "figma.com",
    "calendar-notification",
    "google.com", // calendar notifications etc. (not GSuite user emails)
    "linkedin.com",
    "twitter.com",
    "facebook.com",
    "facebookmail.com",
    "instagram.com",
  ];

  // Extract domain from email address
  const domainMatch = from.match(/@([^\s>]+)/);
  if (domainMatch) {
    const domain = domainMatch[1];
    for (const d of automatedDomains) {
      if (domain === d || domain.endsWith("." + d)) {
        return "automated";
      }
    }

    // Subdomain patterns that indicate automated senders
    // e.g. notifications.pge.com, alerts.chase.com, mailer.spotify.com
    const automatedSubdomains =
      /^(notifications?|alerts?|mailer|mail|bounce|email|updates?|info|news|newsletter|marketing|promo|campaigns?|transactional|system|service|support|billing|receipts?|orders?)\./;
    if (automatedSubdomains.test(domain)) {
      return "automated";
    }
  }

  // Local part patterns that indicate automated senders
  // e.g. customerservice@, support@, info@, newsletter@
  const localMatch = from.match(/([^<\s]+)@/);
  if (localMatch) {
    const local = localMatch[1].toLowerCase();
    if (
      /^(customerservice|customer-service|customer_service|customersupport|customer-support|customer_support|support|info|newsletter|news|marketing|billing|sales|admin|system|automated|robot|bot|notifications?|alerts?|updates?|subscriptions?|surveys?)$/.test(
        local,
      )
    ) {
      return "automated";
    }
  }

  // Ambiguous — let the LLM decide
  return null;
}
