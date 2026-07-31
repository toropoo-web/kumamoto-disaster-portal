"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const { AUTO_PUBLISH } = require("./support-service-discovery-engine");
const {
  loadSupportServiceChangeReviewQueue,
  CHANGE_REVIEW_QUEUE_FILE
} = require("./support-service-change-queue");
const { isApplyReadyReviewItem } = require("./support-service-change-review");
const {
  loadAuditLog,
  writeAuditLog,
  loadPublicVersion,
  writePublicVersion,
  recordApplyAuditEntry,
  recordPublicVersionSnapshot,
  stampApplyTraceOnEntry,
  createEmptyAuditLog,
  createEmptyPublicVersion,
  AUDIT_LOG_FILE,
  PUBLIC_VERSION_FILE
} = require("./support-service-public-audit");

const ROOT = path.join(__dirname, "..");
const APPLY_QUEUE_FILE = path.join(
  ROOT,
  "data",
  "support_service_discovery",
  "support_service_apply_queue.json"
);
const PUBLIC_INFORMATION_FILE = path.join(ROOT, "data", "public", "support_information.json");
const DISASTER_SOURCES_FILE = path.join(ROOT, "data", "disaster_sources.json");

const APPLY_ACTIONS = ["ADD", "UPDATE", "EXPIRE"];
const APPLY_STATUSES = ["PENDING", "APPLIED", "FAILED"];
const UPDATE_FIELDS = [
  "title",
  "facility_name",
  "address",
  "available_from",
  "available_until",
  "status"
];
const TRACE_UPDATE_FIELDS = ["source_type", "detected_keywords", "source_trace", "source_url"];
const PUBLIC_REQUIRED_FIELDS = [
  "information_id",
  "category",
  "subcategory",
  "title",
  "source_id",
  "status",
  "published_at",
  "checked_at"
];

const CHANGE_TYPE_TO_ACTION = {
  NEW: "ADD",
  UPDATED: "UPDATE",
  ENDED: "EXPIRE"
};

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

function buildApplyId(informationId, action) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = crypto
    .createHash("sha256")
    .update([informationId || "", action || ""].join("|"))
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return "SSAPL-" + stamp + "-" + suffix;
}

function mapChangeTypeToAction(changeType) {
  return CHANGE_TYPE_TO_ACTION[changeType] || null;
}

function toPublicInformationEntry(information) {
  if (!information) {
    return null;
  }

  const entry = {
    information_id: information.information_id,
    category: "SUPPORT_SERVICE",
    subcategory: information.subcategory || null,
    subcategory_detail: information.subcategory_detail || null,
    title: information.title,
    facility_name: information.facility_name || null,
    address: information.address || null,
    municipality: information.municipality || null,
    opening_type: information.opening_type || null,
    published_at: information.published_at,
    available_from: information.available_from,
    available_until: information.available_until,
    status: information.status,
    source_id: information.source_id,
    checked_at: information.checked_at
  };

  if (information.source_url) {
    entry.source_url = information.source_url;
  }
  if (information.source_type) {
    entry.source_type = information.source_type;
  }
  if (Array.isArray(information.detected_keywords) && information.detected_keywords.length) {
    entry.detected_keywords = information.detected_keywords.slice();
  }
  if (information.source_trace && typeof information.source_trace === "object") {
    entry.source_trace = {
      platform: information.source_trace.platform || information.source_type || "",
      account: information.source_trace.account || "",
      post_url: information.source_trace.post_url || "",
      detected_keywords: Array.isArray(information.source_trace.detected_keywords)
        ? information.source_trace.detected_keywords.slice()
        : entry.detected_keywords || []
    };
    if (
      (!entry.detected_keywords || !entry.detected_keywords.length) &&
      entry.source_trace.detected_keywords.length
    ) {
      entry.detected_keywords = entry.source_trace.detected_keywords.slice();
    }
  }

  return entry;
}

function validatePublicInformationEntry(entry, label) {
  const errors = [];
  const prefix = label || "information";

  if (!entry || typeof entry !== "object") {
    errors.push(prefix + ": entry missing");
    return errors;
  }

  PUBLIC_REQUIRED_FIELDS.forEach(function (field) {
    if (!entry[field]) {
      errors.push(prefix + ": missing " + field);
    }
  });

  if (entry.category !== "SUPPORT_SERVICE") {
    errors.push(prefix + ": category must be SUPPORT_SERVICE");
  }

  return errors;
}

