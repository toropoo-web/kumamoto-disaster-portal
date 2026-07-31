"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const GATE_OUTPUT_DIR = path.join(ROOT, "data", "public_update_gate");
const APPLY_DIR = path.join(ROOT, "data", "public_update_apply");
const APPLY_QUEUE_FILE = path.join(APPLY_DIR, "public_update_apply_queue.json");
const APPLY_HISTORY_FILE = path.join(APPLY_DIR, "apply_history.json");
const DIFF_DIR = path.join(APPLY_DIR, "diff");

const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
const APPLY_STATUSES = ["PENDING_APPLY", "APPLIED", "BLOCKED", "ROLLED_BACK"];
const OPERATIONS = ["ADD", "UPDATE"];

const { CATEGORY_TARGET_LAYERS, validatePublicCandidate } = require("./review-approved-converter");
const { MASTER_GATE_FILE } = require("./public-update-validation-gate");

const TARGET_LAYER_FILES = {
  water_search_index: path.join(ROOT, "data", "public", "water_search_index.json"),
  shelter_search_index: path.join(ROOT, "data", "public", "disaster_search_index.json"),
  communication_status: path.join(ROOT, "data", "public", "communication_status.json"),
  volunteer_search_index: path.join(ROOT, "data", "public", "disaster_search_index.json"),
  road_information: path.join(ROOT, "data", "public", "infrastructure_status.json"),
  support_information: path.join(ROOT, "data", "public", "phase1_updates.json")
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

function toRepoRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).split(path.sep).join("/");
}

