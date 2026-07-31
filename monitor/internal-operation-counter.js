"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const OUTPUT_DIR = path.join(ROOT, "data", "operation_monitor");
const COUNTER_FILE = path.join(OUTPUT_DIR, "internal-operation-counter.json");
const STATE_FILE = path.join(OUTPUT_DIR, "internal-operation-counter.state.json");

const PORTAL_FEATURE_SURFACES = [
  "communication-status",
  "x-feed",
  "latest-updates",
  "page-navigation",
  "area-disaster-nav",
  "disaster-search-water",
  "disaster-search-volunteer",
  "disaster-search-support-service",
  "water-search",
  "water-cross-view",
  "infrastructure-info",
  "disaster-location-map",
  "about",
  "caution"
];

const FORBIDDEN_FIELDS = [
  "ip",
  "ip_address",
  "user_agent",
  "cookie",
  "session_id",
  "visitor_id",
  "email",
  "phone"
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
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return fallback;
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function countByCategory(indexItems) {
  const counts = {};
  (indexItems || []).forEach(function (item) {
    const key = item.category || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function loadDisasterIndexItems(disasterIndex) {
  if (!disasterIndex) {
    return [];
  }
  if (Array.isArray(disasterIndex.index)) {
    return disasterIndex.index;
  }
  if (Array.isArray(disasterIndex.items)) {
    return disasterIndex.items;
  }
  return [];
}

function loadWaterIndexItems(waterIndex) {
  if (!waterIndex) {
    return [];
  }
  if (Array.isArray(waterIndex.items)) {
    return waterIndex.items;
  }
  if (Array.isArray(waterIndex.index)) {
    return waterIndex.index;
  }
  return [];
}

function countPublicCategoryUsage(updates) {
  const counts = {};
  (updates || []).forEach(function (record) {
    const key = record.public_category_id || record.public_category_label || "UNKNOWN";
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function buildPatrolStatusSummary(status) {
  const source = status || {};
  return {
    system_status: source.system_status || "UNKNOWN",
    source_count: source.source_count || 0,
    sources_checked: source.sources_checked || 0,
    changes_detected: source.changes_detected || 0,
    last_patrol_at: source.last_patrol_at || null,
    last_success_at: source.last_success_at || null,
    last_validation_at: source.last_validation_at || null
  };
}

function resolveLastAccessTime(status) {
  const candidates = [
    status && status.last_patrol_at,
    status && status.last_success_at,
    status && status.last_validation_at
  ].filter(Boolean);
  if (!candidates.length) {
    return null;
  }
  return candidates.sort().reverse()[0];
}

function updateOperatorState(state, generatedAt) {
  const next = Object.assign({}, state || {});
  next.operator_report_count = (next.operator_report_count || 0) + 1;
  next.last_report_generated_at = generatedAt;
  return next;
}

function buildInternalOperationCounter(options) {
  options = options || {};
  const generatedAt = options.generatedAt || new Date().toISOString();
  const previousState = readJson(STATE_FILE, {
    operator_report_count: 0,
    last_report_generated_at: null
  });
  const nextState = options.recordGeneration === false
    ? previousState
    : updateOperatorState(previousState, generatedAt);

  const areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  const updates = readJson(path.join(PUBLIC_DIR, "phase1_updates.json"), []);
  const status = readJson(path.join(PUBLIC_DIR, "status.json"), {});
  const disasterIndex = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), {});
  const waterIndex = readJson(path.join(PUBLIC_DIR, "water_search_index.json"), {});

  const disasterItems = loadDisasterIndexItems(disasterIndex);
  const waterItems = loadWaterIndexItems(waterIndex);
  const disasterCategoryCounts = countByCategory(disasterItems);
  const publicCategoryCounts = countPublicCategoryUsage(updates);

  const categoryUsageCount = Object.assign({}, disasterCategoryCounts);
  if (waterItems.length > 0) {
    categoryUsageCount.WATER_SEARCH_INDEX = waterItems.length;
  }
  Object.keys(publicCategoryCounts).forEach(function (key) {
    const field = "PUBLIC_" + key;
    categoryUsageCount[field] = publicCategoryCounts[key];
  });

  const municipalitySurfaceCount = Array.isArray(areas) ? areas.length : 0;
  const pageViewCount = municipalitySurfaceCount + PORTAL_FEATURE_SURFACES.length;

  return {
    version: "1.0",
    view_type: "INTERNAL_OPERATION_COUNTER",
    generated_at: generatedAt,
    constraints: {
      no_personal_data: true,
      no_cookies: true,
      no_external_analytics: true,
      public_ui_unchanged: true
    },
    page_view_count: pageViewCount,
    page_view_basis: {
      municipality_surfaces: municipalitySurfaceCount,
      feature_surfaces: PORTAL_FEATURE_SURFACES.length,
      note: "公開ポータルの情報面数（利用者追跡ではなく構成上の面数）"
    },
    operator_report_count: nextState.operator_report_count,
    category_usage_count: categoryUsageCount,
    last_access_time: resolveLastAccessTime(status),
    patrol_status_summary: buildPatrolStatusSummary(status),
    counter_state: {
      last_report_generated_at: nextState.last_report_generated_at
    },
    source_files: {
      status_json: "data/public/status.json",
      disaster_search_index_json: "data/public/disaster_search_index.json",
      water_search_index_json: "data/public/water_search_index.json",
      phase1_areas_json: "data/public/phase1_areas.json",
      phase1_updates_json: "data/public/phase1_updates.json"
    },
    _state: nextState
  };
}

function validateInternalOperationCounter(report) {
  const errors = [];
  if (!report || typeof report !== "object") {
    return ["report missing"];
  }

  [
    "version",
    "view_type",
    "generated_at",
    "page_view_count",
    "category_usage_count",
    "last_access_time",
    "patrol_status_summary",
    "operator_report_count"
  ].forEach(function (field) {
    if (report[field] === undefined || report[field] === null) {
      errors.push("missing field: " + field);
    }
  });

  if (report.view_type !== "INTERNAL_OPERATION_COUNTER") {
    errors.push("view_type must be INTERNAL_OPERATION_COUNTER");
  }

  if (typeof report.page_view_count !== "number" || report.page_view_count < 1) {
    errors.push("page_view_count must be a positive number");
  }

  if (typeof report.category_usage_count !== "object" || Array.isArray(report.category_usage_count)) {
    errors.push("category_usage_count must be an object");
  }

  const summary = report.patrol_status_summary || {};
  ["system_status", "source_count", "sources_checked"].forEach(function (field) {
    if (summary[field] === undefined) {
      errors.push("patrol_status_summary missing " + field);
    }
  });

  const serialized = JSON.stringify(report).toLowerCase();
  FORBIDDEN_FIELDS.forEach(function (field) {
    if (serialized.indexOf('"' + field + '"') >= 0) {
      errors.push("forbidden field present: " + field);
    }
  });

  return errors;
}

function writeInternalOperationCounter(options) {
  const built = buildInternalOperationCounter(options);
  const state = built._state;
  const report = Object.assign({}, built);
  delete report._state;

  const errors = validateInternalOperationCounter(report);
  if (errors.length > 0) {
    return { ok: false, errors: errors, report: report };
  }

  writeJson(COUNTER_FILE, report);
  if (options && options.recordGeneration === false) {
    return { ok: true, errors: [], report: report, outputPath: COUNTER_FILE, statePath: STATE_FILE };
  }

  writeJson(STATE_FILE, state);
  return { ok: true, errors: [], report: report, outputPath: COUNTER_FILE, statePath: STATE_FILE };
}

module.exports = {
  ROOT,
  COUNTER_FILE,
  STATE_FILE,
  PORTAL_FEATURE_SURFACES,
  buildInternalOperationCounter,
  validateInternalOperationCounter,
  writeInternalOperationCounter
};