function validateSupportServiceApplyEntry(entry, index) {
  const label = "items[" + index + "]";
  const errors = [];

  if (!entry || typeof entry !== "object") {
    errors.push(label + ": entry missing");
    return errors;
  }

  ["apply_id", "information_id", "action", "approved_at", "approved_source", "status"].forEach(
    function (field) {
      if (!entry[field]) {
        errors.push(label + ": missing " + field);
      }
    }
  );

  if (APPLY_ACTIONS.indexOf(entry.action) === -1) {
    errors.push(label + ": invalid action " + entry.action);
  }
  if (APPLY_STATUSES.indexOf(entry.status) === -1) {
    errors.push(label + ": invalid status " + entry.status);
  }

  return errors;
}

function validateSupportServiceApplyQueue(queue) {
  const errors = [];

  if (!queue || queue.version !== "1.0") {
    errors.push("apply queue version must be 1.0");
  }
  if (queue.category !== "SUPPORT_SERVICE") {
    errors.push("apply queue category must be SUPPORT_SERVICE");
  }
  if (queue.AUTO_PUBLISH !== false || queue.auto_publish !== false) {
    errors.push("apply queue AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(queue.items)) {
    errors.push("apply queue items must be an array");
    return errors;
  }
  if (queue.item_count !== queue.items.length) {
    errors.push("apply queue item_count mismatch");
  }

  const ids = new Set();
  queue.items.forEach(function (entry, index) {
    errors.push.apply(errors, validateSupportServiceApplyEntry(entry, index));
    if (entry.apply_id) {
      if (ids.has(entry.apply_id)) {
        errors.push("duplicate apply_id: " + entry.apply_id);
      }
      ids.add(entry.apply_id);
    }
  });

  return errors;
}

function validatePublicSupportInformation(payload) {
  const errors = [];

  if (!payload || payload.version !== "1.0") {
    errors.push("public support information version must be 1.0");
  }
  if (payload.category !== "SUPPORT_SERVICE") {
    errors.push("public support information category must be SUPPORT_SERVICE");
  }
  if (payload.AUTO_PUBLISH !== false || payload.auto_publish !== false) {
    errors.push("public support information AUTO_PUBLISH must be false");
  }
  if (!Array.isArray(payload.informations)) {
    errors.push("public support information informations must be an array");
    return errors;
  }
  if (payload.information_count !== payload.informations.length) {
    errors.push("public support information information_count mismatch");
  }

  const ids = new Set();
  payload.informations.forEach(function (entry, index) {
    errors.push.apply(
      errors,
      validatePublicInformationEntry(entry, "informations[" + index + "]")
    );
    if (entry.information_id) {
      if (ids.has(entry.information_id)) {
        errors.push("duplicate information_id: " + entry.information_id);
      }
      ids.add(entry.information_id);
    }
  });

  return errors;
}

function createEmptyApplyQueue() {
  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: 0,
    status_summary: {
      PENDING: 0,
      APPLIED: 0,
      FAILED: 0
    },
    source_review_queue_file:
      "data/review/support_service/support_service_change_review_queue.json",
    items: []
  };
}

function createEmptyPublicSupportInformation() {
  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    information_count: 0,
    informations: []
  };
}

function summarizeApplyStatuses(items) {
  const summary = {
    PENDING: 0,
    APPLIED: 0,
    FAILED: 0
  };
  (items || []).forEach(function (item) {
    summary[item.status] = (summary[item.status] || 0) + 1;
  });
  return summary;
}

function loadApplyQueue(options) {
  options = options || {};
  return readJson(
    options.applyQueuePath || options.inputPath || APPLY_QUEUE_FILE,
    createEmptyApplyQueue()
  );
}

function writeApplyQueue(queue, options) {
  options = options || {};
  const outputPath = options.applyQueuePath || options.outputPath || APPLY_QUEUE_FILE;
  queue.generated_at = new Date().toISOString();
  queue.status_summary = summarizeApplyStatuses(queue.items);
  queue.item_count = queue.items.length;
  writeJson(outputPath, queue);
  return outputPath;
}