function hashContent(value) {
  return crypto
    .createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

function buildIndexId(parts) {
  return (
    "DIDX-" +
    crypto
      .createHash("sha256")
      .update(parts.filter(Boolean).join("|"))
      .digest("hex")
      .slice(0, 12)
      .toUpperCase()
  );
}

function buildApplyId(updateId) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const suffix = String(updateId || "UNKNOWN")
    .replace(/^UPD-/, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .slice(0, 32);
  return "APL-" + stamp + "-" + suffix;
}

function copySourceTrace(sourceTrace) {
  if (!sourceTrace || typeof sourceTrace !== "object") {
    return {};
  }
  return JSON.parse(JSON.stringify(sourceTrace));
}

function buildSearchText(candidate) {
  return [
    "熊本県",
    candidate.municipality,
    candidate.title,
    (candidate.detected_keywords || []).join(" ")
  ]
    .filter(Boolean)
    .join(" ")
    .trim();
}

function buildWaterSearchItem(candidate) {
  return {
    item_kind: "registry",
    region: "熊本県",
    municipality: candidate.municipality,
    organization: candidate.municipality + "公式",
    location: candidate.title,
    title: candidate.title,
    search_text: buildSearchText(candidate),
    source_name: candidate.municipality + "公式",
    source_type: "official",
    source_url: candidate.source_url,
    updated_at: candidate.created_at || new Date().toISOString()
  };
}

function buildDisasterSearchItem(candidate) {
  const shelterKeywords = ["避難所", "開設", "閉鎖", "避難場所"];
  const keywords =
    candidate.category === "SHELTER"
      ? shelterKeywords
      : (candidate.detected_keywords || []).slice();
  const title =
    candidate.category === "SHELTER"
      ? candidate.title || candidate.municipality + " 避難所情報"
      : candidate.title;
  const searchCandidate = Object.assign({}, candidate, {
    title: title,
    detected_keywords: keywords
  });
  const item = {
    index_id: buildIndexId([
      candidate.category,
      candidate.municipality,
      candidate.source_url,
      candidate.update_id
    ]),
    category: candidate.category,
    prefecture: "熊本県",
    municipality: candidate.municipality,
    organization: candidate.municipality + "公式",
    title: title,
    content: buildSearchText(searchCandidate),
    keywords: keywords,
    source_type: "MUNICIPALITY",
    source_url: candidate.source_url,
    official: true,
    updated_at: candidate.created_at || new Date().toISOString()
  };

  if (candidate.category === "SHELTER") {
    item.area_id = candidate.area_id || null;
    item.source_id = candidate.source_id || null;
    item.status = "PENDING";
    item.source_trace = copySourceTrace(candidate.source_trace);
  }

  return item;
}

function buildSupportUpdateItem(candidate) {
  return {
    area_id: "KM000",
    area_name: candidate.municipality,
    public_category_id: "SUPPORT",
    public_category_label: "被災者支援",
    headline: candidate.title,
    summary:
      (candidate.source_trace && candidate.source_trace.changed_text) ||
      candidate.title,
    displayed_updated_at: candidate.created_at || new Date().toISOString(),
    source_name: candidate.municipality,
    source_url: candidate.source_url,
    department: candidate.municipality,
    verification_status: "VERIFIED",
    incident_scope: INCIDENT_SCOPE,
    collected_at: candidate.created_at || new Date().toISOString(),
    display_priority: 99
  };
}

function buildRoadInfrastructureItem(candidate) {
  return {
    status_id: "INF-STATUS-ROAD-PATROL-" + hashContent(candidate.update_id).slice(0, 8).toUpperCase(),
    area_id: "KM000",
    category: "ROAD",
    type: "STATUS",
    title: candidate.title,
    description:
      (candidate.source_trace && candidate.source_trace.changed_text) ||
      candidate.title,
    status: "CHECK_OFFICIAL",
    source_id: candidate.source_id,
    last_checked_at: candidate.created_at || new Date().toISOString(),
    source_updated_at: candidate.created_at || new Date().toISOString()
  };
}

function buildCommunicationProviderItem(candidate) {
  return {
    provider_id: "patrol-" + hashContent(candidate.update_id).slice(0, 8),
    provider_name: candidate.municipality + "通信情報",
    status: "CHECK_OFFICIAL",
    status_label: candidate.title,
    areas: [candidate.municipality],
    source_url: candidate.source_url,
    source_type: "official",
    last_checked: candidate.created_at || new Date().toISOString(),
    update_status: "確認済"
  };
}

function buildPublicItem(candidate) {
  const targetLayer = candidate.target_layer;
  if (targetLayer === "water_search_index") {
    return buildWaterSearchItem(candidate);
  }
  if (targetLayer === "shelter_search_index" || targetLayer === "volunteer_search_index") {
    return buildDisasterSearchItem(candidate);
  }
  if (targetLayer === "support_information") {
    return buildSupportUpdateItem(candidate);
  }
  if (targetLayer === "road_information") {
    return buildRoadInfrastructureItem(candidate);
  }
  if (targetLayer === "communication_status") {
    return buildCommunicationProviderItem(candidate);
  }
  return null;
}

function candidateCategoryFromLayer(targetLayer) {
  const mapping = {
    shelter_search_index: "SHELTER",
    volunteer_search_index: "VOLUNTEER"
  };
  return mapping[targetLayer] || null;
}

function findExistingBySourceUrl(targetLayer, publicData, sourceUrl, candidate) {
  if (!sourceUrl) {
    return null;
  }

  if (targetLayer === "water_search_index") {
    return (publicData.items || []).find(function (item) {
      return item.source_url === sourceUrl;
    });
  }

  if (targetLayer === "shelter_search_index" || targetLayer === "volunteer_search_index") {
    const category = candidateCategoryFromLayer(targetLayer);
    return (publicData.index || []).find(function (item) {
      return item.source_url === sourceUrl && item.category === category;
    });
  }

  if (targetLayer === "communication_status") {
    const providers = publicData.providers || [];
    const services = publicData.services || [];
    return (
      providers.find(function (item) {
        return item.source_url === sourceUrl;
      }) ||
      services.find(function (item) {
        return item.source_url === sourceUrl;
      }) ||
      null
    );
  }

  if (targetLayer === "road_information") {
    if (candidate && candidate.source_id) {
      return (publicData.items || []).find(function (item) {
        return item.source_id === candidate.source_id;
      });
    }
    return null;
  }

  if (targetLayer === "support_information") {
    const items = Array.isArray(publicData) ? publicData : [];
    return items.find(function (item) {
      return item.source_url === sourceUrl;
    });
  }

  return null;
}

function appendPublicItem(targetLayer, publicData, newItem) {
  const next = JSON.parse(JSON.stringify(publicData));

  if (targetLayer === "water_search_index") {
    next.items = next.items || [];
    next.items.push(newItem);
    next.item_count = next.items.length;
    next.last_updated = new Date().toISOString();
    return next;
  }

  if (targetLayer === "shelter_search_index" || targetLayer === "volunteer_search_index") {
    next.index = next.index || [];
    next.index.push(newItem);
    return next;
  }

  if (targetLayer === "communication_status") {
    next.providers = next.providers || [];
    next.providers.push(newItem);
    return next;
  }

  if (targetLayer === "road_information") {
    next.items = next.items || [];
    next.items.push(newItem);
    return next;
  }

  if (targetLayer === "support_information") {
    if (!Array.isArray(next)) {
      return [newItem];
    }
    next.push(newItem);
    return next;
  }

  return next;
}

function loadGateBatch(gatePath) {
  return readJson(gatePath || MASTER_GATE_FILE, null);
}

function extractPassCandidates(gateBatch) {
  const passMap = new Map();
  (gateBatch.results || []).forEach(function (result) {
    if (result.gate_status === "PASS" && result.candidate) {
      passMap.set(result.update_id, result);
    }
  });

  const passed = [];
  const rejected = [];

  (gateBatch.passedUpdates || []).forEach(function (candidate) {
    const gateResult = passMap.get(candidate.update_id);
    if (!gateResult) {
      rejected.push({
        update_id: candidate.update_id,
        reason: "missing PASS gate result"
      });
      return;
    }
    passed.push({
      candidate: candidate,
      gateResult: gateResult
    });
  });

  (gateBatch.failedUpdates || []).forEach(function (failed) {
    rejected.push({
      update_id: failed.update_id,
      reason: "gate FAIL"
    });
  });

  return { passed: passed, rejected: rejected };
}

function validateCandidateForApply(candidate, reviewStatus) {
  const errors = [];

  if (reviewStatus === "PENDING") {
    errors.push("PENDING updates cannot be applied");
  }
  if (reviewStatus === "REJECTED") {
    errors.push("REJECTED updates cannot be applied");
  }

  const schemaErrors = validatePublicCandidate(candidate);
  if (schemaErrors.length) {
    errors.push.apply(errors, schemaErrors);
  }

  if (candidate.status !== "READY") {
    errors.push("candidate status must be READY");
  }

  if (candidate.auto_publish !== false) {
    errors.push("auto_publish must be false");
  }

  if (!candidate.source_trace || !candidate.source_trace.queue_id) {
    errors.push("source_trace is required");
  }

  return errors;
}

function determineOperation(targetLayer, publicData, candidate) {
  const existing = findExistingBySourceUrl(
    targetLayer,
    publicData,
    candidate.source_url,
    candidate
  );
  if (existing) {
    return {
      operation: "UPDATE",
      allowed: false,
      reason: "existing public record found; overwrite not allowed",
      existing: existing
    };
  }
  return {
    operation: "ADD",
    allowed: true,
    reason: null,
    existing: null
  };
}

function buildApplyQueueItem(candidate, operationInfo, options) {
  options = options || {};
  return {
    apply_id: options.applyId || buildApplyId(candidate.update_id),
    update_id: candidate.update_id,
    category: candidate.category,
    target_layer: candidate.target_layer,
    operation: operationInfo.operation,
    status: operationInfo.allowed ? "PENDING_APPLY" : "BLOCKED",
    blocked_reason: operationInfo.allowed ? null : operationInfo.reason,
    source_trace: copySourceTrace(candidate.source_trace),
    candidate: candidate,
    diff_file: options.diffFile || null,
    created_at: options.createdAt || new Date().toISOString()
  };
}

function buildApplyDiff(applyItem, targetLayer, publicData, newItem, operationInfo, options) {
  options = options || {};
  const targetFile = options.targetFile || TARGET_LAYER_FILES[targetLayer];
  const beforeSnapshot = JSON.parse(JSON.stringify(publicData));
  const afterSnapshot =
    operationInfo.allowed && operationInfo.operation === "ADD"
      ? appendPublicItem(targetLayer, publicData, newItem)
      : beforeSnapshot;

  const changedFields = [];
  if (operationInfo.operation === "ADD" && operationInfo.allowed) {
    if (targetLayer === "water_search_index") {
      changedFields.push("items");
    } else if (targetLayer === "shelter_search_index" || targetLayer === "volunteer_search_index") {
      changedFields.push("index");
    } else if (targetLayer === "communication_status") {
      changedFields.push("providers");
    } else if (targetLayer === "road_information") {
      changedFields.push("items");
    } else if (targetLayer === "support_information") {
      changedFields.push("records");
    }
  }

  return {
    apply_id: applyItem.apply_id,
    update_id: applyItem.update_id,
    target: targetLayer,
    target_file: toRepoRelative(targetFile),
    operation: applyItem.operation,
    status: applyItem.status,
    before: beforeSnapshot,
    after: afterSnapshot,
    changed_fields: changedFields,
    before_hash: hashContent(beforeSnapshot),
    after_hash: hashContent(afterSnapshot),
    new_item: newItem,
    source_trace: copySourceTrace(applyItem.source_trace),
    rollback: {
      enabled: true,
      restore_file: toRepoRelative(targetFile),
      restore_content: beforeSnapshot,
      before_hash: hashContent(beforeSnapshot)
    }
  };
}

function validateApplyQueueItem(item) {
  const errors = [];
  const required = [
    "apply_id",
    "update_id",
    "category",
    "target_layer",
    "operation",
    "status",
    "source_trace"
  ];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(item, key)) {
      errors.push("missing apply queue field: " + key);
    }
  });

  if (APPLY_STATUSES.indexOf(item.status) < 0) {
    errors.push("invalid apply status: " + item.status);
  }

  if (OPERATIONS.indexOf(item.operation) < 0) {
    errors.push("invalid operation: " + item.operation);
  }

  if (!item.source_trace || !item.source_trace.queue_id) {
    errors.push("source_trace.queue_id is required");
  }

  return errors;
}

