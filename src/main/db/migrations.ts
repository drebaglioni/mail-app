/**
 * Migration runner — extracted from db/index.ts so it can be imported in
 * non-Electron test contexts (notably tests/migrations/replay.spec.ts).
 *
 * The only runtime dependencies this file may take are the better-sqlite3
 * type and the logger (which uses lazy `createRequire` against Electron and
 * degrades to tmpdir-based logging when Electron isn't available — see
 * services/logger.ts:18-25). Do NOT import data-dir, electron, or anything
 * that pulls them in transitively.
 */
import type BetterSqlite3 from "better-sqlite3";
import { createLogger } from "../services/logger";
import { classifySenderByHeuristics } from "../services/sender-classifier";

const log = createLogger("db-migrations");

type DatabaseInstance = BetterSqlite3.Database;

interface Migration {
  version: number;
  name: string;
  up: (db: DatabaseInstance) => void;
}

/**
 * Run all migrations against the given DB.
 *
 * The legacy block (pre-versioning) uses `tableInfo.length > 0` guards
 * everywhere because on a fresh DB the tables don't exist yet — SCHEMA
 * creates them with the final column set, so these ALTERs are no-ops on
 * fresh DBs and only fire on existing pre-numbered-system DBs that
 * predate the column additions.
 *
 * After the legacy block runs, `runNumberedMigrations` handles the
 * forward-only numbered system.
 */