function loadPublicSupportInformation(options) {
  options = options || {};
  return readJson(
    options.publicInformationPath || options.inputPath || PUBLIC_INFORMATION_FILE,
    createEmptyPublicSupportInformation()
  );
}

function writePublicSupportInformation(payload, options) {
  options = options || {};
  const outputPath =
    options.publicInformationPath || options.outputPath || PUBLIC_INFORMATION_FILE;
  payload.generated_at = new Date().toISOString();
  payload.information_count = payload.informations.length;
  writeJson(outputPath, payload);
  return outputPath;
}

function buildApplyQueueItemFromReviewItem(reviewItem, options) {
  options = options || {};
  const action = mapChangeTypeToAction(reviewItem.change_type);
  if (!action) {
    return null;
  }

  const approvedAt =
    (reviewItem.decision && reviewItem.decision.reviewed_at) ||
    options.approvedAt ||
    new Date().toISOString();

  return {
    apply_id: buildApplyId(reviewItem.information_id, action),
    information_id: reviewItem.information_id,
    action: action,
    approved_at: approvedAt,
    approved_source:
      options.approvedSourcePrefix ||
      "support_service_change_review_queue:" + reviewItem.queue_id,
    status: "PENDING",
    change_id: reviewItem.change_id,
    queue_id: reviewItem.queue_id,
    change_type: reviewItem.change_type
  };
}

function buildSupportServiceApplyQueue(reviewQueue, options) {
  options = options || {};
  const existingQueue = options.existingQueue || createEmptyApplyQueue();
  const existingKeys = new Set(
    (existingQueue.items || []).map(function (item) {
      return [item.information_id, item.action, item.queue_id || ""].join("|");
    })
  );

  const newItems = (reviewQueue.items || [])
    .filter(function (item) {
      return isApplyReadyReviewItem(item);
    })
    .map(function (item) {
      return buildApplyQueueItemFromReviewItem(item, options);
    })
    .filter(function (item) {
      if (!item) {
        return false;
      }
      const key = [item.information_id, item.action, item.queue_id || ""].join("|");
      if (existingKeys.has(key)) {
        return false;
      }
      existingKeys.add(key);
      return true;
    });

  const items = (existingQueue.items || []).concat(newItems);

  return {
    version: "1.0",
    category: "SUPPORT_SERVICE",
    generated_at: new Date().toISOString(),
    AUTO_PUBLISH: AUTO_PUBLISH,
    auto_publish: AUTO_PUBLISH,
    item_count: items.length,
    status_summary: summarizeApplyStatuses(items),
    source_review_queue_file:
      options.reviewQueueFile ||
      "data/review/support_service/support_service_change_review_queue.json",
    items: items
  };
}

function findReviewItemByQueueId(reviewQueue, queueId) {
  return (reviewQueue.items || []).find(function (item) {
    return item.queue_id === queueId || item.review_id === queueId;
  });
}

function findPublicInformationIndex(payload, informationId) {
  return (payload.informations || []).findIndex(function (entry) {
    return entry.information_id === informationId;
  });
}