function validateApplyDiff(diff) {
  const errors = [];
  const required = [
    "apply_id",
    "update_id",
    "target",
    "before",
    "after",
    "changed_fields",
    "before_hash",
    "after_hash",
    "source_trace",
    "rollback"
  ];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(diff, key)) {
      errors.push("missing diff field: " + key);
    }
  });

  if (!diff.rollback || diff.rollback.enabled !== true) {
    errors.push("rollback metadata required");
  }

  if (!diff.source_trace || !diff.source_trace.queue_id) {
    errors.push("source_trace must be preserved in diff");
  }

  return errors;
}

function buildApplyQueueBatch(items, options) {
  options = options || {};
  return {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: INCIDENT_SCOPE,
    autoPublish: false,
    sourceGateFile: options.sourceGateFile || toRepoRelative(MASTER_GATE_FILE),
    itemCount: items.length,
    pendingCount: items.filter(function (item) {
      return item.status === "PENDING_APPLY";
    }).length,
    blockedCount: items.filter(function (item) {
      return item.status === "BLOCKED";
    }).length,
    items: items
  };
}

function writeApplyDiff(diff, options) {
  options = options || {};
  const diffDir = options.diffDir || DIFF_DIR;
  ensureDir(diffDir);
  const fileName = diff.apply_id + ".json";
  const outputPath = path.join(diffDir, fileName);
  writeJson(outputPath, diff);
  return toRepoRelative(outputPath);
}

