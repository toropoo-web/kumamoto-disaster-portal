"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");
const CHANGE_LOG_DIR = path.join(ROOT, "monitor", "change-log");
const PATROL_SUMMARY_FILE = path.join(ROOT, "monitor", "reports", "patrol-summary.json");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
const DECISION_LOG_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_decision_log.json");
const PUBLIC_UPDATE_QUEUE_FILE = path.join(ROOT, "data", "public_update_queue", "patrol_public_update_queue.json");
const PUBLIC_UPDATE_GATE_FILE = path.join(ROOT, "data", "public_update_gate", "patrol_public_update_gate.json");
const PUBLIC_UPDATE_APPLY_FILE = path.join(ROOT, "data", "public_update_apply", "public_update_apply_queue.json");
const PUBLIC_HASH_FILE = path.join(ROOT, "data", "production_readiness", "public-data-hash.json");
const SOURCES_HASH_FILE = path.join(ROOT, "data", "production_readiness", "sources-json-hash.json");
const MONITOR_OUTPUT_DIR = path.join(ROOT, "data", "operation_monitor");

const EXPECTED_AREA_COUNT = 23;
const MONITORED_AREA_IDS = [];
for (let i = 0; i <= 22; i += 1) {
  MONITORED_AREA_IDS.push("KM" + String(i).padStart(3, "0"));
}

const {
  classifyChangeLogEntries,
  isClassifiableChangeEntry,
  resolveChangeLogPath,
  listChangeLogFiles
} = require("./diff-classification");

const { validateQueueItem } = require("./review-queue");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function hashPublicSnapshot() {
  return [
    "phase1_areas.json",
    "phase1_navigation.json",
    "phase1_updates.json",
    "area_navigation.json",
    "water_search_index.json",
    "disaster_search_index.json",
    "location_sources.json",
    "emergency_sources.json"
  ]
    .map(function (name) {
      return name + ":" + hashFile(path.join(PUBLIC_DIR, name));
    })
    .join("|");
}

function summarizeByCategory(items, field) {
  const summary = {};
  (items || []).forEach(function (item) {
    const key = item[field] || "UNKNOWN";
    summary[key] = (summary[key] || 0) + 1;
  });
  return summary;
}

function loadActiveSources() {
  const data = readJson(SOURCES_FILE, { municipalities: [] });
  return (data.municipalities || []).filter(function (item) {
    return item.status === "ACTIVE";
  });
}

function collectPatrolStatus() {
  const patrolSummary = readJson(PATROL_SUMMARY_FILE, null);
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const activeSources = loadActiveSources();
  const changeLogPath = resolveChangeLogPath();
  const changeLogEntries = changeLogPath ? readJson(changeLogPath, []) : [];
  const pipelineScripts = [
    "scripts/run-monitor.js",
    "scripts/classify-patrol-diffs.js",
    "scripts/build-patrol-review-queue.js",
    "scripts/run-patrol-pipeline.js"
  ].map(function (file) {
    return {
      script: path.basename(file),
      exists: fs.existsSync(path.join(ROOT, file))
    };
  });

  const missingSnapshots = activeSources.filter(function (source) {
    return !snapshots.sources[source.id];
  });
  const unreachable = activeSources.filter(function (source) {
    const snapshot = snapshots.sources[source.id];
    return snapshot && snapshot.reachable === false;
  });

  const metadataOnlyChanges = changeLogEntries.filter(function (entry) {
    return entry.changeType === "PAGE_UPDATED_AT_CHANGED" ||
      (!isClassifiableChangeEntry(entry) &&
        entry.previousHash &&
        entry.currentHash &&
        entry.previousHash === entry.currentHash);
  });
  const classifiableChanges = changeLogEntries.filter(isClassifiableChangeEntry);
  const dryClassifications = classifyChangeLogEntries(changeLogEntries, snapshots);

  return {
    status: patrolSummary ? "ACTIVE" : "UNKNOWN",
    last_patrol_at: patrolSummary ? patrolSummary.patrolAt : null,
    source_count: activeSources.length,
    success_count: patrolSummary ? patrolSummary.successCount : null,
    failed_count: patrolSummary ? patrolSummary.failedCount : 0,
    change_log_path: changeLogPath,
    change_log_entry_count: changeLogEntries.length,
    metadata_only_ignored_count: metadataOnlyChanges.length,
    classifiable_change_count: classifiableChanges.length,
    classification_count: dryClassifications.length,
    pipeline_connected: pipelineScripts.every(function (item) {
      return item.exists;
    }),
    pipeline_scripts: pipelineScripts,
    snapshot_missing_count: missingSnapshots.length,
    unreachable_source_count: unreachable.length,
    no_diff_stops: classifiableChanges.length === 0,
    hash_change_triggers_classification:
      classifiableChanges.length === 0 ? true : dryClassifications.length > 0,
    page_updated_at_excluded:
      metadataOnlyChanges.length === 0 ||
      metadataOnlyChanges.every(function (entry) {
        return classifyChangeLogEntries([entry], snapshots).length === 0;
      }),
    missing_snapshots: missingSnapshots.map(function (item) {
      return item.id;
    }),
    unreachable_sources: unreachable.map(function (item) {
      return item.id;
    })
  };
}

