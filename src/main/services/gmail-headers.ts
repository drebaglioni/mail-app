import type { SenderClassificationHeaders } from "./sender-classifier";

type GmailHeader = { name?: string | null; value?: string | null };

/** Extract the Gmail headers used at the sender-classification boundary. */
export function extractSenderClassificationHeaders(
  headers: GmailHeader[],
): Omit<SenderClassificationHeaders, "from"> {
  const get = (name: string) =>
    headers.find((header) => header.name?.toLowerCase() === name)?.value || undefined;
  return {
    listUnsubscribe: get("list-unsubscribe"),
    xMailer: get("x-mailer"),
    precedence: get("precedence"),
  };
}
