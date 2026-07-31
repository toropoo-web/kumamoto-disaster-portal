"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..", "..");
const DASHBOARD_DIR = path.join(__dirname);
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "snapshots.json");
const PUBLIC_HASH_FILE = path.join(ROOT, "data", "production_readiness", "public-data-hash.json");
const REVIEW_QUEUE_FILE = path.join(ROOT, "data", "review_queue", "patrol_review_queue.json");
const PUBLIC_UPDATE_QUEUE_FILE = path.join(ROOT, "data", "public_update_queue", "patrol_public_update_queue.json");
const PUBLIC_UPDATE_GATE_FILE = path.join(ROOT, "data", "public_update_gate", "patrol_public_update_gate.json");
const PUBLIC_UPDATE_APPLY_FILE = path.join(ROOT, "data", "public_update_apply", "public_update_apply_queue.json");
const APPLY_HISTORY_FILE = path.join(ROOT, "data", "public_update_apply", "apply_history.json");
const DASHBOARD_OUTPUT_FILE = path.join(DASHBOARD_DIR, "operation-dashboard.json");

const EXPECTED_MUNICIPALITY_COUNT = 23;
const DASHBOARD_CATEGORIES = [
  "WATER", "SHELTER", "COMMUNICATION", "ROAD", "SUPPORT", "VOLUNTEER"
];

const { buildOperationMonitorReport } = require("../operation-monitor");

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

function loadMunicipalities() {
  const areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  return areas
    .slice()
    .sort(function (a, b) {
      return a.area_id.localeCompare(b.area_id);
    });
}

function loadActiveSources() {
  const data = readJson(SOURCES_FILE, { municipalities: [] });
  return (data.municipalities || []).filter(function (item) {
    return item.status === "ACTIVE";
  });
}

function buildSourceAreaMap(sources) {
  const map = {};
  sources.forEach(function (source) {
    if (!map[source.area_id]) {
      map[source.area_id] = [];
    }
    map[source.area_id].push(source);
  });
  return map;
}

function resolveAreaId(item, sourceById) {
  if (item.area_id) {
    return item.area_id;
  }
  const source = sourceById[item.source_id];
  if (source && source.area_id) {
    return source.area_id;
  }
  const match = String(item.source_id || "").match(/^(KM\d{3})/);
  return match ? match[1] : null;
}

function computeStatusLayer(incidentCount, gateStatus, reviewPendingCount, unreachableCount) {
  if (incidentCount > 0 || gateStatus === "FAIL" || unreachableCount > 0) {
    return "RED";
  }
  if (reviewPendingCount > 0) {
    return "YELLOW";
  }
  return "GREEN";
}

function buildCategoryStatus(queueItems, sources, snapshots) {
  const sourceById = {};
  sources.forEach(function (source) {
    sourceById[source.id] = source;
  });

  return DASHBOARD_CATEGORIES.map(function (category) {
    const items = queueItems.filter(function (item) {
      return item.category === category;
    });
    const pending = items.filter(function (item) {
      return item.status === "PENDING";
    });
    const municipalities = {};
    const sourceStates = {};

    items.forEach(function (item) {
      municipalities[item.municipality] = true;
      const snapshot = snapshots.sources[item.source_id];
      const state = snapshot
        ? (snapshot.reachable === false ? "UNREACHABLE" : "REACHABLE")
        : "MISSING";
      sourceStates[item.source_id] = state;
    });

    const lastUpdates = items
      .map(function (item) {
        return item.detected_at || item.created_at;
      })
      .filter(Boolean)
      .sort()
      .reverse();

    return {
      category: category,
      pending_count: pending.length,
      total_count: items.length,
      last_update: lastUpdates[0] || null,
      municipality_count: Object.keys(municipalities).length,
      source_status: {
        reachable: Object.values(sourceStates).filter(function (s) { return s === "REACHABLE"; }).length,
        unreachable: Object.values(sourceStates).filter(function (s) { return s === "UNREACHABLE"; }).length,
        missing: Object.values(sourceStates).filter(function (s) { return s === "MISSING"; }).length
      }
    };
  });
}

