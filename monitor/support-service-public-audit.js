"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");

const ROOT = path.join(__dirname, "..");
const AUDIT_LOG_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_public_audit_log.json"
);
const PUBLIC_VERSION_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_public_version.json"
);

const AUDIT_ACTIONS = ["ADD", "UPDATE", "EXPIRE"];
const AUDIT_STATUSES = ["SUCCESS", "FAILED"];

const SNAPSHOT_FIELDS = [
  "information_id",
  "title",
  "subcategory",
  "facility_name",
  "address",
  "municipality",
  "opening_type",
  "published_at",
  "available_from",
  "available_until",
  "status",
  "source_id",
  "checked_at"
];

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

function buildAuditId(applyId, action) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto
    .createHash("sha256")
    .update([applyId || "", action || "", stamp].join("|"))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return "SSAUD-" + stamp + "-" + suffix;
}

function buildVersionId(itemCount, applyCount) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto
    .createHash("sha256")
    .update([String(itemCount), String(applyCount), stamp].join("|"))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return "SSPV-" + stamp + "-" + suffix;
}

function createEmptyAuditLog() {
  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    audit_entry_count: 0,
    audit_entries: []
  };
}

function createEmptyPublicVersion() {
  const createdAt = new Date().toISOString();
  const current = {
    version_id: buildVersionId(0, 0),
    created_at: createdAt,
    item_count: 0,
    apply_count: 0
  };
  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: createdAt,
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    current: current,
    history: [Object.assign({}, current)]
  };
}

function extractPublicSnapshot(entry) {
  if (!entry || typeof entry !== "object") {
    return {};
  }

  const snapshot = {};
  SNAPSHOT_FIELDS.forEach(function (field) {
    if (entry[field] !== undefined && entry[field] !== null) {
      snapshot[field] = entry[field];
    }
  });
  return snapshot;
}

function buildApplyTrace(queueItem, reviewItem) {
  const reviewId =
    (reviewItem && (reviewItem.review_id || reviewItem.queue_id)) ||
    (queueItem && queueItem.queue_id) ||
    null;
  const changeId =
    (reviewItem && reviewItem.change_id) || (queueItem && queueItem.change_id) || null;
  const sourceId =
    (reviewItem && reviewItem.source_id) ||
    (reviewItem && reviewItem.after && reviewItem.after.source_id) ||
    (reviewItem && reviewItem.before && reviewItem.before.source_id) ||
    null;

  return {
    apply_id: queueItem ? queueItem.apply_id : null,
    review_id: reviewId,
    change_id: changeId,
    source_id: sourceId
  };
}

function stampApplyTraceOnEntry(publicEntry, trace, appliedAt) {
  if (!publicEntry || !trace) {
    return publicEntry;
  }

  publicEntry.apply_trace = {
    apply_id: trace.apply_id || null,
    review_id: trace.review_id || null,
    change_id: trace.change_id || null,
    source_id: trace.source_id || publicEntry.source_id || null,
    applied_at: appliedAt || new Date().toISOString()
  };
  return publicEntry;
}

function buildAuditEntry(options) {
  options = options || {};
  const action = options.action;
  const status = options.status || "FAILED";
  const appliedAt = options.appliedAt || new Date().toISOString();
  const trace = options.trace || {};

  return {
    audit_id: options.auditId || buildAuditId(options.applyId, action),
    apply_id: options.applyId || null,
    information_id: options.informationId || null,
    action: action,
    before: options.before || {},
    after: options.after || {},
    approved_source: options.approvedSource || "",
    applied_at: appliedAt,
    status: status,
    trace: {
      review_id: trace.review_id || null,
      change_id: trace.change_id || null,
      source_id: trace.source_id || null
    }
  };
}

function validateAuditEntry(entry, index) {
  const errors = [];
  const label = "audit_entries[" + index + "]";

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  [
    "audit_id",
    "apply_id",
    "information_id",
    "action",
    "approved_source",
    "applied_at",
    "status"
  ].forEach(function (field) {
    if (!entry[field]) {
      errors.push(label + ": missing " + field);
    }
  });

  if (AUDIT_ACTIONS.indexOf(entry.action) === -1) {
    errors.push(label + ": invalid action " + entry.action);
  }
  if (AUDIT_STATUSES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }
  if (!entry.before || typeof entry.before !== "object") {
    errors.push(label + ": before must be an object");
  }
  if (!entry.after || typeof entry.after !== "object") {
    errors.push(label + ": after must be an object");
  }
  if (!entry.trace || typeof entry.trace !== "object") {
    errors.push(label + ": trace must be an object");
  }

  return errors;
}

