"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { REGION_KYUSHU_SOUTH, PREFECTURES } = require("./disaster-sources");
const {
  SOURCES_FILE,
  INDEX_FILE,
  SOCIAL_CATEGORIES,
  buildAndWriteDisasterSocialIndex
} = require("./disaster-social-index-engine");
const {
  evaluateSnsFetchScope,
  isSnsAutoFetchItem,
  SNS_FETCH_PLATFORMS,
  SNS_FETCH_SINCE_DATE
} = require("./disaster-social-community-scope");

const ROOT = path.join(__dirname, "..");
const INBOX_FILE = path.join(ROOT, "data", "community", "disaster_social_inbox.json");
const INBOX_TEST_FILE = path.join(ROOT, "data", "community", "disaster_social_inbox_test.json");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "community", "disaster_social_review_queue.json");
const APPLY_QUEUE_FILE = path.join(ROOT, "data", "community", "disaster_social_apply_queue.json");

const AUTO_PUBLISH = false;

const IMPORT_MINIMUM_FIELDS = [
  "source",
  "category",
  "prefecture",
  "municipality",
  "district",
  "date",
  "title",
  "content",
  "url"
];

const REVIEW_STATUS_VALUES = ["PENDING", "APPROVED", "REJECTED", "DUPLICATE"];
const APPLY_STATUS_VALUES = ["PENDING", "APPLIED", "SKIPPED"];
const INBOX_PROCESS_STATUS_VALUES = ["NEW", "QUEUED", "DUPLICATE"];
const SOURCE_TYPE_VALUES = ["X", "Instagram", "WEB", "MANUAL", "OTHER"];

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeDate(value) {
  const normalized = normalizeText(value);
  if (!normalized) {
    return "";
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return normalized;
  }
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) {
    return normalized.slice(0, 10);
  }
  return new Date(parsed).toISOString().slice(0, 10);
}

function listMissingImportFields(item) {
  const missing = [];
  IMPORT_MINIMUM_FIELDS.forEach(function (field) {
    if (!normalizeText(item[field])) {
      missing.push(field);
    }
  });
  return missing;
}

function resolveEntryStatus(item) {
  const missing = listMissingImportFields(item);
  if (missing.length) {
    return "incomplete";
  }
  if (item.status === "ARCHIVED") {
    return "ARCHIVED";
  }
  return "ACTIVE";
}

function buildDedupeKey(item) {
  const url = normalizeText(item.url);
  if (url) {
    return "url:" + url;
  }
  return (
    "hash:" +
    crypto
      .createHash("sha256")
      .update(
        [
          normalizeText(item.source),
          normalizeText(item.category),
          normalizeText(item.prefecture),
          normalizeText(item.municipality),
          normalizeText(item.district),
          normalizeDate(item.date),
          normalizeText(item.title),
          normalizeText(item.content)
        ].join("|")
      )
      .digest("hex")
  );
}

function buildEntryId(inboxItem, index) {
  if (inboxItem.id) {
    return normalizeText(inboxItem.id);
  }
  if (inboxItem.inbox_id) {
    return "SOC-IDX-" + normalizeText(inboxItem.inbox_id);
  }
  const datePart = normalizeDate(inboxItem.date).replace(/-/g, "") || "nodate";
  const suffix = String(index + 1).padStart(3, "0");
  return "SOC-IDX-" + datePart + "-" + suffix;
}

function normalizeKeywords(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.map(normalizeText).filter(Boolean);
  }
  return String(value)
    .split(/[,、]/)
    .map(normalizeText)
    .filter(Boolean);
}

function normalizeSourceType(value, importFormat) {
  const normalized = normalizeText(value);
  if (SOURCE_TYPE_VALUES.indexOf(normalized) !== -1) {
    return normalized;
  }
  const format = normalizeText(importFormat).toUpperCase();
  if (format === "MANUAL") {
    return "MANUAL";
  }
  if (format === "SNS") {
    return "X";
  }
  if (format === "CSV" || format === "JSON") {
    return "WEB";
  }
  return "OTHER";
}

function normalizeInboxItem(item, index) {
  const missingFields = listMissingImportFields(item);
  const importFormat = normalizeText(item.import_format) || "MANUAL";
  const normalized = {
    inbox_id: normalizeText(item.inbox_id) || "INB-" + String(index + 1).padStart(4, "0"),
    import_format: importFormat,
    source_type: normalizeSourceType(item.source_type, importFormat),
    captured_at: item.captured_at || new Date().toISOString(),
    source: normalizeText(item.source),
    category: normalizeText(item.category),
    prefecture: normalizeText(item.prefecture),
    municipality: normalizeText(item.municipality),
    district: normalizeText(item.district),
    prefecture_group: normalizeText(item.prefecture_group),
    region_group: normalizeText(item.region_group),
    date: normalizeDate(item.date),
    title: normalizeText(item.title),
    content: normalizeText(item.content),
    url: normalizeText(item.url),
    keywords: normalizeKeywords(item.keywords),
    review_note: normalizeText(item.review_note),
    status: resolveEntryStatus(item),
    missing_fields: missingFields.slice(),
    dedupe_key: buildDedupeKey(item)
  };
  if (item.post_url) {
    normalized.post_url = normalizeText(item.post_url);
  }
  if (item.sns_fetch && typeof item.sns_fetch === "object") {
    normalized.sns_fetch = Object.assign({}, item.sns_fetch);
  }
  return normalized;
}