function appendApplyHistory(entry, historyPath) {
  const targetHistoryPath = historyPath || APPLY_HISTORY_FILE;
  const history = readJson(targetHistoryPath, { version: 1, entries: [] });
  history.entries = history.entries || [];
  history.entries.push(entry);
  history.lastUpdatedAt = new Date().toISOString();
  writeJson(targetHistoryPath, history);
  return history;
}

function preparePublicUpdateApply(options) {
  options = options || {};
  const gatePath = options.gatePath || MASTER_GATE_FILE;
  const gateBatch = loadGateBatch(gatePath);

  if (!gateBatch) {
    return {
      prepared: false,
      reason: "gate file not found",
      errors: ["gate file not found"]
    };
  }

  if (gateBatch.autoPublish !== false) {
    return {
      prepared: false,
      reason: "autoPublish must be false",
      errors: ["autoPublish must be false"]
    };
  }

  const applyQueuePath = options.applyQueuePath || APPLY_QUEUE_FILE;
  const diffDir = options.diffDir || DIFF_DIR;
  const extracted = extractPassCandidates(gateBatch);
  const applyItems = [];
  const diffs = [];
  const errors = [];
  const rejected = extracted.rejected.slice();

  extracted.passed.forEach(function (entry) {
    const candidate = entry.candidate;
    const reviewStatus = options.reviewStatusMap && options.reviewStatusMap[candidate.update_id];
    const candidateErrors = validateCandidateForApply(candidate, reviewStatus);
    if (candidateErrors.length) {
      rejected.push({
        update_id: candidate.update_id,
        reason: candidateErrors.join("; ")
      });
      errors.push.apply(errors, candidateErrors.map(function (message) {
        return candidate.update_id + ": " + message;
      }));
      return;
    }

    const targetLayer = candidate.target_layer;
    const targetFile = options.targetFiles && options.targetFiles[targetLayer]
      ? options.targetFiles[targetLayer]
      : TARGET_LAYER_FILES[targetLayer];

    if (!targetFile || !fs.existsSync(targetFile)) {
      rejected.push({
        update_id: candidate.update_id,
        reason: "target public file missing: " + targetLayer
      });
      errors.push(candidate.update_id + ": target public file missing");
      return;
    }

    const publicData = readJson(targetFile, targetLayer === "support_information" ? [] : {});
    const newItem = buildPublicItem(candidate);
    if (!newItem) {
      rejected.push({
        update_id: candidate.update_id,
        reason: "unsupported target_layer: " + targetLayer
      });
      errors.push(candidate.update_id + ": unsupported target_layer");
      return;
    }

    const operationInfo = determineOperation(targetLayer, publicData, candidate);
    const applyId = buildApplyId(candidate.update_id);
    const applyItem = buildApplyQueueItem(candidate, operationInfo, {
      applyId: applyId,
      createdAt: options.createdAt
    });

    const diff = buildApplyDiff(applyItem, targetLayer, publicData, newItem, operationInfo, {
      targetFile: targetFile
    });
    const diffErrors = validateApplyDiff(diff);
    if (diffErrors.length) {
      errors.push.apply(errors, diffErrors);
      return;
    }

    if (!options.dryRun && options.writeDiffs !== false) {
      applyItem.diff_file = writeApplyDiff(diff, { diffDir: diffDir });
    } else {
      applyItem.diff_file = toRepoRelative(path.join(diffDir, applyId + ".json"));
    }

    applyItems.push(applyItem);
    diffs.push(diff);

    if (!operationInfo.allowed) {
      rejected.push({
        update_id: candidate.update_id,
        reason: operationInfo.reason
      });
    }
  });

  const queueBatch = buildApplyQueueBatch(applyItems, {
    generatedAt: options.createdAt,
    sourceGateFile: toRepoRelative(gatePath)
  });

  if (!options.dryRun) {
    ensureDir(path.dirname(applyQueuePath));
    writeJson(applyQueuePath, queueBatch);
    if (options.writeDiffs !== false) {
      diffs.forEach(function (diff) {
        writeApplyDiff(diff, { diffDir: diffDir });
      });
    }
  }

  return {
    prepared: true,
    dryRun: options.dryRun === true,
    confirmed: false,
    gatePath: gatePath,
    applyQueuePath: options.dryRun ? null : applyQueuePath,
    itemCount: applyItems.length,
    pendingCount: queueBatch.pendingCount,
    blockedCount: queueBatch.blockedCount,
    rejectedCount: rejected.length,
    rejected: rejected,
    applyItems: applyItems,
    diffs: diffs,
    errors: errors
  };
}

