import type BetterSqlite3 from "better-sqlite3";

type DatabaseConnection = Pick<BetterSqlite3.Database, "prepare">;

export const SAVE_EMAIL_SQL = `
  INSERT OR REPLACE INTO emails (id, account_id, thread_id, subject, from_address, to_address, cc_address, bcc_address, body, body_text, snippet, date, fetched_at, label_ids, attachments, message_id, in_reply_to, archive_kept)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT archive_kept FROM emails WHERE id = ?), 0))
`;

export function writeThreadArchiveKeepOverride(
  db: DatabaseConnection,
  threadIds: readonly string[],
  accountId: string,
  keep: boolean | null,
): void {
  const uniqueThreadIds = [...new Set(threadIds)];
  if (uniqueThreadIds.length === 0) return;
  const storedValue = keep === null ? 0 : keep ? 1 : -1;
  const placeholders = uniqueThreadIds.map(() => "?").join(",");
  db.prepare(
    `UPDATE emails SET archive_kept = ? WHERE thread_id IN (${placeholders}) AND account_id = ?`,
  ).run(storedValue, ...uniqueThreadIds, accountId);
}

export type AnalysisSnapshot = {
  needsReply: boolean;
  reason: string;
  senderType?: string;
  automatedCategory?: string;
  analyzedAt: number;
};

export function writeAnalysisIfUnchanged(
  db: DatabaseConnection,
  input: {
    emailId: string;
    needsReply: boolean;
    reason: string;
    senderType?: string;
    automatedCategory?: string;
    analyzedAt: number;
  },
  expected?: AnalysisSnapshot,
): boolean {
  if (!expected) {
    return (
      db
        .prepare(
          `INSERT OR IGNORE INTO analyses
           (email_id, needs_reply, reason, sender_type, automated_category, analyzed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.emailId,
          input.needsReply ? 1 : 0,
          input.reason,
          input.senderType ?? null,
          input.automatedCategory ?? null,
          input.analyzedAt,
        ).changes === 1
    );
  }

  return (
    db
      .prepare(
        `UPDATE analyses
         SET needs_reply = ?, reason = ?, sender_type = ?, automated_category = ?, analyzed_at = ?
         WHERE email_id = ?
           AND needs_reply = ?
           AND reason = ?
           AND sender_type IS ?
           AND automated_category IS ?
           AND analyzed_at = ?`,
      )
      .run(
        input.needsReply ? 1 : 0,
        input.reason,
        input.senderType ?? null,
        input.automatedCategory ?? null,
        input.analyzedAt,
        input.emailId,
        expected.needsReply ? 1 : 0,
        expected.reason,
        expected.senderType ?? null,
        expected.automatedCategory ?? null,
        expected.analyzedAt,
      ).changes === 1
  );
}