function inboxItemToIndexEntry(inboxItem, index) {
  const entry = {
    id: buildEntryId(inboxItem, index),
    source: inboxItem.source || "UNKNOWN",
    category: inboxItem.category || "OTHER",
    prefecture: inboxItem.prefecture || "",
    municipality: inboxItem.municipality || "",
    district: inboxItem.district || "",
    date: inboxItem.date || "",
    title: inboxItem.title || "",
    content: inboxItem.content || "",
    url: inboxItem.url || "",
    status: inboxItem.status || "incomplete"
  };
  if (inboxItem.keywords && inboxItem.keywords.length) {
    entry.keywords = inboxItem.keywords.slice();
  }
  if (inboxItem.source_type) {
    entry.source_type = inboxItem.source_type;
  }
  if (inboxItem.captured_at) {
    entry.captured_at = inboxItem.captured_at;
  }
  if (inboxItem.post_url) {
    entry.post_url = inboxItem.post_url;
  } else if (inboxItem.sns_fetch && inboxItem.sns_fetch.post_url) {
    entry.post_url = inboxItem.sns_fetch.post_url;
  } else if (
    (inboxItem.source_type === "X" || inboxItem.source_type === "Instagram") &&
    inboxItem.url
  ) {
    entry.post_url = inboxItem.url;
  }
  if (inboxItem.prefecture_group) {
    entry.prefecture_group = inboxItem.prefecture_group;
  }
  if (inboxItem.region_group) {
    entry.region_group = inboxItem.region_group;
  }
  return entry;
}

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvImport(csvText, options) {
  options = options || {};
  const lines = String(csvText || "")
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);

  if (!lines.length) {
    return [];
  }

  const headers = parseCsvLine(lines[0]).map(function (header) {
    return header.trim();
  });
  const items = [];

  lines.slice(1).forEach(function (line, index) {
    const cells = parseCsvLine(line);
    const row = { import_format: "CSV" };
    headers.forEach(function (header, cellIndex) {
      row[header] = cells[cellIndex] || "";
    });
    row.inbox_id = row.inbox_id || "CSV-" + String(index + 1).padStart(4, "0");
    items.push(normalizeInboxItem(row, index));
  });

  return items;
}

function parseJsonImport(payload) {
  const rows = Array.isArray(payload) ? payload : payload.items || payload.entries || [];
  return rows.map(function (row, index) {
    const item = Object.assign({ import_format: "JSON" }, row);
    return normalizeInboxItem(item, index);
  });
}

function loadDisasterSocialInbox(options) {
  options = options || {};
  return readJson(options.inboxPath || INBOX_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    AUTO_PUBLISH: AUTO_PUBLISH,
    items: []
  });
}

function loadDisasterSocialReviewQueue(options) {
  options = options || {};
  return readJson(options.reviewQueuePath || REVIEW_QUEUE_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_REVIEW",
    AUTO_PUBLISH: AUTO_PUBLISH,
    items: []
  });
}

function loadDisasterSocialApplyQueue(options) {
  options = options || {};
  return readJson(options.applyQueuePath || APPLY_QUEUE_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_APPLY",
    AUTO_PUBLISH: AUTO_PUBLISH,
    items: []
  });
}

function buildExistingDedupeLookup(indexPayload) {
  const lookup = new Map();
  (indexPayload.entries || []).forEach(function (entry) {
    lookup.set(buildDedupeKey(entry), entry.id);
  });
  return lookup;
}

function validateInboxItem(item, index) {
  const label = "inbox[" + index + "]";
  const errors = [];
  const normalized = item && item.dedupe_key ? item : normalizeInboxItem(item || {}, index);
  if (!normalized || typeof normalized !== "object") {
    errors.push(label + ": item missing");
    return errors;
  }
  if (!normalized.inbox_id) {
    errors.push(label + ": missing inbox_id");
  }
  if (!normalized.dedupe_key) {
    errors.push(label + ": missing dedupe_key");
  }
  if (normalized.category && SOCIAL_CATEGORIES.indexOf(normalized.category) === -1) {
    errors.push(label + ": invalid category " + normalized.category);
  }
  if (normalized.source_type && SOURCE_TYPE_VALUES.indexOf(normalized.source_type) === -1) {
    errors.push(label + ": invalid source_type " + normalized.source_type);
  }
  if (normalized.keywords !== undefined && !Array.isArray(normalized.keywords)) {
    errors.push(label + ": keywords must be an array");
  }
  return errors;
}