function confirmPublicUpdateApply(options) {
  options = options || {};
  const gatePath = options.gatePath || MASTER_GATE_FILE;
  const gateBatch = loadGateBatch(gatePath);
  const applyQueuePath = options.applyQueuePath || APPLY_QUEUE_FILE;
  const applyHistoryPath = options.applyHistoryPath || APPLY_HISTORY_FILE;
  const diffDir = options.diffDir || DIFF_DIR;
  const queueBatch = readJson(applyQueuePath, null);

  if (!gateBatch) {
    return { applied: false, reason: "gate file not found", errors: ["gate file not found"] };
  }
  if (!queueBatch || !Array.isArray(queueBatch.items) || !queueBatch.items.length) {
    return { applied: false, reason: "apply queue missing or empty", errors: ["apply queue missing"] };
  }

  const passIds = new Set((gateBatch.passedUpdates || []).map(function (item) {
    return item.update_id;
  }));
  const failIds = new Set((gateBatch.failedUpdates || []).map(function (item) {
    return item.update_id;
  }));

  const applied = [];
  const errors = [];

  queueBatch.items.forEach(function (applyItem) {
    if (applyItem.status !== "PENDING_APPLY") {
      return;
    }

    if (failIds.has(applyItem.update_id)) {
      errors.push(applyItem.update_id + ": gate FAIL cannot be applied");
      return;
    }

    if (!passIds.has(applyItem.update_id)) {
      errors.push(applyItem.update_id + ": not in gate PASS list");
      return;
    }

    if (applyItem.operation !== "ADD") {
      errors.push(applyItem.update_id + ": only ADD operations are allowed");
      return;
    }

    const diffPath = applyItem.diff_file
      ? path.isAbsolute(applyItem.diff_file)
        ? applyItem.diff_file
        : path.join(ROOT, applyItem.diff_file)
      : path.join(diffDir, applyItem.apply_id + ".json");

    if (!fs.existsSync(diffPath)) {
      errors.push(applyItem.update_id + ": diff file missing");
      return;
    }

    const diff = readJson(diffPath, null);
    const diffErrors = validateApplyDiff(diff);
    if (diffErrors.length) {
      errors.push.apply(errors, diffErrors.map(function (message) {
        return applyItem.update_id + ": " + message;
      }));
      return;
    }

    const targetFile = path.join(ROOT, diff.target_file);
    const currentData = readJson(targetFile, diff.target === "support_information" ? [] : {});
    const currentHash = hashContent(currentData);
    if (currentHash !== diff.before_hash) {
      errors.push(applyItem.update_id + ": before_hash mismatch; public data changed since diff generation");
      return;
    }

    if (!options.dryRun) {
      writeJson(targetFile, diff.after);
      applyItem.status = "APPLIED";
      applyItem.applied_at = new Date().toISOString();

      appendApplyHistory(
        {
          apply_id: applyItem.apply_id,
          update_id: applyItem.update_id,
          applied_at: applyItem.applied_at,
          target_layer: applyItem.target_layer,
          target_file: diff.target_file,
          operation: applyItem.operation,
          before_hash: diff.before_hash,
          after_hash: diff.after_hash,
          source_trace: copySourceTrace(applyItem.source_trace),
          diff_file: toRepoRelative(diffPath),
          rollback_file: toRepoRelative(diffPath)
        },
        applyHistoryPath
      );
    }

    applied.push({
      apply_id: applyItem.apply_id,
      update_id: applyItem.update_id,
      target_layer: applyItem.target_layer,
      target_file: diff.target_file
    });
  });

  if (errors.length) {
    return {
      applied: false,
      dryRun: options.dryRun === true,
      errors: errors,
      appliedItems: applied
    };
  }

  if (!options.dryRun) {
    queueBatch.generatedAt = new Date().toISOString();
    queueBatch.appliedCount = applied.length;
    writeJson(applyQueuePath, queueBatch);
  }

  return {
    applied: options.dryRun !== true,
    dryRun: options.dryRun === true,
    appliedCount: applied.length,
    appliedItems: applied,
    errors: []
  };
}