function buildMunicipalityStatus(municipalities, queueItems, sources, snapshots, phase1Updates) {
  const sourceByArea = buildSourceAreaMap(sources);
  const updatesByArea = {};
  phase1Updates.forEach(function (item) {
    if (!updatesByArea[item.area_id]) {
      updatesByArea[item.area_id] = [];
    }
    updatesByArea[item.area_id].push(item.displayed_updated_at || item.collected_at);
  });

  const waterIndex = readJson(path.join(PUBLIC_DIR, "water_search_index.json"), { index: [] });
  const disasterIndex = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), { index: [] });
  const waterEntries = waterIndex.index || waterIndex.items || [];
  const disasterEntries = disasterIndex.index || disasterIndex.items || [];

  return municipalities.map(function (area) {
    const areaSources = sourceByArea[area.area_id] || [];
    const areaQueue = queueItems.filter(function (item) {
      return item.municipality === area.name;
    });
    const pending = areaQueue.filter(function (item) {
      return item.status === "PENDING";
    });

    const unreachable = areaSources.filter(function (source) {
      const snapshot = snapshots.sources[source.id];
      return snapshot && snapshot.reachable === false;
    });
    const missing = areaSources.filter(function (source) {
      return !snapshots.sources[source.id];
    });

    let patrolStatus = "GREEN";
    if (unreachable.length > 0 || missing.length > 0) {
      patrolStatus = "RED";
    } else if (pending.length > 0) {
      patrolStatus = "YELLOW";
    }

    const hasWater = waterEntries.some(function (item) {
      return item.municipality === area.name || item.area_id === area.area_id;
    });
    const hasShelter = disasterEntries.some(function (item) {
      return item.category === "SHELTER" &&
        (item.municipality === area.name || item.area_id === area.area_id);
    });

    const updateTimes = (updatesByArea[area.area_id] || []).slice().sort().reverse();

    return {
      area_id: area.area_id,
      municipality: area.name,
      patrol: patrolStatus,
      water: hasWater ? "AVAILABLE" : "NONE",
      shelter: hasShelter ? "AVAILABLE" : "NONE",
      pending: pending.length,
      last_update: updateTimes[0] || (snapshots.sources[areaSources[0] && areaSources[0].id]
        ? snapshots.sources[areaSources[0].id].checkedAt
        : null)
    };
  });
}

function buildAuditTraces(queueItems, publicUpdates, applyHistory) {
  const updateByClassification = {};
  (publicUpdates.updates || []).forEach(function (update) {
    const trace = update.source_trace || {};
    if (trace.classification_id) {
      updateByClassification[trace.classification_id] = update;
    }
    if (trace.queue_id) {
      updateByClassification[trace.queue_id] = update;
    }
  });

  const applyByUpdate = {};
  (applyHistory.entries || []).forEach(function (entry) {
    if (entry.update_id) {
      applyByUpdate[entry.update_id] = entry;
    }
  });

  const traces = queueItems.map(function (item) {
    const trace = item.source_trace || {};
    const classificationId = trace.classification_id || null;
    const publicUpdate = classificationId ? updateByClassification[classificationId] : null;
    const updateId = publicUpdate ? publicUpdate.update_id : null;
    const applyEntry = updateId ? applyByUpdate[updateId] : null;

    return {
      source_id: item.source_id,
      change_log: trace.source_change_log || null,
      classification_id: classificationId,
      queue_id: item.queue_id,
      decision: item.decision ? item.decision.status : item.status,
      update_id: updateId,
      apply_id: applyEntry ? (applyEntry.apply_id || applyEntry.id || null) : null,
      trace_complete: Boolean(item.source_id && trace.classification_id && item.queue_id)
    };
  });

  return {
    total: traces.length,
    complete_count: traces.filter(function (item) {
      return item.trace_complete;
    }).length,
    items: traces
  };
}