function validateDisasterSocialInbox(payload) {
  const errors = [];
  if (!payload || !Array.isArray(payload.items)) {
    errors.push("inbox items must be an array");
    return errors;
  }
  if (payload.AUTO_PUBLISH !== false) {
    errors.push("inbox AUTO_PUBLISH must be false");
  }
  payload.items.forEach(function (item, index) {
    errors.push.apply(errors, validateInboxItem(item, index));
  });
  return errors;
}

function buildReviewQueueFromInbox(inboxPayload, options) {
  options = options || {};
  const indexPayload = readJson(options.indexPath || INDEX_FILE, { entries: [] });
  const existingQueue = readJson(options.reviewQueuePath || REVIEW_QUEUE_FILE, { items: [] });
  const dedupeLookup = buildExistingDedupeLookup(indexPayload);
  const seenInbox = new Set();
  const seenDedupe = new Set();
  const queueItems = (existingQueue.items || []).slice();
  const queueByInbox = new Map();

  queueItems.forEach(function (item) {
    if (item.inbox_id) {
      queueByInbox.set(item.inbox_id, item);
    }
    if (item.dedupe_key) {
      seenDedupe.add(item.dedupe_key);
    }
  });

  (inboxPayload.items || []).forEach(function (rawItem, index) {
    const item = normalizeInboxItem(rawItem, index);
    if (queueByInbox.has(item.inbox_id)) {
      const existing = queueByInbox.get(item.inbox_id);
      if (item.review_note && !existing.review_note) {
        existing.review_note = item.review_note;
      }
      return;
    }
    if (seenInbox.has(item.inbox_id)) {
      return;
    }
    seenInbox.add(item.inbox_id);

    let reviewStatus = "PENDING";
    let duplicateOf = null;
    if (dedupeLookup.has(item.dedupe_key) || seenDedupe.has(item.dedupe_key)) {
      reviewStatus = "DUPLICATE";
      duplicateOf = dedupeLookup.get(item.dedupe_key) || null;
    }
    let scopeEvaluation = null;
    if (isSnsAutoFetchItem(item)) {
      scopeEvaluation = evaluateSnsFetchScope(item);
      if (!scopeEvaluation.pass && reviewStatus === "PENDING") {
        reviewStatus = "REJECTED";
      }
    }
    seenDedupe.add(item.dedupe_key);

    const queueItem = {
      queue_id: "SOC-REV-" + item.inbox_id,
      inbox_id: item.inbox_id,
      review_status: reviewStatus,
      dedupe_key: item.dedupe_key,
      duplicate_of: duplicateOf,
      import_format: item.import_format,
      source_type: item.source_type,
      missing_fields: item.missing_fields,
      entry: inboxItemToIndexEntry(item, index),
      captured_at: item.captured_at,
      reviewed_at: null
    };
    if (scopeEvaluation && !scopeEvaluation.pass) {
      queueItem.scope_rejection = {
        reasons: scopeEvaluation.reasons.slice(),
        sns_fetch_since: SNS_FETCH_SINCE_DATE,
        allowed_platforms: SNS_FETCH_PLATFORMS.slice()
      };
      queueItem.review_note = (item.review_note ? item.review_note + " " : "") +
        "scope_rejected:" + scopeEvaluation.reasons.join(",");
    } else if (item.status === "incomplete" || item.review_note) {
      queueItem.review_note = item.review_note || "";
    }
    queueItems.push(queueItem);
    queueByInbox.set(item.inbox_id, queueItem);
  });

  const statusSummary = {
    PENDING: 0,
    APPROVED: 0,
    REJECTED: 0,
    DUPLICATE: 0
  };
  queueItems.forEach(function (item) {
    statusSummary[item.review_status] = (statusSummary[item.review_status] || 0) + 1;
  });

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_REVIEW",
    AUTO_PUBLISH: AUTO_PUBLISH,
    item_count: queueItems.length,
    status_summary: statusSummary,
    items: queueItems,
    last_updated: new Date().toISOString()
  };
}