export function runMigrations(db: DatabaseInstance): void {
  // Check if emails table exists and has account_id column
  const tableInfo = db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>;
  const hasAccountId = tableInfo.some((col) => col.name === "account_id");

  if (tableInfo.length > 0 && !hasAccountId) {
    log.info("[DB] Running migration: Adding account_id column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN account_id TEXT DEFAULT 'default'");
  }

  // Create index for account_id (idempotent)
  try {
    db.exec("CREATE INDEX IF NOT EXISTS idx_emails_account ON emails(account_id)");
  } catch {
    // ignore
  }

  // Check if extension_enrichments table exists and has sender_email column
  const enrichmentsTableInfo = db
    .prepare("PRAGMA table_info(extension_enrichments)")
    .all() as Array<{ name: string }>;
  const hasSenderEmail = enrichmentsTableInfo.some((col) => col.name === "sender_email");

  if (enrichmentsTableInfo.length > 0 && !hasSenderEmail) {
    log.info("[DB] Running migration: Adding sender_email column to extension_enrichments table");
    db.exec("ALTER TABLE extension_enrichments ADD COLUMN sender_email TEXT");
  }

  try {
    db.exec(
      "CREATE INDEX IF NOT EXISTS idx_extension_enrichments_sender ON extension_enrichments(sender_email, extension_id)",
    );
  } catch {
    // ignore
  }

  const hasLabelIds = tableInfo.some((col) => col.name === "label_ids");
  if (tableInfo.length > 0 && !hasLabelIds) {
    log.info("[DB] Running migration: Adding label_ids column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN label_ids TEXT");
  }

  const hasCcAddress = tableInfo.some((col) => col.name === "cc_address");
  if (tableInfo.length > 0 && !hasCcAddress) {
    log.info("[DB] Running migration: Adding cc_address column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN cc_address TEXT");
  }

  const hasBccAddress = tableInfo.some((col) => col.name === "bcc_address");
  if (tableInfo.length > 0 && !hasBccAddress) {
    log.info("[DB] Running migration: Adding bcc_address column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN bcc_address TEXT");
  }

  const calSyncTableInfo = db.prepare("PRAGMA table_info(calendar_sync_state)").all() as Array<{
    name: string;
  }>;
  const hasCalSyncVisible = calSyncTableInfo.some((col) => col.name === "visible");
  if (calSyncTableInfo.length > 0 && !hasCalSyncVisible) {
    log.info("[DB] Running migration: Adding visible column to calendar_sync_state table");
    db.exec("ALTER TABLE calendar_sync_state ADD COLUMN visible INTEGER DEFAULT 1");
  }

  // Re-read tableInfo since we may have added columns above
  const tableInfoRefresh = db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>;
  const hasBodyText = tableInfoRefresh.some((col) => col.name === "body_text");
  if (tableInfoRefresh.length > 0 && !hasBodyText) {
    log.info("[DB] Running migration: Adding body_text column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN body_text TEXT");
  }

  const tableInfoForAttachments = db.prepare("PRAGMA table_info(emails)").all() as Array<{
    name: string;
  }>;
  const hasAttachments = tableInfoForAttachments.some((col) => col.name === "attachments");
  if (tableInfoForAttachments.length > 0 && !hasAttachments) {
    log.info("[DB] Running migration: Adding attachments column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN attachments TEXT");
  }

  const outboxTableInfo = db.prepare("PRAGMA table_info(outbox)").all() as Array<{ name: string }>;
  const outboxHasAttachments = outboxTableInfo.some((col) => col.name === "attachments");
  if (outboxTableInfo.length > 0 && !outboxHasAttachments) {
    log.info("[DB] Running migration: Adding attachments column to outbox table");
    db.exec("ALTER TABLE outbox ADD COLUMN attachments TEXT");
  }

  const draftsTableInfo = db.prepare("PRAGMA table_info(drafts)").all() as Array<{ name: string }>;
  const hasAgentTaskId = draftsTableInfo.some((col) => col.name === "agent_task_id");
  if (draftsTableInfo.length > 0 && !hasAgentTaskId) {
    log.info("[DB] Running migration: Adding agent_task_id column to drafts table");
    db.exec("ALTER TABLE drafts ADD COLUMN agent_task_id TEXT");
  }

  const draftsTableInfoRefresh = db.prepare("PRAGMA table_info(drafts)").all() as Array<{
    name: string;
  }>;
  const hasDraftCc = draftsTableInfoRefresh.some((col) => col.name === "cc");
  if (draftsTableInfoRefresh.length > 0 && !hasDraftCc) {
    log.info("[DB] Running migration: Adding cc column to drafts table");
    db.exec("ALTER TABLE drafts ADD COLUMN cc TEXT");
  }
  const hasDraftBcc = draftsTableInfoRefresh.some((col) => col.name === "bcc");
  if (draftsTableInfoRefresh.length > 0 && !hasDraftBcc) {
    log.info("[DB] Running migration: Adding bcc column to drafts table");
    db.exec("ALTER TABLE drafts ADD COLUMN bcc TEXT");
  }

  const draftsTableInfoForMode = db.prepare("PRAGMA table_info(drafts)").all() as Array<{
    name: string;
  }>;
  const hasDraftComposeMode = draftsTableInfoForMode.some((col) => col.name === "compose_mode");
  if (draftsTableInfoForMode.length > 0 && !hasDraftComposeMode) {
    log.info("[DB] Running migration: Adding compose_mode column to drafts table");
    db.exec("ALTER TABLE drafts ADD COLUMN compose_mode TEXT");
  }

  const draftsTableInfoForTo = db.prepare("PRAGMA table_info(drafts)").all() as Array<{
    name: string;
  }>;
  const hasDraftToRecipients = draftsTableInfoForTo.some((col) => col.name === "to_recipients");
  if (draftsTableInfoForTo.length > 0 && !hasDraftToRecipients) {
    log.info("[DB] Running migration: Adding to_recipients column to drafts table");
    db.exec("ALTER TABLE drafts ADD COLUMN to_recipients TEXT");
  }

  const tableInfoForMessageId = db.prepare("PRAGMA table_info(emails)").all() as Array<{
    name: string;
  }>;
  const hasMessageId = tableInfoForMessageId.some((col) => col.name === "message_id");
  if (tableInfoForMessageId.length > 0 && !hasMessageId) {
    log.info("[DB] Running migration: Adding message_id column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN message_id TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails(message_id)");
  }

  const tableInfoForInReplyTo = db.prepare("PRAGMA table_info(emails)").all() as Array<{
    name: string;
  }>;
  const hasInReplyTo = tableInfoForInReplyTo.some((col) => col.name === "in_reply_to");
  if (tableInfoForInReplyTo.length > 0 && !hasInReplyTo) {
    log.info("[DB] Running migration: Adding in_reply_to column to emails table");
    db.exec("ALTER TABLE emails ADD COLUMN in_reply_to TEXT");
    db.exec("CREATE INDEX IF NOT EXISTS idx_emails_in_reply_to ON emails(in_reply_to)");
  }

  const memoriesTableInfo = db.prepare("PRAGMA table_info(memories)").all() as Array<{
    name: string;
  }>;
  const hasMemoryType = memoriesTableInfo.some((col) => col.name === "memory_type");
  if (memoriesTableInfo.length > 0 && !hasMemoryType) {
    log.info("[DB] Running migration: Adding memory_type column to memories table");
    db.exec("ALTER TABLE memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'drafting'");
  }

  const draftMemoriesTableInfo = db.prepare("PRAGMA table_info(draft_memories)").all() as Array<{
    name: string;
  }>;
  const hasDraftMemoryType = draftMemoriesTableInfo.some((col) => col.name === "memory_type");
  if (draftMemoriesTableInfo.length > 0 && !hasDraftMemoryType) {
    log.info("[DB] Running migration: Adding memory_type column to draft_memories table");
    db.exec("ALTER TABLE draft_memories ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'drafting'");
  }

  // === Forward-only numbered migration system ===
  runNumberedMigrations(db);
}