function collectDiffSummary() {
  const changeLogPath = resolveChangeLogPath();
  const entries = changeLogPath ? readJson(changeLogPath, []) : [];
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const classifications = classifyChangeLogEntries(entries, snapshots);

  const byChangeType = summarizeByCategory(entries, "changeType");
  const byCategory = summarizeByCategory(classifications, "category");
  const ignored = entries.filter(function (entry) {
    return !isClassifiableChangeEntry(entry);
  });

  return {
    change_log_path: changeLogPath,
    total_changes: entries.length,
    ignored_changes: ignored.length,
    classified_changes: classifications.length,
    by_change_type: byChangeType,
    by_category: byCategory,
    ignored_reasons: {
      page_updated_at_only: ignored.filter(function (e) {
        return e.changeType === "PAGE_UPDATED_AT_CHANGED";
      }).length,
      same_hash: ignored.filter(function (e) {
        return e.previousHash && e.currentHash && e.previousHash === e.currentHash;
      }).length
    },
    latest_change_logs: listChangeLogFiles().slice(-3)
  };
}

function collectReviewPending() {
  const queue = readJson(REVIEW_QUEUE_FILE, { items: [], autoPublish: false });
  const decisionLog = readJson(DECISION_LOG_FILE, { entries: [] });
  const items = queue.items || [];
  const pending = items.filter(function (item) {
    return item.status === "PENDING";
  });
  const categorySummary = queue.categorySummary || summarizeByCategory(items, "category");
  const traceMissing = items.filter(function (item) {
    return !item.source_trace || !item.source_trace.classification_id;
  });
  const schemaErrors = [];
  items.forEach(function (item, index) {
    const errors = validateQueueItem(item);
    if (errors.length) {
      schemaErrors.push({ index: index, queue_id: item.queue_id, errors: errors });
    }
  });

  return {
    item_count: items.length,
    pending_count: pending.length,
    approved_count: items.filter(function (i) { return i.status === "APPROVED"; }).length,
    rejected_count: items.filter(function (i) { return i.status === "REJECTED"; }).length,
    category_summary: categorySummary,
    auto_publish: queue.autoPublish === false || queue.auto_publish === false,
    all_pending_review_required: pending.every(function (item) {
      return item.review_required === true && item.auto_publish === false;
    }),
    decision_log_entries: (decisionLog.entries || []).length,
    decision_log_file: fs.existsSync(DECISION_LOG_FILE)
      ? path.relative(ROOT, DECISION_LOG_FILE)
      : null,
    source_trace_missing_count: traceMissing.length,
    schema_error_count: schemaErrors.length,
  };
}