function buildApplyQueueFromReviewQueue(reviewQueue, options) {
  options = options || {};
  const existingApply = readJson(options.applyQueuePath || APPLY_QUEUE_FILE, { items: [] });
  const applyByQueue = new Map();
  (existingApply.items || []).forEach(function (item) {
    applyByQueue.set(item.queue_id, item);
  });

  const applyItems = (existingApply.items || []).slice();
  (reviewQueue.items || []).forEach(function (reviewItem) {
    if (reviewItem.review_status !== "APPROVED") {
      return;
    }
    if (applyByQueue.has(reviewItem.queue_id)) {
      return;
    }
    applyItems.push({
      apply_id: "SOC-APP-" + reviewItem.queue_id,
      queue_id: reviewItem.queue_id,
      inbox_id: reviewItem.inbox_id,
      apply_status: "PENDING",
      entry: reviewItem.entry,
      created_at: new Date().toISOString(),
      applied_at: null
    });
    applyByQueue.set(reviewItem.queue_id, true);
  });

  return {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    queue_type: "DISASTER_SOCIAL_APPLY",
    AUTO_PUBLISH: AUTO_PUBLISH,
    item_count: applyItems.length,
    items: applyItems,
    last_updated: new Date().toISOString()
  };
}

function ensureSourceExists(sourcesPayload, sourceId) {
  const sources = sourcesPayload.sources || [];
  if (sources.some(function (source) { return source.source_id === sourceId; })) {
    return sourcesPayload;
  }
  sources.push({
    source_id: sourceId,
    name: sourceId,
    source_type: "MANUAL",
    type: "UNKNOWN",
    platform: "MANUAL",
    url: "",
    coverage_prefectures: [],
    active: true
  });
  sourcesPayload.sources = sources;
  return sourcesPayload;
}

function applyDisasterSocialQueue(options) {
  options = options || {};
  const applyQueue = loadDisasterSocialApplyQueue(options);
  const sourcesPayload = readJson(options.sourcesPath || SOURCES_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    sources: []
  });
  const indexPayload = readJson(options.indexPath || INDEX_FILE, {
    version: "1.0",
    region: REGION_KYUSHU_SOUTH,
    entries: []
  });
  const entriesById = new Map();
  (indexPayload.entries || []).forEach(function (entry) {
    entriesById.set(entry.id, entry);
  });

  let appliedCount = 0;
  applyQueue.items.forEach(function (applyItem) {
    if (applyItem.apply_status !== "PENDING") {
      return;
    }
    const entry = applyItem.entry;
    if (!entry || !entry.id) {
      return;
    }
    ensureSourceExists(sourcesPayload, entry.source);
    entriesById.set(entry.id, entry);
    applyItem.apply_status = "APPLIED";
    applyItem.applied_at = new Date().toISOString();
    appliedCount += 1;
  });

  indexPayload.entries = Array.from(entriesById.values());
  indexPayload.last_updated = new Date().toISOString();

  writeJson(options.sourcesPath || SOURCES_FILE, sourcesPayload);
  writeJson(options.indexPath || INDEX_FILE, indexPayload);
  writeJson(options.applyQueuePath || APPLY_QUEUE_FILE, applyQueue);

  if (options.writePublic !== false) {
    buildAndWriteDisasterSocialIndex({
      sourcesPath: options.sourcesPath || SOURCES_FILE,
      indexPath: options.indexPath || INDEX_FILE,
      publicSourcesPath: options.publicSourcesPath,
      publicIndexPath: options.publicIndexPath
    });
  }

  return {
    applied_count: appliedCount,
    entry_count: indexPayload.entries.length,
    source_count: sourcesPayload.sources.length,
    apply_queue: applyQueue
  };
}

function runDisasterSocialReviewPipeline(options) {
  options = options || {};
  const inbox = loadDisasterSocialInbox(options);
  const inboxErrors = validateDisasterSocialInbox(inbox);
  if (inboxErrors.length) {
    return { errors: inboxErrors };
  }

  const reviewQueue = buildReviewQueueFromInbox(inbox, options);
  const applyQueue = buildApplyQueueFromReviewQueue(reviewQueue, options);

  writeJson(options.reviewQueuePath || REVIEW_QUEUE_FILE, reviewQueue);
  writeJson(options.applyQueuePath || APPLY_QUEUE_FILE, applyQueue);

  return {
    inbox: inbox,
    review_queue: reviewQueue,
    apply_queue: applyQueue,
    errors: []
  };
}

module.exports = {
  AUTO_PUBLISH,
  INBOX_FILE,
  INBOX_TEST_FILE,
  REVIEW_QUEUE_FILE,
  APPLY_QUEUE_FILE,
  IMPORT_MINIMUM_FIELDS,
  REVIEW_STATUS_VALUES,
  APPLY_STATUS_VALUES,
  SOURCE_TYPE_VALUES,
  parseCsvImport,
  parseJsonImport,
  normalizeInboxItem,
  buildDedupeKey,
  loadDisasterSocialInbox,
  loadDisasterSocialReviewQueue,
  loadDisasterSocialApplyQueue,
  validateInboxItem,
  validateDisasterSocialInbox,
  buildReviewQueueFromInbox,
  buildApplyQueueFromReviewQueue,
  applyDisasterSocialQueue,
  runDisasterSocialReviewPipeline
};
