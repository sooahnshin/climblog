"use strict";

const DATA_KEY = "logs.v1";
const DOCUMENT_VERSION = 1;

const DEFAULT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, PUT, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Max-Age": "86400"
};

export default {
  async fetch(request, env) {
    try {
      return await handleRequest(request, env);
    } catch (error) {
      return json({ error: friendlyError(error) }, 500);
    }
  }
};

async function handleRequest(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(env) });
  }

  const url = new URL(request.url);
  if (url.pathname !== "/logs") {
    return json({ error: "Not found" }, 404, env);
  }

  const kv = getKvNamespace(env);
  if (!kv) {
    return json({ error: "Missing CLIMBLOG_KV or climblog_sample_kv binding" }, 500, env);
  }

  if (request.method === "GET") {
    const document = await readDocument(env);
    return json(document, 200, env);
  }

  if (request.method === "PUT") {
    if (!isAuthorized(request, env)) {
      return json({ error: "Unauthorized" }, 401, env);
    }

    const incoming = normalizeDocument(await readJson(request));
    const existing = await readDocument(env);
    const merged = {
      version: DOCUMENT_VERSION,
      updatedAt: new Date().toISOString(),
      logs: mergeLogs(existing.logs, incoming.logs)
    };

    await kv.put(DATA_KEY, JSON.stringify(merged));
    return json(merged, 200, env);
  }

  return json({ error: "Method not allowed" }, 405, env);
}

async function readDocument(env) {
  const kv = getKvNamespace(env);
  const stored = await kv.get(DATA_KEY, "json");
  return normalizeDocument(stored);
}

function getKvNamespace(env) {
  return env.CLIMBLOG_KV || env.climblog_sample_kv;
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function normalizeDocument(document) {
  const logs = Array.isArray(document) ? document : document?.logs;
  return {
    version: DOCUMENT_VERSION,
    updatedAt: typeof document?.updatedAt === "string" ? document.updatedAt : "",
    logs: normalizeLogs(Array.isArray(logs) ? logs : [])
  };
}

function normalizeLogs(logs) {
  return logs.map(normalizeLog).filter(Boolean);
}

function normalizeLog(entry) {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const id = typeof entry.id === "string" ? entry.id.trim() : "";
  const date = typeof entry.date === "string" ? entry.date : "";
  const type = typeof entry.type === "string" ? migrateActivityType(entry.type) : "";
  const durationMinutes = Number(entry.durationMinutes);

  if (!id || !isDateKey(date) || !isActivityType(type) || !Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    return null;
  }

  const now = new Date().toISOString();
  const createdAt = typeof entry.createdAt === "string" ? entry.createdAt : now;
  const updatedAt = typeof entry.updatedAt === "string" ? entry.updatedAt : createdAt;
  const notes = typeof entry.notes === "string" ? entry.notes : "";
  const deletedAt = typeof entry.deletedAt === "string" && entry.deletedAt ? entry.deletedAt : undefined;

  return {
    id,
    date,
    type,
    durationMinutes,
    notes,
    createdAt,
    updatedAt,
    ...(deletedAt ? { deletedAt } : {})
  };
}

function mergeLogs(...sources) {
  const byId = new Map();

  sources.flat().forEach((entry) => {
    const normalized = normalizeLog(entry);
    if (!normalized) {
      return;
    }

    const existing = byId.get(normalized.id);
    if (!existing || entryFreshness(normalized) >= entryFreshness(existing)) {
      byId.set(normalized.id, normalized);
    }
  });

  return Array.from(byId.values()).sort(compareLogsDesc);
}

function entryFreshness(entry) {
  return Date.parse(entry.deletedAt || entry.updatedAt || entry.createdAt || "") || 0;
}

function compareLogsDesc(a, b) {
  const dateCompare = b.date.localeCompare(a.date);
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return (b.updatedAt || b.createdAt || "").localeCompare(a.updatedAt || a.createdAt || "");
}

function isAuthorized(request, env) {
  const expected = env.CLIMBLOG_WRITE_TOKEN || "";
  const header = request.headers.get("Authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(expected) && tokensMatch(token, expected);
}

function tokensMatch(actual, expected) {
  if (actual.length !== expected.length) {
    return false;
  }

  let result = 0;
  for (let index = 0; index < expected.length; index += 1) {
    result |= actual.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return result === 0;
}

function isDateKey(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}

function isActivityType(type) {
  return [
    "bouldering",
    "sportLead",
    "board",
    "outdoor",
    "hangboard",
    "weights",
    "core",
    "cardio",
    "swimming",
    "stretching",
    "other"
  ].includes(type);
}

function migrateActivityType(type) {
  if (type === "yoga") {
    return "swimming";
  }
  return type;
}

function json(data, status = 200, env = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      ...corsHeaders(env),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function corsHeaders(env = {}) {
  const origin = env.CORS_ORIGIN || "*";
  return {
    ...DEFAULT_HEADERS,
    "Access-Control-Allow-Origin": origin
  };
}

function friendlyError(error) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Internal error";
}