function clonePublicPayload(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function buildInformationFromReviewItem(reviewItem, informationLookup) {
  informationLookup = informationLookup || {};
  const base = informationLookup[reviewItem.information_id] || {};
  const after = reviewItem.after || {};
  return {
    information_id: reviewItem.information_id,
    source_id: after.source_id || base.source_id || reviewItem.source_id || null,
    category: "SUPPORT_SERVICE",
    subcategory: after.subcategory || base.subcategory || null,
    subcategory_detail: after.subcategory_detail || base.subcategory_detail || null,
    title: after.title || base.title,
    facility_name: after.facility_name || base.facility_name || null,
    address: after.address || base.address || null,
    municipality: after.municipality || base.municipality || null,
    opening_type: after.opening_type || base.opening_type || null,
    published_at:
      after.published_at ||
      base.published_at ||
      after.available_from ||
      base.available_from ||
      new Date().toISOString(),
    available_from: after.available_from || base.available_from,
    available_until: after.available_until || base.available_until,
    checked_at:
      (reviewItem.checked_at && reviewItem.checked_at.current_checked_at) ||
      after.checked_at ||
      base.checked_at ||
      new Date().toISOString(),
    status: after.status || base.status || "ACTIVE",
    source_url: base.source_url || after.source_url || null,
    source_type: base.source_type || null,
    detected_keywords: base.detected_keywords || null,
    source_trace: base.source_trace || null
  };
}

function applyAddEntry(payload, information) {
  const publicEntry = toPublicInformationEntry(information);
  const validationErrors = validatePublicInformationEntry(publicEntry, "apply.ADD");
  if (validationErrors.length) {
    return { ok: false, errors: validationErrors };
  }

  const existingIndex = findPublicInformationIndex(payload, publicEntry.information_id);
  if (existingIndex !== -1) {
    return {
      ok: false,
      errors: ["apply.ADD: information_id already exists: " + publicEntry.information_id]
    };
  }

  payload.informations.push(publicEntry);
  return { ok: true, entry: publicEntry };
}

function applyUpdateEntry(payload, information) {
  const publicEntry = toPublicInformationEntry(information);
  const validationErrors = validatePublicInformationEntry(publicEntry, "apply.UPDATE");
  if (validationErrors.length) {
    return { ok: false, errors: validationErrors };
  }

  const existingIndex = findPublicInformationIndex(payload, publicEntry.information_id);
  if (existingIndex === -1) {
    return {
      ok: false,
      errors: ["apply.UPDATE: information_id not found: " + publicEntry.information_id]
    };
  }

  const current = payload.informations[existingIndex];
  UPDATE_FIELDS.forEach(function (field) {
    if (publicEntry[field] !== undefined && publicEntry[field] !== null) {
      current[field] = publicEntry[field];
    }
  });
  TRACE_UPDATE_FIELDS.forEach(function (field) {
    if (publicEntry[field] !== undefined && publicEntry[field] !== null) {
      current[field] = publicEntry[field];
    }
  });
  current.checked_at = publicEntry.checked_at;
  return { ok: true, entry: current };
}

function applyExpireEntry(payload, information) {
  const existingIndex = findPublicInformationIndex(payload, information.information_id);
  if (existingIndex === -1) {
    return {
      ok: false,
      errors: ["apply.EXPIRE: information_id not found: " + information.information_id]
    };
  }

  const current = payload.informations[existingIndex];
  current.status = "EXPIRED";
  if (information.available_until) {
    current.available_until = information.available_until;
  }
  current.checked_at = information.checked_at || new Date().toISOString();
  return { ok: true, entry: current };
}

function applySupportServiceQueueItem(queueItem, payload, reviewQueue, informationLookup) {
  if (queueItem.status !== "PENDING") {
    return {
      ok: false,
      skipped: true,
      reason: "status is not PENDING"
    };
  }

  const reviewItem = findReviewItemByQueueId(reviewQueue, queueItem.queue_id);
  if (!reviewItem) {
    return {
      ok: false,
      errors: ["review item not found for queue_id: " + queueItem.queue_id]
    };
  }
  if (!isApplyReadyReviewItem(reviewItem)) {
    return {
      ok: false,
      errors: ["review item is not apply-ready: " + reviewItem.status]
    };
  }

  const information = buildInformationFromReviewItem(reviewItem, informationLookup);

  if (queueItem.action === "ADD") {
    return applyAddEntry(payload, information);
  }
  if (queueItem.action === "UPDATE") {
    return applyUpdateEntry(payload, information);
  }
  if (queueItem.action === "EXPIRE") {
    information.status = "EXPIRED";
    return applyExpireEntry(payload, information);
  }

  return {
    ok: false,
    errors: ["unsupported action: " + queueItem.action]
  };
}

function buildInformationLookup(candidatesPayload) {
  const lookup = {};
  (candidatesPayload.informations || []).forEach(function (entry) {
    lookup[entry.information_id] = entry;
  });
  return lookup;
}

function applySupportServicePublicUpdates(options) {
  options = options || {};

  const applyQueue = loadApplyQueue(options);
  const reviewQueue = loadSupportServiceChangeReviewQueue({
    inputPath: options.reviewQueuePath
  });
  const payload = loadPublicSupportInformation(options);
  const payloadBeforeApply = clonePublicPayload(payload);
  const candidatesPayload = readJson(
    options.candidatesPath ||
      path.join(ROOT, "data", "support_service_discovery", "support_information_candidates.json"),
    { informations: [] }
  );
  const informationLookup = buildInformationLookup(candidatesPayload);
  const dryRun = options.dryRun === true;
  const auditLog = loadAuditLog({
    inputPath: options.auditLogPath || AUDIT_LOG_FILE
  });
  const versionPayload = loadPublicVersion({
    inputPath: options.publicVersionPath || PUBLIC_VERSION_FILE
  });
  const auditEntries = [];

  const queueErrors = validateSupportServiceApplyQueue(applyQueue);
  if (queueErrors.length) {
    return {
      ok: false,
      AUTO_PUBLISH: AUTO_PUBLISH,
      errors: queueErrors,
      appliedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      auditEntryCount: 0
    };
  }

  const results = [];
  let appliedCount = 0;
  let failedCount = 0;
  let skippedCount = 0;

  applyQueue.items.forEach(function (queueItem) {
    if (queueItem.status !== "PENDING") {
      skippedCount += 1;
      results.push({
        apply_id: queueItem.apply_id,
        status: queueItem.status,
        skipped: true
      });
      return;
    }

    const reviewItem = findReviewItemByQueueId(reviewQueue, queueItem.queue_id);
    const applyResult = applySupportServiceQueueItem(
      queueItem,
      payload,
      reviewQueue,
      informationLookup
    );
    if (applyResult.skipped) {
      skippedCount += 1;
      results.push({
        apply_id: queueItem.apply_id,
        skipped: true,
        reason: applyResult.reason
      });
      return;
    }

    const appliedAt = new Date().toISOString();
    const auditRecord = recordApplyAuditEntry({
      auditLog: auditLog,
      queueItem: queueItem,
      reviewItem: reviewItem,
      applyResult: applyResult,
      publicPayload: payloadBeforeApply,
      appliedAt: appliedAt
    });
    auditEntries.push(auditRecord.auditEntry);

    if (!applyResult.ok) {
      queueItem.status = "FAILED";
      failedCount += 1;
      results.push({
        apply_id: queueItem.apply_id,
        status: "FAILED",
        errors: applyResult.errors,
        audit_id: auditRecord.auditEntry.audit_id
      });
      return;
    }

    if (applyResult.entry) {
      stampApplyTraceOnEntry(applyResult.entry, auditRecord.trace, appliedAt);
    }

    queueItem.status = "APPLIED";
    queueItem.applied_at = appliedAt;
    appliedCount += 1;
    results.push({
      apply_id: queueItem.apply_id,
      status: "APPLIED",
      information_id: queueItem.information_id,
      action: queueItem.action,
      audit_id: auditRecord.auditEntry.audit_id,
      trace: auditRecord.trace
    });
  });

  payload.information_count = payload.informations.length;
  const publicErrors = validatePublicSupportInformation(payload);
  if (appliedCount > 0 && publicErrors.length) {
    return {
      ok: false,
      AUTO_PUBLISH: AUTO_PUBLISH,
      errors: publicErrors,
      appliedCount: appliedCount,
      failedCount: failedCount,
      skippedCount: skippedCount,
      auditEntryCount: auditEntries.length,
      results: results
    };
  }

  if (!dryRun) {
    if (auditEntries.length > 0) {
      writeAuditLog(auditLog, { outputPath: options.auditLogPath || AUDIT_LOG_FILE });
    }
    if (appliedCount > 0) {
      recordPublicVersionSnapshot(versionPayload, payload, appliedCount);
      writePublicVersion(versionPayload, {
        outputPath: options.publicVersionPath || PUBLIC_VERSION_FILE
      });
      writePublicSupportInformation(payload, options);
      writeApplyQueue(applyQueue, options);
    } else if (failedCount > 0) {
      writeApplyQueue(applyQueue, options);
    }
  }

  return {
    ok: failedCount === 0 && publicErrors.length === 0,
    AUTO_PUBLISH: AUTO_PUBLISH,
    appliedCount: appliedCount,
    failedCount: failedCount,
    skippedCount: skippedCount,
    auditEntryCount: auditEntries.length,
    publicInformationPath: PUBLIC_INFORMATION_FILE,
    applyQueuePath: APPLY_QUEUE_FILE,
    auditLogPath: options.auditLogPath || AUDIT_LOG_FILE,
    publicVersionPath: options.publicVersionPath || PUBLIC_VERSION_FILE,
    informationCount: payload.informations.length,
    results: results,
    errors: publicErrors
  };
}

function seedPublicSupportInformationFromCandidates(candidatesPayload, options) {
  options = options || {};
  const payload = createEmptyPublicSupportInformation();
  (candidatesPayload.informations || []).forEach(function (information) {
    const entry = toPublicInformationEntry(information);
    const errors = validatePublicInformationEntry(entry, "seed");
    if (!errors.length) {
      payload.informations.push(entry);
    }
  });
  payload.information_count = payload.informations.length;
  if (!options.dryRun) {
    writePublicSupportInformation(payload, options);
  }
  return payload;
}

function seedPublicSupportInformationFromRegistry(options) {
  options = options || {};
  const disasterSources = readJson(options.disasterSourcesPath || DISASTER_SOURCES_FILE, {
    sources: []
  });
  const payload = createEmptyPublicSupportInformation();
  const titleBySubcategory = {
    BATH: "無料シャワー",
    SPACE: "休憩スペース",
    TOILET: "トイレ",
    VEHICLE: "車中泊支援",
    FOOD: "炊き出し"
  };

  (disasterSources.sources || []).forEach(function (source) {
    if (!source || source.category !== "SUPPORT_SERVICE") {
      return;
    }
    if (source.official !== true || source.active !== true || !source.url) {
      return;
    }

    const entry = toPublicInformationEntry({
      information_id:
        "SSINF-" +
        crypto
          .createHash("sha256")
          .update(source.source_id)
          .digest("hex")
          .slice(0, 8)
          .toUpperCase(),
      source_id: source.source_id,
      subcategory: source.subcategory,
      title:
        titleBySubcategory[source.subcategory] ||
        source.facility_name ||
        source.organization,
      facility_name: source.facility_name || source.organization,
      address: source.address || null,
      opening_type: source.opening_type || null,
      published_at: source.available_from || "2026-07-28",
      available_from: source.available_from || "2026-07-28",
      available_until: source.available_until || "UNKNOWN",
      status: "ACTIVE",
      checked_at: source.available_from
        ? source.available_from + "T00:00:00.000Z"
        : new Date().toISOString(),
      source_url: source.url
    });

    const errors = validatePublicInformationEntry(entry, "seed");
    if (!errors.length) {
      payload.informations.push(entry);
    }
  });

  payload.information_count = payload.informations.length;
  if (!options.dryRun) {
    writePublicSupportInformation(payload, options);
  }
  return payload;
}

module.exports = {
  AUTO_PUBLISH,
  APPLY_QUEUE_FILE,
  PUBLIC_INFORMATION_FILE,
  CHANGE_REVIEW_QUEUE_FILE,
  AUDIT_LOG_FILE,
  PUBLIC_VERSION_FILE,
  APPLY_ACTIONS,
  APPLY_STATUSES,
  UPDATE_FIELDS,
  PUBLIC_REQUIRED_FIELDS,
  CHANGE_TYPE_TO_ACTION,
  buildApplyId,
  mapChangeTypeToAction,
  toPublicInformationEntry,
  validatePublicInformationEntry,
  validateSupportServiceApplyEntry,
  validateSupportServiceApplyQueue,
  validatePublicSupportInformation,
  createEmptyApplyQueue,
  createEmptyPublicSupportInformation,
  loadApplyQueue,
  writeApplyQueue,
  loadPublicSupportInformation,
  writePublicSupportInformation,
  buildApplyQueueItemFromReviewItem,
  buildSupportServiceApplyQueue,
  applySupportServiceQueueItem,
  applySupportServicePublicUpdates,
  seedPublicSupportInformationFromCandidates,
  seedPublicSupportInformationFromRegistry
};
