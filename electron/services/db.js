const fs = require("fs");
const path = require("path");
const initSqlJs = require("sql.js");

function nowIso() {
  return new Date().toISOString();
}

function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch (_error) {
    return fallback;
  }
}

async function createDb(app) {
  const userDataDir = app.getPath("userData");
  fs.mkdirSync(userDataDir, { recursive: true });
  const dbPath = path.join(userDataDir, "solosaver.sqlite");

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(process.cwd(), "node_modules", "sql.js", "dist", file)
  });

  let db;
  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  exec(db, `
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      raw_text TEXT NOT NULL,
      platform TEXT DEFAULT '',
      app_hint TEXT DEFAULT '',
      title TEXT DEFAULT '',
      short_url TEXT DEFAULT '',
      final_url TEXT DEFAULT '',
      code_fragments_json TEXT DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'queued',
      download_dir TEXT DEFAULT '',
      output_json TEXT DEFAULT '',
      downloaded_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      error TEXT DEFAULT ''
    );
  `);

  const defaultDownloadDir = path.join(app.getPath("downloads"), "SoloSaver");
  fs.mkdirSync(defaultDownloadDir, { recursive: true });
  if (!getSetting("downloadDir")) {
    run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", ["downloadDir", defaultDownloadDir]);
    persist();
  }
  if (!getSetting("cookieBrowser")) {
    run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", ["cookieBrowser", "auto"]);
    persist();
  }
  if (!getSetting("cookiesTxtPath")) {
    run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", ["cookiesTxtPath", ""]);
    persist();
  }
  if (getSetting("cookiesTxtOnlyMode") === null) {
    run(db, "INSERT INTO settings (key, value) VALUES (?, ?)", ["cookiesTxtOnlyMode", "0"]);
    persist();
  }

  function persist() {
    const data = db.export();
    fs.writeFileSync(dbPath, Buffer.from(data));
  }

  function getSetting(key) {
    const row = firstRow(db, "SELECT value FROM settings WHERE key = ?", [key]);
    return row ? row.value : null;
  }

  function setSetting(key, value) {
    run(
      db,
      `
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `,
      [key, value]
    );
    persist();
  }

  function rowToTask(row) {
    if (!row) return null;
    return {
      id: Number(row.id),
      rawText: row.raw_text,
      platform: row.platform,
      appHint: row.app_hint,
      title: row.title,
      shortUrl: row.short_url,
      finalUrl: row.final_url,
      codeFragments: safeJsonParse(row.code_fragments_json, []),
      status: row.status,
      downloadDir: row.download_dir,
      output: safeJsonParse(row.output_json, null),
      downloadedCount: Number(row.downloaded_count || 0),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      error: row.error
    };
  }

  function getTaskRow(id) {
    return firstRow(db, "SELECT * FROM tasks WHERE id = ?", [id]);
  }

  function updateTask(patch) {
    const current = rowToTask(getTaskRow(patch.id));
    if (!current) throw new Error(`Task not found: ${patch.id}`);
    const merged = { ...current, ...patch };
    run(
      db,
      `
      UPDATE tasks SET
        platform=?, app_hint=?, title=?, short_url=?, final_url=?,
        code_fragments_json=?, status=?, download_dir=?,
        output_json=?, downloaded_count=?, updated_at=?, error=?
      WHERE id=?
      `,
      [
        merged.platform || "",
        merged.appHint || "",
        merged.title || "",
        merged.shortUrl || "",
        merged.finalUrl || "",
        JSON.stringify(merged.codeFragments || []),
        merged.status || "queued",
        merged.downloadDir || "",
        merged.output ? JSON.stringify(merged.output) : "",
        Number(merged.downloadedCount || 0),
        nowIso(),
        merged.error || "",
        merged.id
      ]
    );
    persist();
    return rowToTask(getTaskRow(merged.id));
  }

  return {
    path: dbPath,
    getSettings() {
      return {
        downloadDir: getSetting("downloadDir") || defaultDownloadDir,
        cookieBrowser: getSetting("cookieBrowser") || "auto",
        cookiesTxtPath: getSetting("cookiesTxtPath") || "",
        cookiesTxtOnlyMode: getSetting("cookiesTxtOnlyMode") === "1"
      };
    },
    setSetting,
    insertTask(input) {
      const settings = this.getSettings();
      const timestamp = nowIso();
      run(
        db,
        `
        INSERT INTO tasks (
          raw_text, platform, app_hint, title, short_url, final_url, code_fragments_json,
          status, download_dir, output_json, downloaded_count, created_at, updated_at, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          input.rawText,
          input.platform || "",
          input.appHint || "",
          input.title || "",
          input.shortUrl || "",
          input.finalUrl || "",
          JSON.stringify(input.codeFragments || []),
          input.status || "queued",
          settings.downloadDir,
          "",
          0,
          timestamp,
          timestamp,
          input.error || ""
        ]
      );
      const row = firstRow(db, "SELECT * FROM tasks ORDER BY id DESC LIMIT 1");
      persist();
      return rowToTask(row);
    },
    listTasks() {
      return allRows(db, "SELECT * FROM tasks ORDER BY id DESC").map(rowToTask);
    },
    getTask(id) {
      return rowToTask(getTaskRow(id));
    },
    getNextQueuedTask() {
      return rowToTask(firstRow(db, "SELECT * FROM tasks WHERE status IN ('queued','retry') ORDER BY id ASC LIMIT 1"));
    },
    updateTask,
    retryTask(id) {
      run(db, "UPDATE tasks SET status='retry', error='', updated_at=? WHERE id=?", [nowIso(), id]);
      persist();
      return this.getTask(id);
    },
    deleteCompletedTasks() {
      const before = firstRow(db, "SELECT COUNT(*) AS c FROM tasks WHERE status='completed'")?.c || 0;
      run(db, "DELETE FROM tasks WHERE status='completed'");
      persist();
      return { deleted: Number(before) };
    },
    deleteQueuedTasks() {
      const before = firstRow(db, "SELECT COUNT(*) AS c FROM tasks WHERE status IN ('queued','retry')")?.c || 0;
      run(db, "DELETE FROM tasks WHERE status IN ('queued','retry')");
      persist();
      return { deleted: Number(before) };
    }
  };
}

function exec(db, sql) {
  db.exec(sql);
}

function run(db, sql, params = []) {
  db.run(sql, params);
}

function firstRow(db, sql, params = []) {
  const stmt = db.prepare(sql, params);
  try {
    if (!stmt.step()) return null;
    return stmt.getAsObject();
  } finally {
    stmt.free();
  }
}

function allRows(db, sql, params = []) {
  const stmt = db.prepare(sql, params);
  const rows = [];
  try {
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

module.exports = { createDb };