function collectPublicUpdateStatus() {
  const queue = readJson(PUBLIC_UPDATE_QUEUE_FILE, { updates: [], autoPublish: false });
  const gate = readJson(PUBLIC_UPDATE_GATE_FILE, { results: [], autoPublish: false });
  const applyQueue = readJson(PUBLIC_UPDATE_APPLY_FILE, { items: [], autoPublish: false });

  return {
    public_update_queue_count: (queue.updates || []).length,
    public_update_ready_count: (queue.updates || []).filter(function (u) {
      return u.status === "READY";
    }).length,
    gate_total: gate.gateSummary ? gate.gateSummary.total : (gate.results || []).length,
    gate_passed: gate.gateSummary ? gate.gateSummary.passed : 0,
    gate_failed: gate.gateSummary ? gate.gateSummary.failed : 0,
    apply_pending_count: applyQueue.pendingCount || (applyQueue.items || []).filter(function (i) {
      return i.status === "PENDING";
    }).length,
    apply_blocked_count: applyQueue.blockedCount || 0,
    auto_apply_prohibited: true,
    confirm_required: true,
    auto_publish_false:
      (queue.autoPublish === false || queue.auto_publish === false) &&
      (gate.autoPublish === false || gate.auto_publish === false) &&
      (applyQueue.autoPublish === false || applyQueue.auto_publish === false),
    files: {
      queue: path.relative(ROOT, PUBLIC_UPDATE_QUEUE_FILE),
      gate: path.relative(ROOT, PUBLIC_UPDATE_GATE_FILE),
      apply: path.relative(ROOT, PUBLIC_UPDATE_APPLY_FILE)
    }
  };
}

function collectUiIntegrity() {
  const phase1Areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  const phase1Nav = readJson(path.join(PUBLIC_DIR, "phase1_navigation.json"), []);
  const phase1Updates = readJson(path.join(PUBLIC_DIR, "phase1_updates.json"), []);
  const waterIndex = readJson(path.join(PUBLIC_DIR, "water_search_index.json"), { index: [] });
  const disasterIndex = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), { index: [] });
  const waterEntries = waterIndex.index || waterIndex.items || [];
  const disasterEntries = disasterIndex.index || disasterIndex.items || [];

  const areaIds = phase1Areas.map(function (item) {
    return item.area_id;
  });
  const duplicateAreaIds = areaIds.filter(function (id, index) {
    return areaIds.indexOf(id) !== index;
  });

  const schemaChecks = [
    { file: "phase1_areas.json", valid: Array.isArray(phase1Areas) && phase1Areas.length > 0 },
    { file: "phase1_navigation.json", valid: Array.isArray(phase1Nav) && phase1Nav.length > 0 },
    { file: "phase1_updates.json", valid: Array.isArray(phase1Updates) },
    { file: "water_search_index.json", valid: waterEntries.length > 0 },
    { file: "disaster_search_index.json", valid: disasterEntries.length > 0 }
  ];

  return {
    municipality_count: phase1Areas.length,
    expected_municipality_count: EXPECTED_AREA_COUNT,
    area_id_unique: duplicateAreaIds.length === 0,
    water_search_count: waterEntries.length,
    shelter_search_count: disasterEntries.filter(function (item) {
      return item.category === "SHELTER";
    }).length,
    emergency_card_count: phase1Updates.length,
    json_schema_checks: schemaChecks,
    schema_valid: schemaChecks.every(function (item) {
      return item.valid;
    })
  };
}