function resolveGateStatus(gate) {
  if (!gate || !gate.gateSummary) {
    return "NONE";
  }
  if (gate.gateSummary.failed > 0) {
    return "FAIL";
  }
  if (gate.gateSummary.blocked > 0) {
    return "BLOCKED";
  }
  if (gate.gateSummary.passed > 0) {
    return "PASS";
  }
  return "NONE";
}

function buildOperationDashboard(options) {
  options = options || {};
  const timestamp = new Date().toISOString();
  const monitorReport = options.monitorReport || buildOperationMonitorReport();
  const municipalities = loadMunicipalities();
  const sources = loadActiveSources();
  const snapshots = readJson(SNAPSHOT_FILE, { sources: {} });
  const reviewQueue = readJson(REVIEW_QUEUE_FILE, { items: [] });
  const publicUpdates = readJson(PUBLIC_UPDATE_QUEUE_FILE, { updates: [] });
  const gate = readJson(PUBLIC_UPDATE_GATE_FILE, {});
  const applyQueue = readJson(PUBLIC_UPDATE_APPLY_FILE, { items: [] });
  const applyHistory = readJson(APPLY_HISTORY_FILE, { entries: [] });
  const phase1Updates = readJson(path.join(PUBLIC_DIR, "phase1_updates.json"), []);
  const queueItems = reviewQueue.items || [];

  const approvedCount = queueItems.filter(function (item) {
    return item.status === "APPROVED";
  }).length;
  const rejectedCount = queueItems.filter(function (item) {
    return item.status === "REJECTED";
  }).length;
  const pendingCount = queueItems.filter(function (item) {
    return item.status === "PENDING";
  }).length;
  const gateStatus = resolveGateStatus(gate);
  const incidentCount = (monitorReport.incidents || []).length;
  const unreachableCount = monitorReport.patrol_status
    ? monitorReport.patrol_status.unreachable_source_count
    : 0;

  const statusLayer = computeStatusLayer(
    incidentCount,
    gateStatus,
    pendingCount,
    unreachableCount
  );

  const dashboard = {
    timestamp: timestamp,
    generatedAt: timestamp,
    status_layer: statusLayer,
    municipalities: municipalities.length,
    municipality_status: buildMunicipalityStatus(
      municipalities,
      queueItems,
      sources,
      snapshots,
      phase1Updates
    ),
    patrol_status: monitorReport.patrol_status
      ? monitorReport.patrol_status.status
      : "UNKNOWN",
    diff_count: monitorReport.diff_summary
      ? monitorReport.diff_summary.total_changes
      : 0,
    classification_count: monitorReport.diff_summary
      ? monitorReport.diff_summary.classified_changes
      : 0,
    review_pending_count: pendingCount,
    approved_count: approvedCount,
    rejected_count: rejectedCount,
    public_update_count: (publicUpdates.updates || []).length,
    gate_status: gateStatus,
    apply_pending_count: applyQueue.pendingCount || (applyQueue.items || []).filter(function (i) {
      return i.status === "PENDING";
    }).length,
    incident_count: incidentCount,
    categories: buildCategoryStatus(queueItems, sources, snapshots),
    audit_traces: buildAuditTraces(queueItems, publicUpdates, applyHistory),
    constraints: {
      ui_public_page_unchanged: true,
      auto_approval: false,
      auto_publish: false,
      sources_json_auto_change: false,
      public_data_direct_edit: false
    },
    public_data_hash: {
      baseline_recorded: fs.existsSync(PUBLIC_HASH_FILE),
      current_hash: hashPublicSnapshot(),
      unchanged: (function () {
        const stored = readJson(PUBLIC_HASH_FILE, null);
        return Boolean(stored && stored.hash && stored.hash === hashPublicSnapshot());
      })()
    }
  };

  return dashboard;
}

