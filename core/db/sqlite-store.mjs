import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { mkdir } from "node:fs/promises";
import { SQLITE_SCHEMA } from "./schema.mjs";
import { stableId } from "../lib/hash.mjs";

function nowIso() {
  return new Date().toISOString();
}

function asJson(value) {
  return JSON.stringify(value ?? {});
}

function parseJson(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

export async function openWorkflowStore({ projectRoot, dbPath } = {}) {
  const resolvedDbPath = dbPath ?? path.resolve(projectRoot, ".ai-workflow", "state", "workflow.db");
  await mkdir(path.dirname(resolvedDbPath), { recursive: true });
  const db = new DatabaseSync(resolvedDbPath);
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec(SQLITE_SCHEMA);
  return new SqliteWorkflowStore({ db, dbPath: resolvedDbPath, projectRoot });
}

export class SqliteWorkflowStore {
  constructor({ db, dbPath, projectRoot }) {
    this.db = db;
    this.dbPath = dbPath;
    this.projectRoot = projectRoot;
  }

  close() {
    this.db.close();
  }

  setMeta(key, value) {
    this.db.prepare(`
      INSERT INTO workspace_meta (key, value_json)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
    `).run(key, asJson(value));
  }

  getMeta(key, fallback = null) {
    const row = this.db.prepare("SELECT value_json FROM workspace_meta WHERE key = ?").get(key);
    return row ? parseJson(row.value_json, fallback) : fallback;
  }

  replaceIndexedFile({ file, parsed, sha1, indexedAt }) {
    this.db.prepare(`
      INSERT INTO files (path, language, file_kind, sha1, size_bytes, mtime_ms, metadata_json, indexed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        language = excluded.language,
        file_kind = excluded.file_kind,
        sha1 = excluded.sha1,
        size_bytes = excluded.size_bytes,
        mtime_ms = excluded.mtime_ms,
        metadata_json = excluded.metadata_json,
        indexed_at = excluded.indexed_at
    `).run(
      file.relativePath,
      parsed.language,
      parsed.fileKind,
      sha1,
      file.sizeBytes,
      file.mtimeMs,
      asJson(parsed.metadata),
      indexedAt
    );

    this.db.prepare("DELETE FROM symbols WHERE file_path = ? AND source_kind = 'indexed'").run(file.relativePath);
    this.db.prepare("DELETE FROM claims WHERE file_path = ? AND source_kind = 'indexed'").run(file.relativePath);
    this.db.prepare("DELETE FROM notes WHERE file_path = ? AND source_kind = 'indexed'").run(file.relativePath);
    this.db.prepare("DELETE FROM search_index WHERE scope = 'file' AND ref_id = ?").run(file.relativePath);

    for (const [index, symbol] of (parsed.symbols ?? []).entries()) {
      this.db.prepare(`
        INSERT INTO symbols (id, file_path, name, kind, exported, line, column, metadata_json, source_kind, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?)
      `).run(
        stableId("symbol", file.relativePath, symbol.kind, symbol.name, index),
        file.relativePath,
        symbol.name,
        symbol.kind,
        symbol.exported ? 1 : 0,
        symbol.line ?? null,
        symbol.column ?? null,
        asJson(symbol.metadata),
        indexedAt
      );
    }

    for (const [index, fact] of (parsed.facts ?? []).entries()) {
      this.db.prepare(`
        INSERT INTO claims (id, subject_id, predicate, object_id, object_text, kind, confidence, provenance, source_kind, lifecycle_state, file_path, line, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'indexed', ?, ?, ?, ?, ?)
      `).run(
        stableId("claim", file.relativePath, fact.predicate, fact.objectText ?? fact.objectId, fact.line ?? index),
        `file:${file.relativePath}`,
        fact.predicate,
        fact.objectId ?? null,
        fact.objectText ?? null,
        fact.kind ?? "fact",
        fact.confidence ?? 1,
        fact.provenance ?? file.relativePath,
        fact.lifecycleState ?? "active",
        file.relativePath,
        fact.line ?? null,
        indexedAt,
        indexedAt
      );
    }

    for (const note of parsed.notes ?? []) {
      this.upsertNote({
        id: stableId("note", file.relativePath, note.noteType, note.line ?? 0, note.body),
        noteType: note.noteType,
        status: "observed",
        filePath: file.relativePath,
        symbolName: note.symbolName ?? null,
        line: note.line ?? null,
        column: note.column ?? null,
        body: note.body,
        sourceKind: "indexed",
        provenance: file.relativePath,
        riskScore: note.riskScore,
        leverageScore: note.leverageScore,
        ticketValueScore: note.ticketValueScore,
        candidateScore: note.candidateScore,
        observedAt: indexedAt
      });
    }

    this.db.prepare(`
      INSERT INTO search_index (id, scope, ref_id, title, body, tags, updated_at)
      VALUES (?, 'file', ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        body = excluded.body,
        tags = excluded.tags,
        updated_at = excluded.updated_at
    `).run(
      stableId("search", "file", file.relativePath),
      file.relativePath,
      file.relativePath,
      parsed.searchText ?? "",
      [parsed.language, parsed.fileKind].join(","),
      indexedAt
    );
  }

  upsertEntity(entity) {
    const timestamp = entity.updatedAt ?? nowIso();
    this.db.prepare(`
      INSERT INTO entities (id, entity_type, title, lane, state, confidence, provenance, source_kind, review_state, parent_id, relevant_until, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        lane = excluded.lane,
        state = excluded.state,
        confidence = excluded.confidence,
        provenance = excluded.provenance,
        source_kind = excluded.source_kind,
        review_state = excluded.review_state,
        parent_id = excluded.parent_id,
        relevant_until = excluded.relevant_until,
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(
      entity.id,
      entity.entityType,
      entity.title,
      entity.lane ?? null,
      entity.state ?? "open",
      entity.confidence ?? 1,
      entity.provenance ?? "manual",
      entity.sourceKind ?? "manual",
      entity.reviewState ?? "active",
      entity.parentId ?? null,
      entity.relevantUntil ?? null,
      asJson(entity.data),
      entity.createdAt ?? timestamp,
      timestamp
    );
  }

  listEntities(filters = {}) {
    const clauses = [];
    const values = [];

    if (filters.entityType) {
      clauses.push("entity_type = ?");
      values.push(filters.entityType);
    }

    if (filters.lanes?.length) {
      clauses.push(`lane IN (${filters.lanes.map(() => "?").join(", ")})`);
      values.push(...filters.lanes);
    }

    if (filters.states?.length) {
      clauses.push(`state IN (${filters.states.map(() => "?").join(", ")})`);
      values.push(...filters.states);
    }

    const query = `
      SELECT *
      FROM entities
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY entity_type, COALESCE(lane, ''), updated_at DESC, id
    `;

    return this.db.prepare(query).all(...values).map((row) => ({
      id: row.id,
      entityType: row.entity_type,
      title: row.title,
      lane: row.lane,
      state: row.state,
      confidence: row.confidence,
      provenance: row.provenance,
      sourceKind: row.source_kind,
      reviewState: row.review_state,
      parentId: row.parent_id,
      relevantUntil: row.relevant_until,
      data: parseJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  upsertNote(note) {
    this.db.prepare(`
      INSERT INTO notes (id, note_type, status, file_path, symbol_name, line, column, body, normalized_body, source_kind, provenance, risk_score, leverage_score, ticket_value_score, candidate_score, observed_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        status = excluded.status,
        symbol_name = excluded.symbol_name,
        line = excluded.line,
        column = excluded.column,
        body = excluded.body,
        normalized_body = excluded.normalized_body,
        provenance = excluded.provenance,
        risk_score = excluded.risk_score,
        leverage_score = excluded.leverage_score,
        ticket_value_score = excluded.ticket_value_score,
        candidate_score = excluded.candidate_score,
        updated_at = excluded.updated_at
    `).run(
      note.id,
      note.noteType,
      note.status ?? "observed",
      note.filePath ?? null,
      note.symbolName ?? null,
      note.line ?? null,
      note.column ?? null,
      note.body,
      normalizeText(note.body),
      note.sourceKind ?? "manual",
      note.provenance ?? "manual",
      note.riskScore ?? 0,
      note.leverageScore ?? 0,
      note.ticketValueScore ?? 0,
      note.candidateScore ?? 0,
      note.observedAt ?? nowIso(),
      note.updatedAt ?? nowIso()
    );
  }

  listNotes(filters = {}) {
    const clauses = [];
    const values = [];
    if (filters.noteTypes?.length) {
      clauses.push(`note_type IN (${filters.noteTypes.map(() => "?").join(", ")})`);
      values.push(...filters.noteTypes);
    }
    if (filters.filePath) {
      clauses.push("file_path = ?");
      values.push(filters.filePath);
    }
    const query = `
      SELECT *
      FROM notes
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY candidate_score DESC, updated_at DESC
    `;
    return this.db.prepare(query).all(...values).map((row) => ({
      id: row.id,
      noteType: row.note_type,
      status: row.status,
      filePath: row.file_path,
      symbolName: row.symbol_name,
      line: row.line,
      column: row.column,
      body: row.body,
      normalizedBody: row.normalized_body,
      sourceKind: row.source_kind,
      provenance: row.provenance,
      riskScore: row.risk_score,
      leverageScore: row.leverage_score,
      ticketValueScore: row.ticket_value_score,
      candidateScore: row.candidate_score,
      observedAt: row.observed_at,
      updatedAt: row.updated_at
    }));
  }

  upsertCandidate(candidate) {
    const existing = this.db.prepare("SELECT * FROM candidates WHERE id = ?").get(candidate.id);
    const preservedStatus = existing && ["rejected", "archived", "promoted"].includes(existing.status)
      ? existing.status
      : candidate.status;

    this.db.prepare(`
      INSERT INTO candidates (id, note_id, title, status, reason, score, decision_key, last_review_at, next_review_at, data_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        note_id = excluded.note_id,
        title = excluded.title,
        status = ?,
        reason = excluded.reason,
        score = excluded.score,
        last_review_at = COALESCE(candidates.last_review_at, excluded.last_review_at),
        next_review_at = COALESCE(candidates.next_review_at, excluded.next_review_at),
        data_json = excluded.data_json,
        updated_at = excluded.updated_at
    `).run(
      candidate.id,
      candidate.noteId,
      candidate.title,
      preservedStatus,
      candidate.reason,
      candidate.score,
      candidate.decisionKey,
      candidate.lastReviewAt ?? null,
      candidate.nextReviewAt ?? null,
      asJson(candidate.data),
      candidate.createdAt ?? nowIso(),
      candidate.updatedAt ?? nowIso(),
      preservedStatus
    );
  }

  listCandidates(filters = {}) {
    const clauses = [];
    const values = [];
    if (filters.statuses?.length) {
      clauses.push(`status IN (${filters.statuses.map(() => "?").join(", ")})`);
      values.push(...filters.statuses);
    }
    const query = `
      SELECT *
      FROM candidates
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""}
      ORDER BY score DESC, updated_at DESC
    `;
    return this.db.prepare(query).all(...values).map((row) => ({
      id: row.id,
      noteId: row.note_id,
      title: row.title,
      status: row.status,
      reason: row.reason,
      score: row.score,
      decisionKey: row.decision_key,
      lastReviewAt: row.last_review_at,
      nextReviewAt: row.next_review_at,
      data: parseJson(row.data_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    }));
  }

  appendEvent({ eventType, entityType, entityId = null, payload = {}, createdAt = nowIso() }) {
    this.db.prepare(`
      INSERT INTO events (id, event_type, entity_type, entity_id, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      stableId("event", eventType, entityType, entityId, createdAt, Math.random()),
      eventType,
      entityType,
      entityId,
      asJson(payload),
      createdAt
    );
  }

  cleanupDerivedState() {
    this.db.prepare("DELETE FROM candidates WHERE note_id NOT IN (SELECT id FROM notes)").run();
    this.db.prepare("DELETE FROM entities WHERE entity_type = 'candidate-ticket' AND source_kind = 'proposal'").run();
    this.db.prepare(`
      DELETE FROM search_index
      WHERE scope = 'entity'
        AND ref_id NOT IN (SELECT id FROM entities)
    `).run();
  }

  search(query, { limit = 20, scopes = [] } = {}) {
    const trimmed = String(query).trim().toLowerCase();
    if (!trimmed) {
      return [];
    }
    const scopeClause = scopes.length ? `AND scope IN (${scopes.map(() => "?").join(", ")})` : "";
    const rows = this.db.prepare(`
      SELECT *,
        (CASE
          WHEN lower(title) LIKE '%' || ? || '%' THEN 40
          WHEN lower(body) LIKE '%' || ? || '%' THEN 20
          ELSE 0
        END) AS score
      FROM search_index
      WHERE (lower(title) LIKE '%' || ? || '%' OR lower(body) LIKE '%' || ? || '%')
        ${scopeClause}
      ORDER BY score DESC, updated_at DESC
      LIMIT ?
    `).all(trimmed, trimmed, trimmed, trimmed, ...scopes, limit);

    const indexedResults = rows.map((row) => ({
      id: row.id,
      scope: row.scope,
      refId: row.ref_id,
      title: row.title,
      body: row.body,
      tags: row.tags ? row.tags.split(",").filter(Boolean) : [],
      updatedAt: row.updated_at
    }));

    const noteRows = this.db.prepare(`
      SELECT id, file_path, note_type, body, updated_at
      FROM notes
      WHERE lower(body) LIKE '%' || ? || '%'
         OR lower(COALESCE(file_path, '')) LIKE '%' || ? || '%'
      ORDER BY updated_at DESC
      LIMIT ?
    `).all(trimmed, trimmed, limit);

    const noteResults = noteRows.map((row) => ({
      id: `note:${row.id}`,
      scope: "note",
      refId: row.id,
      title: `${row.note_type} ${row.file_path ?? "manual"}`,
      body: row.body,
      tags: [row.note_type, row.file_path].filter(Boolean),
      updatedAt: row.updated_at
    }));

    return [...indexedResults, ...noteResults]
      .filter((item, index, list) => list.findIndex((other) => other.id === item.id) === index)
      .slice(0, limit);
  }

  getSummary() {
    const files = this.db.prepare("SELECT COUNT(*) AS value FROM files").get().value;
    const notes = this.db.prepare("SELECT COUNT(*) AS value FROM notes").get().value;
    const symbols = this.db.prepare("SELECT COUNT(*) AS value FROM symbols").get().value;
    const claims = this.db.prepare("SELECT COUNT(*) AS value FROM claims").get().value;
    const tickets = this.db.prepare("SELECT COUNT(*) AS value FROM entities WHERE entity_type = 'ticket'").get().value;
    const candidates = this.db.prepare("SELECT COUNT(*) AS value FROM candidates").get().value;
    return { files, notes, symbols, claims, tickets, candidates };
  }
}

function normalizeText(value) {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}