function collectIncidents(patrolStatus, uiIntegrity) {
  const incidents = [];
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const activeSources = loadActiveSources();
  const storedPublicHash = readJson(PUBLIC_HASH_FILE, null);
  const currentPublicHash = hashPublicSnapshot();

  (patrolStatus.unreachable_sources || []).forEach(function (sourceId) {
    incidents.push({
      type: "URL_FETCH_FAILED",
      severity: "HIGH",
      source_id: sourceId,
      message: "Source unreachable in latest snapshot"
    });
  });

  (patrolStatus.missing_snapshots || []).forEach(function (sourceId) {
    incidents.push({
      type: "SOURCE_SNAPSHOT_MISSING",
      severity: "MEDIUM",
      source_id: sourceId,
      message: "Active source has no production snapshot"
    });
  });

  activeSources.forEach(function (source) {
    const snapshot = snapshots.sources[source.id];
    if (!snapshot) {
      return;
    }
    if (snapshot.url && snapshot.url !== source.url) {
      incidents.push({
        type: "SOURCE_URL_MISMATCH",
        severity: "MEDIUM",
        source_id: source.id,
        message: "Snapshot URL differs from sources.json"
      });
    }
    if (snapshot.charsetIssue === true) {
      incidents.push({
        type: "CHARSET_ANOMALY",
        severity: "MEDIUM",
        source_id: source.id,
        message: "Charset anomaly detected in snapshot"
      });
    }
    if (snapshot.structureChanged === true) {
      incidents.push({
        type: "HTML_STRUCTURE_CHANGED",
        severity: "LOW",
        source_id: source.id,
        message: "HTML structure change flagged in snapshot"
      });
    }
  });

  if (storedPublicHash && storedPublicHash.hash && storedPublicHash.hash !== currentPublicHash) {
    incidents.push({
      type: "PUBLIC_DATA_HASH_CHANGED",
      severity: "HIGH",
      message: "Public data hash differs from recorded baseline"
    });
  }

  if (!uiIntegrity.area_id_unique) {
    incidents.push({
      type: "UI_DATA_INCONSISTENCY",
      severity: "HIGH",
      message: "Duplicate area_id detected in phase1_areas.json"
    });
  }

  if (uiIntegrity.municipality_count !== EXPECTED_AREA_COUNT) {
    incidents.push({
      type: "UI_DATA_INCONSISTENCY",
      severity: "HIGH",
      message: "Municipality count mismatch: expected " + EXPECTED_AREA_COUNT + ", got " + uiIntegrity.municipality_count
    });
  }

  return incidents;
}

function collectValidationResult(patrolStatus, reviewPending, publicUpdateStatus, uiIntegrity, incidents) {
  const checks = [];
  const push = function (name, pass, reason) {
    checks.push({ check: name, status: pass ? "PASS" : "FAIL", reason: reason || null });
  };

  push("patrol.pipeline_connected", patrolStatus.pipeline_connected);
  push("patrol.no_diff_stops", patrolStatus.classifiable_change_count === 0
    ? patrolStatus.classification_count === 0
    : true);
  push("patrol.page_updated_at_excluded", patrolStatus.page_updated_at_excluded);
  push("patrol.hash_change_triggers_classification", patrolStatus.hash_change_triggers_classification);
  push("review.pending_review_required", reviewPending.all_pending_review_required !== false);
  push("review.auto_publish_false", reviewPending.auto_publish === true);
  push("review.decision_log_present", reviewPending.decision_log_file !== null);
  push("review.source_trace_complete", reviewPending.source_trace_missing_count === 0);
  push("public_update.auto_apply_prohibited", publicUpdateStatus.auto_apply_prohibited);
  push("public_update.confirm_required", publicUpdateStatus.confirm_required);
  push("public_update.auto_publish_false", publicUpdateStatus.auto_publish_false);
  push("ui.municipality_count", uiIntegrity.municipality_count === EXPECTED_AREA_COUNT);
  push("ui.area_id_unique", uiIntegrity.area_id_unique);
  push("ui.json_schema_valid", uiIntegrity.schema_valid);
  push("incidents.none_critical", incidents.filter(function (i) {
    return i.severity === "HIGH";
  }).length === 0);

  const failed = checks.filter(function (item) {
    return item.status === "FAIL";
  });

  return {
    status: failed.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    failed_count: failed.length
  };
}