function rollbackPublicUpdateApply(applyId, options) {
  options = options || {};
  const applyHistoryPath = options.applyHistoryPath || APPLY_HISTORY_FILE;
  const applyQueuePath = options.applyQueuePath || APPLY_QUEUE_FILE;
  const diffDir = options.diffDir || DIFF_DIR;
  const history = readJson(applyHistoryPath, { version: 1, entries: [] });
  const entry = (history.entries || []).find(function (item) {
    return item.apply_id === applyId;
  });

  if (!entry) {
    return { rolledBack: false, reason: "apply history entry not found" };
  }

  const diffPath = entry.diff_file
    ? path.join(ROOT, entry.diff_file)
    : path.join(diffDir, applyId + ".json");
  const diff = readJson(diffPath, null);
  if (!diff || !diff.rollback || !diff.rollback.restore_content) {
    return { rolledBack: false, reason: "rollback metadata missing" };
  }

  const targetFile = path.join(ROOT, diff.target_file || entry.target_file);
  if (!options.dryRun) {
    writeJson(targetFile, diff.rollback.restore_content);

    const queueBatch = readJson(applyQueuePath, { items: [] });
    const applyItem = (queueBatch.items || []).find(function (item) {
      return item.apply_id === applyId;
    });
    if (applyItem) {
      applyItem.status = "ROLLED_BACK";
      applyItem.rolled_back_at = new Date().toISOString();
      writeJson(applyQueuePath, queueBatch);
    }

    history.entries.push({
      apply_id: applyId,
      update_id: entry.update_id,
      rolled_back_at: new Date().toISOString(),
      action: "ROLLBACK",
      target_layer: entry.target_layer,
      target_file: entry.target_file,
      before_hash: hashContent(diff.rollback.restore_content),
      source_trace: copySourceTrace(entry.source_trace)
    });
    writeJson(applyHistoryPath, history);
  }

  return {
    rolledBack: options.dryRun !== true,
    dryRun: options.dryRun === true,
    apply_id: applyId,
    target_file: entry.target_file
  };
}

module.exports = {
  INCIDENT_SCOPE,
  APPLY_STATUSES,
  OPERATIONS,
  APPLY_DIR,
  APPLY_QUEUE_FILE,
  APPLY_HISTORY_FILE,
  DIFF_DIR,
  MASTER_GATE_FILE,
  TARGET_LAYER_FILES,
  hashContent,
  buildApplyId,
  buildPublicItem,
  extractPassCandidates,
  validateCandidateForApply,
  determineOperation,
  buildApplyQueueItem,
  buildApplyDiff,
  validateApplyQueueItem,
  validateApplyDiff,
  buildApplyQueueBatch,
  preparePublicUpdateApply,
  confirmPublicUpdateApply,
  rollbackPublicUpdateApply,
  findExistingBySourceUrl,
  appendPublicItem
};