function writeOperationDashboard(options) {
  options = options || {};
  const dashboard = buildOperationDashboard(options);

  if (!fs.existsSync(DASHBOARD_DIR)) {
    fs.mkdirSync(DASHBOARD_DIR, { recursive: true });
  }

  const outputPath = options.outputPath || DASHBOARD_OUTPUT_FILE;
  fs.writeFileSync(outputPath, JSON.stringify(dashboard, null, 2) + "\n", "utf8");

  const summaryPath = path.join(DASHBOARD_DIR, "operation-dashboard-summary.json");
  fs.writeFileSync(
    summaryPath,
    JSON.stringify({
      DISASTER_PORTAL_OPERATION_DASHBOARD_READY: "PENDING",
      timestamp: dashboard.timestamp,
      status_layer: dashboard.status_layer,
      municipalities: dashboard.municipalities,
      review_pending_count: dashboard.review_pending_count,
      incident_count: dashboard.incident_count,
      gate_status: dashboard.gate_status
    }, null, 2) + "\n",
    "utf8"
  );

  return {
    dashboard: dashboard,
    outputPath: outputPath,
    summaryPath: summaryPath
  };
}

function validateDashboardSchema(dashboard) {
  const errors = [];
  const requiredTop = [
    "timestamp",
    "municipalities",
    "patrol_status",
    "diff_count",
    "classification_count",
    "review_pending_count",
    "approved_count",
    "rejected_count",
    "public_update_count",
    "gate_status",
    "incident_count"
  ];

  requiredTop.forEach(function (field) {
    if (dashboard[field] === undefined || dashboard[field] === null) {
      errors.push("missing field: " + field);
    }
  });

  if (dashboard.municipalities !== EXPECTED_MUNICIPALITY_COUNT) {
    errors.push("municipality count expected " + EXPECTED_MUNICIPALITY_COUNT + ", got " + dashboard.municipalities);
  }

  if (!Array.isArray(dashboard.municipality_status) ||
    dashboard.municipality_status.length !== EXPECTED_MUNICIPALITY_COUNT) {
    errors.push("municipality_status must have " + EXPECTED_MUNICIPALITY_COUNT + " entries");
  }

  if (!Array.isArray(dashboard.categories) || dashboard.categories.length !== DASHBOARD_CATEGORIES.length) {
    errors.push("categories must include all " + DASHBOARD_CATEGORIES.length + " categories");
  } else {
    DASHBOARD_CATEGORIES.forEach(function (category) {
      const found = dashboard.categories.some(function (item) {
        return item.category === category;
      });
      if (!found) {
        errors.push("missing category: " + category);
      }
    });
  }

  if (!dashboard.audit_traces || !Array.isArray(dashboard.audit_traces.items)) {
    errors.push("audit_traces.items required");
  } else if (dashboard.audit_traces.complete_count < dashboard.audit_traces.total) {
    const incomplete = dashboard.audit_traces.total - dashboard.audit_traces.complete_count;
    if (incomplete > 0 && dashboard.audit_traces.complete_count === 0) {
      errors.push("audit trace integrity: no complete traces");
    }
  }

  if (!dashboard.status_layer || ["GREEN", "YELLOW", "RED"].indexOf(dashboard.status_layer) < 0) {
    errors.push("invalid status_layer: " + dashboard.status_layer);
  }

  if (dashboard.constraints) {
    ["auto_approval", "auto_publish", "sources_json_auto_change", "public_data_direct_edit"].forEach(function (key) {
      if (dashboard.constraints[key] !== false) {
        errors.push("constraint violation: " + key);
      }
    });
  }

  return errors;
}

module.exports = {
  DASHBOARD_DIR,
  DASHBOARD_OUTPUT_FILE,
  DASHBOARD_CATEGORIES,
  EXPECTED_MUNICIPALITY_COUNT,
  buildOperationDashboard,
  writeOperationDashboard,
  validateDashboardSchema,
  computeStatusLayer
};