// Add new migrations here. Version numbers must be sequential.
// Existing databases get version 0 (baseline) on first run.
export const NUMBERED_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "add_llm_calls_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS llm_calls (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL DEFAULT (datetime('now')),
          model TEXT NOT NULL,
          caller TEXT NOT NULL,
          email_id TEXT,
          account_id TEXT,
          input_tokens INTEGER NOT NULL,
          output_tokens INTEGER NOT NULL,
          cache_read_tokens INTEGER DEFAULT 0,
          cache_create_tokens INTEGER DEFAULT 0,
          cost_cents REAL NOT NULL,
          duration_ms INTEGER NOT NULL,
          success INTEGER NOT NULL DEFAULT 1,
          error_message TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_llm_calls_created ON llm_calls(created_at);
        CREATE INDEX IF NOT EXISTS idx_llm_calls_caller ON llm_calls(caller);
      `);
    },
  },
  {
    version: 2,
    name: "add_send_as_aliases_and_from_address",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS send_as_aliases (
          email TEXT NOT NULL,
          account_id TEXT NOT NULL,
          display_name TEXT,
          is_default INTEGER DEFAULT 0,
          reply_to_address TEXT,
          verification_status TEXT,
          fetched_at INTEGER NOT NULL,
          PRIMARY KEY (email, account_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_send_as_account ON send_as_aliases(account_id);
      `);

      // ALTER TABLE only for existing databases — fresh DBs get the column from SCHEMA
      const tables = ["local_drafts", "outbox", "scheduled_messages"];
      for (const table of tables) {
        const cols = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
        if (cols.length > 0 && !cols.some((c) => c.name === "from_address")) {
          db.exec(`ALTER TABLE ${table} ADD COLUMN from_address TEXT`);
        }
      }
    },
  },
  {
    version: 3,
    name: "index_agent_conversation_mirror_local_task_id",
    up: (db) => {
      // Guard: migrations run before SCHEMA (see initDatabase order), so on a
      // fresh DB the table doesn't exist yet. CREATE INDEX IF NOT EXISTS only
      // guards the index, not the table — skip here and let SCHEMA + the index
      // in the schema file handle fresh DBs.
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='agent_conversation_mirror'",
        )
        .get();
      if (!tableExists) return;
      db.exec(
        `CREATE INDEX IF NOT EXISTS idx_agent_conversation_mirror_task_status
         ON agent_conversation_mirror(local_task_id, status)`,
      );
    },
  },
  {
    version: 4,
    name: "add_blocked_senders_table",
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS blocked_senders (
          sender_email TEXT NOT NULL,
          account_id TEXT NOT NULL,
          gmail_filter_id TEXT,
          blocked_at INTEGER NOT NULL,
          PRIMARY KEY (sender_email, account_id),
          FOREIGN KEY (account_id) REFERENCES accounts(id)
        );
        CREATE INDEX IF NOT EXISTS idx_blocked_senders_account ON blocked_senders(account_id);
      `);
    },
  },
  {
    version: 5,
    name: "drop_analyses_priority_column",
    up: (db) => {
      // Three-level priority (high/medium/low) was collapsed to a binary
      // Priority/Other classification (issue #143). The column is unused
      // after this release. Guard on table existence so fresh DBs (which
      // get the final SCHEMA without the column) are a no-op here.
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyses'")
        .get();
      if (!tableExists) return;
      const cols = db.prepare("PRAGMA table_info(analyses)").all() as Array<{ name: string }>;
      if (cols.some((c) => c.name === "priority")) {
        db.exec("ALTER TABLE analyses DROP COLUMN priority");
      }
    },
  },
  {
    version: 6,
    name: "add_emails_merge_covering_index",
    // buildMergeCache (db/index.ts) runs
    //   SELECT thread_id, message_id, in_reply_to FROM emails WHERE account_id = ?
    // every time the per-account merge cache is invalidated by saveEmail/
    // deleteEmail. With ~8k inbox rows and the existing idx_emails_account index
    // (which doesn't cover the SELECT columns), SQLite has to do row-by-row
    // lookups in the main table — 190ms per rebuild, and the prefetch service
    // can trigger 20+ rebuilds in one burst, causing 7-9s main-thread
    // beachballs. A covering index lets the rebuild be served entirely from
    // index pages, dropping it from ~190ms to single-digit ms.
    //
    // Guard on table existence: migrations run BEFORE the SCHEMA `CREATE TABLE`
    // statements in initDatabase, so on a fresh DB the `emails` table won't
    // exist yet. SCHEMA itself includes this index (see schema.ts), so fresh
    // DBs are still covered — this migration only matters for existing DBs.
    up: (db) => {
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'")
        .get();
      if (!tableExists) return;
      db.exec(`
        CREATE INDEX IF NOT EXISTS idx_emails_merge_cover
          ON emails(account_id, thread_id, message_id, in_reply_to);
      `);
    },
  },
  {
    version: 7,
    name: "add_llm_calls_provider_column",
    up: (db) => {
      // Track which LLM backend handled each call. Defaults to "anthropic"
      // for existing rows.
      const cols = db.prepare("PRAGMA table_info(llm_calls)").all() as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === "provider")) {
        db.exec(`ALTER TABLE llm_calls ADD COLUMN provider TEXT DEFAULT 'anthropic'`);
      }
    },
  },
  // ---- Fork-specific migrations (versions 8+) ----
  // These were originally v3/v4 in our pre-merge fork; renumbered to land
  // after upstream's 1–7 so existing DBs of either lineage converge cleanly.
  {
    version: 8,
    name: "add_sender_type_and_archive_kept",
    up: (db) => {
      // Add sender classification columns to analyses if missing
      const analysisTableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyses'")
        .get();
      if (analysisTableExists) {
        const analysisCols = db.prepare("PRAGMA table_info(analyses)").all() as Array<{
          name: string;
        }>;
        if (!analysisCols.some((c) => c.name === "sender_type")) {
          db.exec("ALTER TABLE analyses ADD COLUMN sender_type TEXT");
        }
        if (!analysisCols.some((c) => c.name === "automated_category")) {
          db.exec("ALTER TABLE analyses ADD COLUMN automated_category TEXT");
        }
        // Backfill existing analyses default to "person" so the UI doesn't
        // collapse historical rows into Automated.
        db.exec("UPDATE analyses SET sender_type = 'person' WHERE sender_type IS NULL");
      }

      // Add per-thread archive keep toggle to emails table if missing
      const emailsTableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'")
        .get();
      if (emailsTableExists) {
        const emailCols = db.prepare("PRAGMA table_info(emails)").all() as Array<{ name: string }>;
        if (!emailCols.some((c) => c.name === "archive_kept")) {
          db.exec("ALTER TABLE emails ADD COLUMN archive_kept INTEGER DEFAULT 0");
        }
      }

      // Table for tracking user corrections (future training data)
      db.exec(`
        CREATE TABLE IF NOT EXISTS classification_overrides (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          thread_id TEXT NOT NULL,
          field TEXT NOT NULL,
          original_value TEXT,
          corrected_value TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now'))
        );
        CREATE INDEX IF NOT EXISTS idx_classification_overrides_thread
          ON classification_overrides(thread_id);
      `);
    },
  },
  {
    version: 9,
    name: "reclassify_senders_with_heuristics",
    up: (db) => {
      // Re-run heuristic sender classification on all analyzed emails.
      // Migration v8 conservatively set everything to "person" — now apply
      // the heuristic classifier to catch obvious automated senders.
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='analyses'")
        .get();
      if (!tableExists) return;
      const rows = db
        .prepare(
          `SELECT a.email_id, e.from_address
           FROM analyses a
           JOIN emails e ON e.id = a.email_id
           WHERE a.sender_type = 'person' OR a.sender_type IS NULL`,
        )
        .all() as Array<{ email_id: string; from_address: string }>;

      if (rows.length === 0) return;

      const updateStmt = db.prepare(
        "UPDATE analyses SET sender_type = ?, automated_category = COALESCE(automated_category, ?) WHERE email_id = ?",
      );
      let reclassified = 0;
      for (const row of rows) {
        const result = classifySenderByHeuristicsForMigration(row.from_address);
        if (result === "automated") {
          updateStmt.run("automated", "other", row.email_id);
          reclassified++;
        }
      }
      if (reclassified > 0) {
        log.info(
          `[Migration v9] Reclassified ${reclassified}/${rows.length} emails as automated via heuristics`,
        );
      }
    },
  },
  {
    version: 10,
    name: "backfill_heuristic_analysis_for_unanalyzed",
    up: (db) => {
      // Inbox emails that arrived before the merge but were never analyzed by
      // the LLM land in the People tab because the filter treats "no analysis"
      // as person. Insert a lightweight analysis for the obvious automated
      // senders using the same heuristic that saveEmail() now runs at ingest.
      const tableExists = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='emails'")
        .get();
      if (!tableExists) return;

      const rows = db
        .prepare(
          `SELECT e.id, e.from_address
           FROM emails e
           LEFT JOIN analyses a ON a.email_id = e.id
           WHERE a.email_id IS NULL`,
        )
        .all() as Array<{ id: string; from_address: string }>;
      if (rows.length === 0) return;

      const insertStmt = db.prepare(
        `INSERT INTO analyses (email_id, needs_reply, reason, sender_type, analyzed_at)
         VALUES (?, 0, 'Auto-classified by sender pattern', 'automated', ?)`,
      );
      const now = Date.now();
      let classified = 0;
      for (const row of rows) {
        if (classifySenderByHeuristics({ from: row.from_address }) === "automated") {
          insertStmt.run(row.id, now);
          classified++;
        }
      }
      if (classified > 0) {
        log.info(
          `[Migration v10] Heuristically classified ${classified}/${rows.length} unanalyzed emails as automated`,
        );
      }
    },
  },
];

// Migration-local copy of the heuristic classifier so this file can run in
// non-Electron contexts (migration replay tests). Mirrors the rules in
// services/email-analyzer.ts:classifySenderByHeuristics. Keep in sync.
function classifySenderByHeuristicsForMigration(from: string): "person" | "automated" | null {
  if (!from) return null;
  const lower = from.toLowerCase();
  const automatedKeywords = [
    "noreply",
    "no-reply",
    "no.reply",
    "donotreply",
    "do-not-reply",
    "do.not.reply",
    "notifications@",
    "notification@",
    "alerts@",
    "alert@",
    "mailer-daemon",
    "postmaster@",
    "automated@",
    "auto-confirm",
    "bounces+",
    "bounce@",
  ];
  if (automatedKeywords.some((k) => lower.includes(k))) return "automated";
  return null;
}

function runNumberedMigrations(db: DatabaseInstance): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER NOT NULL UNIQUE,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const currentRow = db.prepare("SELECT MAX(version) as version FROM schema_version").get() as
    | { version: number | null }
    | undefined;
  let currentVersion = currentRow?.version ?? -1;

  if (currentVersion === -1) {
    db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(0);
    currentVersion = 0;
    log.info({ version: 0 }, "Migration system initialized at baseline");
  }

  for (const migration of NUMBERED_MIGRATIONS) {
    if (migration.version > currentVersion) {
      log.info({ version: migration.version, name: migration.name }, "Running numbered migration");
      const runInTransaction = db.transaction(() => {
        migration.up(db);
        db.prepare("INSERT INTO schema_version (version) VALUES (?)").run(migration.version);
      });
      runInTransaction();
      currentVersion = migration.version;
    }
  }
}