function buildOperationMonitorReport(options) {
  options = options || {};
  const timestamp = new Date().toISOString();
  const patrolStatus = collectPatrolStatus();
  const diffSummary = collectDiffSummary();
  const reviewPending = collectReviewPending();
  const publicUpdateStatus = collectPublicUpdateStatus();
  const uiIntegrity = collectUiIntegrity();
  const incidents = collectIncidents(patrolStatus, uiIntegrity);
  const validationResult = collectValidationResult(
    patrolStatus,
    reviewPending,
    publicUpdateStatus,
    uiIntegrity,
    incidents
  );

  const monitoringReady = validationResult.status === "PASS";

  return {
    DISASTER_PORTAL_OPERATION_MONITORING_READY: monitoringReady ? "PASS" : "FAIL",
    generatedAt: timestamp,
    timestamp: timestamp,
    scope: {
      area_ids: MONITORED_AREA_IDS,
      municipality_count: EXPECTED_AREA_COUNT,
      portal: "kumamoto-disaster-emergency-portal"
    },
    constraints: {
      auto_municipality_add: false,
      sources_json_auto_change: false,
      auto_publish: false,
      auto_approval: false,
      public_data_direct_edit: false
    },
    patrol_status: patrolStatus,
    diff_summary: diffSummary,
    review_pending: reviewPending,
    public_update_status: publicUpdateStatus,
    ui_integrity: uiIntegrity,
    incidents: incidents,
    validation_result: validationResult,
    errors: validationResult.checks
      .filter(function (item) {
        return item.status === "FAIL";
      })
      .map(function (item) {
        return item.check + (item.reason ? " (" + item.reason + ")" : "");
      })
  };
}

function writeOperationMonitorReport(options) {
  options = options || {};
  const report = buildOperationMonitorReport(options);
  const outDir = options.outputDir || MONITOR_OUTPUT_DIR;

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const stamp = report.timestamp.replace(/[:.]/g, "-");
  const datedPath = path.join(outDir, "monitor-" + stamp + ".json");
  const latestPath = path.join(outDir, "latest-report.json");
  const summaryPath = path.join(outDir, "latest-summary.json");

  const summary = {
    DISASTER_PORTAL_OPERATION_MONITORING_READY: report.DISASTER_PORTAL_OPERATION_MONITORING_READY,
    timestamp: report.timestamp,
    patrol_status: {
      last_patrol_at: report.patrol_status.last_patrol_at,
      change_count: report.diff_summary.total_changes,
      classification_count: report.diff_summary.classified_changes,
      unreachable_count: report.patrol_status.unreachable_source_count
    },
    review_pending: {
      pending_count: report.review_pending.pending_count,
      category_summary: report.review_pending.category_summary
    },
    public_update_status: {
      queue_count: report.public_update_status.public_update_queue_count,
      apply_pending_count: report.public_update_status.apply_pending_count
    },
    incident_count: report.incidents.length,
    validation_result: report.validation_result.status
  };

  fs.writeFileSync(datedPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(latestPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  fs.writeFileSync(summaryPath, JSON.stringify(summary, null, 2) + "\n", "utf8");

  return {
    report: report,
    datedPath: datedPath,
    latestPath: latestPath,
    summaryPath: summaryPath
  };
}

module.exports = {
  MONITOR_OUTPUT_DIR,
  EXPECTED_AREA_COUNT,
  MONITORED_AREA_IDS,
  collectPatrolStatus,
  collectDiffSummary,
  collectReviewPending,
  collectPublicUpdateStatus,
  collectUiIntegrity,
  collectIncidents,
  collectValidationResult,
  buildOperationMonitorReport,
  writeOperationMonitorReport
};