function validateAuditLog(auditLog) {
  const errors = [];

  if (!auditLog || auditLog.version !== "1.0") {
    errors.push("audit log version must be 1.0");
  }
  if (auditLog.AUTO_PUBLISH !== false || auditLog.auto_publish !== false) {
    errors.push("audit log AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(auditLog.audit_entries)) {
    errors.push("audit_entries must be an array");
    return errors;
  }
  if (
    auditLog.audit_entry_count !== undefined &&
    auditLog.audit_entry_count !== auditLog.audit_entries.length
  ) {
    errors.push("audit_entry_count mismatch");
  }

  const ids = new Set();
  auditLog.audit_entries.forEach(function (entry, index) {
    errors.push.apply(errors, validateAuditEntry(entry, index));
    if (entry.audit_id) {
      if (ids.has(entry.audit_id)) {
        errors.push("duplicate audit_id: " + entry.audit_id);
      }
      ids.add(entry.audit_id);
    }
  });

  return errors;
}

function validatePublicVersion(versionPayload) {
  const errors = [];

  if (!versionPayload || versionPayload.version !== "1.0") {
    errors.push("public version version must be 1.0");
  }
  if (versionPayload.AUTO_PUBLISH !== false || versionPayload.auto_publish !== false) {
    errors.push("public version AUTO_PUBLISH must be false");
  }
  if (!versionPayload.current || typeof versionPayload.current !== "object") {
    errors.push("public version current missing");
    return errors;
  }

  ["version_id", "created_at", "item_count", "apply_count"].forEach(function (field) {
    if (
      versionPayload.current[field] === undefined ||
      versionPayload.current[field] === null
    ) {
      errors.push("public version current missing " + field);
    }
  });

  if (!Array.isArray(versionPayload.history)) {
    errors.push("public version history must be an array");
  }

  return errors;
}

function loadAuditLog(options) {
  options = options || {};
  return readJson(options.inputPath || AUDIT_LOG_FILE, createEmptyAuditLog());
}

function writeAuditLog(auditLog, options) {
  options = options || {};
  const outputPath = options.outputPath || AUDIT_LOG_FILE;
  auditLog.generated_at = new Date().toISOString();
  auditLog.audit_entry_count = auditLog.audit_entries.length;
  writeJson(outputPath, auditLog);
  return outputPath;
}

function appendAuditEntry(auditLog, entry) {
  auditLog.audit_entries.push(entry);
  auditLog.audit_entry_count = auditLog.audit_entries.length;
  return entry;
}

function loadPublicVersion(options) {
  options = options || {};
  return readJson(options.inputPath || PUBLIC_VERSION_FILE, createEmptyPublicVersion());
}

function writePublicVersion(versionPayload, options) {
  options = options || {};
  const outputPath = options.outputPath || PUBLIC_VERSION_FILE;
  versionPayload.generated_at = new Date().toISOString();
  writeJson(outputPath, versionPayload);
  return outputPath;
}

function recordPublicVersionSnapshot(versionPayload, publicPayload, appliedCount) {
  const itemCount = (publicPayload && publicPayload.informations
    ? publicPayload.informations.length
    : 0);
  const previousApplyCount =
    (versionPayload.current && versionPayload.current.apply_count) || 0;
  const applyCount = previousApplyCount + (appliedCount || 0);
  const createdAt = new Date().toISOString();
  const current = {
    version_id: buildVersionId(itemCount, applyCount),
    created_at: createdAt,
    item_count: itemCount,
    apply_count: applyCount
  };

  versionPayload.current = current;
  versionPayload.history = versionPayload.history || [];
  versionPayload.history.push(Object.assign({}, current));
  return current;
}

function findPublicEntryByInformationId(payload, informationId) {
  return (payload.informations || []).find(function (entry) {
    return entry.information_id === informationId;
  });
}

function buildBeforeAfterForApply(action, publicPayload, reviewItem, applyResult) {
  const reviewBefore = extractPublicSnapshot(reviewItem && reviewItem.before);
  const reviewAfter = extractPublicSnapshot(reviewItem && reviewItem.after);
  const informationId =
    (reviewItem && reviewItem.information_id) ||
    (applyResult && applyResult.entry && applyResult.entry.information_id);

  if (action === "ADD") {
    return {
      before: {},
      after:
        applyResult && applyResult.ok
          ? extractPublicSnapshot(applyResult.entry)
          : reviewAfter
    };
  }

  const existing = findPublicEntryByInformationId(publicPayload, informationId);
  const beforeSnapshot = extractPublicSnapshot(existing);

  if (action === "UPDATE") {
    return {
      before:
        Object.keys(beforeSnapshot).length > 0
          ? beforeSnapshot
          : reviewBefore,
      after:
        applyResult && applyResult.ok
          ? extractPublicSnapshot(applyResult.entry)
          : reviewAfter
    };
  }

  if (action === "EXPIRE") {
    return {
      before:
        Object.keys(beforeSnapshot).length > 0
          ? beforeSnapshot
          : reviewBefore,
      after:
        applyResult && applyResult.ok
          ? extractPublicSnapshot(applyResult.entry)
          : Object.assign({}, beforeSnapshot, reviewAfter, { status: "EXPIRED" })
    };
  }

  return {
    before: reviewBefore,
    after: reviewAfter
  };
}

function recordApplyAuditEntry(options) {
  options = options || {};
  const auditLog = options.auditLog || createEmptyAuditLog();
  const queueItem = options.queueItem;
  const reviewItem = options.reviewItem;
  const applyResult = options.applyResult || {};
  const publicPayload = options.publicPayload || { informations: [] };
  const appliedAt = options.appliedAt || new Date().toISOString();
  const trace = buildApplyTrace(queueItem, reviewItem);
  const beforeAfter = buildBeforeAfterForApply(
    queueItem.action,
    publicPayload,
    reviewItem,
    applyResult
  );

  const entry = buildAuditEntry({
    applyId: queueItem.apply_id,
    informationId: queueItem.information_id,
    action: queueItem.action,
    before: beforeAfter.before,
    after: beforeAfter.after,
    approvedSource: queueItem.approved_source,
    appliedAt: appliedAt,
    status: applyResult.ok ? "SUCCESS" : "FAILED",
    trace: trace
  });

  appendAuditEntry(auditLog, entry);
  return {
    auditEntry: entry,
    auditLog: auditLog,
    trace: trace
  };
}

function resolveApplyTraceChain(auditLog, informationId) {
  const entries = (auditLog.audit_entries || []).filter(function (entry) {
    return entry.information_id === informationId && entry.status === "SUCCESS";
  });

  return entries.map(function (entry) {
    return {
      information_id: entry.information_id,
      apply_id: entry.apply_id,
      review_id: entry.trace && entry.trace.review_id,
      change_id: entry.trace && entry.trace.change_id,
      source_id: entry.trace && entry.trace.source_id,
      action: entry.action,
      applied_at: entry.applied_at
    };
  });
}

function findAuditEntryByApplyId(auditLog, applyId) {
  return (auditLog.audit_entries || []).find(function (entry) {
    return entry.apply_id === applyId;
  });
}

module.exports = {
  AUTO_PUBLISH,
  AUDIT_LOG_FILE,
  PUBLIC_VERSION_FILE,
  AUDIT_ACTIONS,
  AUDIT_STATUSES,
  SNAPSHOT_FIELDS,
  buildAuditId,
  buildVersionId,
  createEmptyAuditLog,
  createEmptyPublicVersion,
  extractPublicSnapshot,
  buildApplyTrace,
  stampApplyTraceOnEntry,
  buildAuditEntry,
  validateAuditEntry,
  validateAuditLog,
  validatePublicVersion,
  loadAuditLog,
  writeAuditLog,
  appendAuditEntry,
  loadPublicVersion,
  writePublicVersion,
  recordPublicVersionSnapshot,
  buildBeforeAfterForApply,
  recordApplyAuditEntry,
  resolveApplyTraceChain,
  findAuditEntryByApplyId
};
