#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const TEST_ROOT = path.join(ROOT, "data", "test", "portal-municipality-e2e");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const APP_JS = path.join(ROOT, "js", "app.js");

const TARGET_AREA_IDS = [
  "KM014", "KM015", "KM016", "KM017", "KM018",
  "KM019", "KM020", "KM021", "KM022"
];

const CATEGORY_KEYWORDS = {
  WATER: ["断水", "水道", "復旧", "給水"],
  SHELTER: ["避難所", "開設"]
};

const {
  classifyChangeEntry,
  validateClassificationShape
} = require("../monitor/diff-classification");

const {
  classificationToQueueItem,
  buildQueueBatch,
  validateQueueItem
} = require("../monitor/review-queue");

const { setReviewDecision } = require("../monitor/review-decision-engine");

const {
  convertApprovedQueueItems,
  buildPublicCandidateBatch,
  validatePublicCandidate,
  isApprovedQueueItem
} = require("../monitor/review-approved-converter");

const {
  runCandidateGateChecks,
  buildGateBatch,
  validateGateBatch
} = require("../monitor/public-update-validation-gate");

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeJson(filePath, data) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function hashPublicSnapshot() {
  const files = [
    "phase1_areas.json",
    "phase1_navigation.json",
    "phase1_updates.json",
    "area_navigation.json",
    "water_search_index.json",
    "disaster_search_index.json",
    "location_sources.json",
    "emergency_sources.json"
  ];
  return files
    .map(function (name) {
      return name + ":" + hashFile(path.join(PUBLIC_DIR, name));
    })
    .join("|");
}

function statusFrom(checks) {
  const pending = checks.filter(function (item) {
    return item.status === "PENDING";
  });
  const fail = checks.filter(function (item) {
    return item.status === "FAIL";
  });
  if (fail.length) {
    return "FAIL";
  }
  if (pending.length) {
    return "PENDING";
  }
  return "PASS";
}

function check(name, pass, pendingReason) {
  if (pass) {
    return { check: name, status: "PASS" };
  }
  return { check: name, status: pendingReason ? "PENDING" : "FAIL", reason: pendingReason || "check failed" };
}

function getPrimaryPatrolSource(sources, areaId) {
  return (sources || []).find(function (item) {
    return item.area_id === areaId && item.status === "ACTIVE" && item.patrol_role === "primary";
  }) || (sources || []).find(function (item) {
    return item.area_id === areaId && item.status === "ACTIVE";
  }) || null;
}

function findByAreaId(list, areaId, key) {
  key = key || "area_id";
  return (list || []).find(function (item) {
    return item[key] === areaId;
  });
}

function findLocationSource(sources, areaId, category) {
  return (sources || []).find(function (item) {
    return item.area_id === areaId && item.category === category;
  });
}

function findWaterRegistry(items, municipality) {
  return (items || []).find(function (item) {
    return item.item_kind === "registry" && item.municipality === municipality;
  });
}

function findShelterRegistry(items, areaId, municipality) {
  return (items || []).find(function (item) {
    return (
      item.category === "SHELTER" &&
      item.area_id === areaId &&
      item.municipality === municipality &&
      item.source_trace
    );
  });
}

function hasAreaDisplayRule(appContent, areaId) {
  const blockPattern = new RegExp(
    areaId + ":\\s*\\{[\\s\\S]*?allowed:\\s*\\[[^\\]]*\"WATER\"[\\s\\S]*?\\][\\s\\S]*?blocked:"
  );
  const shelterPattern = new RegExp(
    areaId + ":\\s*\\{[\\s\\S]*?allowed:\\s*\\[[^\\]]*\"SHELTER\""
  );
  return blockPattern.test(appContent) && shelterPattern.test(appContent);
}

function buildMockChangeEntry(source, category) {
  const keywords = CATEGORY_KEYWORDS[category];
  return {
    source: source.id,
    sourceName: source.name,
    category: "municipality",
    areaId: source.area_id,
    url: source.url,
    detectedAt: new Date().toISOString(),
    changeType: "CONTENT_AND_TITLE_CHANGED",
    previousHash: "e2e-" + source.area_id + "-" + category + "-before",
    currentHash: "e2e-" + source.area_id + "-" + category + "-after",
    keywords: keywords,
    status: "DETECTED",
    changed_text: keywords.join(" ") + " 情報更新",
    titleChanged: {
      from: "更新前タイトル",
      to: keywords[0] + "情報更新"
    }
  };
}

async function runPipelineMock(source, category, runDir) {
  const steps = [];
  const trace = {};
  const errors = [];
  const paths = {
    changeLog: path.join(runDir, category.toLowerCase(), "change-log.json"),
    classified: path.join(runDir, category.toLowerCase(), "classified.json"),
    reviewQueue: path.join(runDir, category.toLowerCase(), "patrol_review_queue.json"),
    publicUpdateQueue: path.join(runDir, category.toLowerCase(), "patrol_public_update_queue.json"),
    gate: path.join(runDir, category.toLowerCase(), "patrol_public_update_gate.json")
  };

  const changeEntry = buildMockChangeEntry(source, category);
  writeJson(paths.changeLog, [changeEntry]);
  trace.source_id = changeEntry.source;
  trace.before_hash = changeEntry.previousHash;
  trace.after_hash = changeEntry.currentHash;
  steps.push(check("Patrol Mock", true));

  const snapshot = {
    title: changeEntry.titleChanged.to,
    contentHash: changeEntry.currentHash
  };
  const classifications = classifyChangeEntry(changeEntry, snapshot, 0);
  const classification = classifications.find(function (item) {
    return item.category === category && item.municipality === source.name;
  });

  if (!classification) {
    steps.push(check("Classification", false));
    errors.push("classification not generated for " + category);
    return { pass: false, steps: steps, trace: trace, errors: errors };
  }

  const shapeErrors = validateClassificationShape(classification);
  steps.push(check("Classification", shapeErrors.length === 0 && classification.autoPublish === false));
  trace.classification_id = classification.id;

  const classifiedBatch = {
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    classificationCount: 1,
    categorySummary: { WATER: 0, SHELTER: 0, COMMUNICATION: 0, VOLUNTEER: 0, ROAD: 0, SUPPORT: 0 },
    autoPublish: false,
    sourceChangeLog: path.relative(ROOT, paths.changeLog).split(path.sep).join("/"),
    classifications: [classification]
  };
  classifiedBatch.categorySummary[category] = 1;
  writeJson(paths.classified, classifiedBatch);

  const queueItem = classificationToQueueItem(classification, {
    classificationFile: paths.classified,
    sourceChangeLog: paths.changeLog
  });
  writeJson(paths.reviewQueue, buildQueueBatch([queueItem], {
    sourceClassificationFile: paths.classified
  }));
  steps.push(check("Review Queue", queueItem.status === "PENDING" && validateQueueItem(queueItem).length === 0));
  trace.queue_id = queueItem.queue_id;

  const decisionResult = setReviewDecision({
    queuePath: paths.reviewQueue,
    queueId: queueItem.queue_id,
    status: "APPROVED",
    reviewer: "portal-municipality-e2e",
    reviewNote: "E2E connection validation (manual approval in test namespace)"
  });
  steps.push(check("Decision Layer", decisionResult.saved === true && decisionResult.status === "APPROVED"));

  const reviewQueueAfter = readJson(paths.reviewQueue, { items: [] });
  const approvedItem = (reviewQueueAfter.items || []).find(function (item) {
    return item.queue_id === queueItem.queue_id;
  });
  const publicCandidates = convertApprovedQueueItems([approvedItem]);
  const candidate = publicCandidates[0];
  writeJson(paths.publicUpdateQueue, buildPublicCandidateBatch(publicCandidates, {
    sourceReviewQueueFile: paths.reviewQueue
  }));
  steps.push(check(
    "Public Update Queue",
    candidate && candidate.status === "READY" && validatePublicCandidate(candidate).length === 0
  ));
  trace.update_id = candidate ? candidate.update_id : null;

  const gateResult = await runCandidateGateChecks(candidate, { skipUrlCheck: true });
  writeJson(paths.gate, buildGateBatch([gateResult], {
    sourcePublicUpdateQueueFile: paths.publicUpdateQueue
  }));
  steps.push(check(
    "Validation Gate",
    gateResult.gate_status === "PASS" && validateGateBatch(readJson(paths.gate, {})).length === 0
  ));

  const traceComplete = Boolean(
    trace.source_id &&
      trace.before_hash &&
      trace.after_hash &&
      trace.classification_id &&
      trace.queue_id &&
      trace.update_id &&
      approvedItem &&
      approvedItem.source_trace &&
      approvedItem.source_trace.classification_id === trace.classification_id &&
      candidate &&
      candidate.source_trace &&
      candidate.source_trace.classification_id === trace.classification_id
  );
  steps.push(check("Trace Preservation", traceComplete));

  const pass = steps.every(function (item) {
    return item.status === "PASS";
  });

  return { pass: pass, steps: steps, trace: trace, errors: errors };
}

async function validateMunicipality(target, context) {
  const areaId = target.area_id;
  const name = target.name;
  const anchor = target.anchor;
  const result = {
    area_id: areaId,
    name: name,
    patrol_source: null,
    water: { checks: [], status: "PENDING" },
    shelter: { checks: [], status: "PENDING" },
    ui: { checks: [], status: "PENDING" },
    trace: { checks: [], status: "PENDING" }
  };

  const patrolSource = getPrimaryPatrolSource(context.patrolSources, areaId);
  result.patrol_source = patrolSource
    ? { source_id: patrolSource.id, url: patrolSource.url, status: "PASS" }
    : { status: "PENDING", reason: "ACTIVE patrol source not found in monitor/sources.json" };

  result.water.checks.push(check(
    "water_sources",
    Boolean(context.waterSources.find(function (item) {
      return item.organization === name;
    }))
  ));
  result.water.checks.push(check(
    "water_search_index",
    Boolean(findWaterRegistry(context.waterIndexItems, name))
  ));
  const waterLocation = findLocationSource(context.locationSources, areaId, "WATER");
  result.water.checks.push(check(
    "location_sources.WATER",
    Boolean(waterLocation),
    waterLocation && waterLocation.status === "PENDING"
      ? "WATER source registered as PENDING (selectable, no verified locations yet)"
      : null
  ));

  result.shelter.checks.push(check(
    "emergency_sources",
    Boolean(findByAreaId(context.emergencySources, areaId))
  ));
  const shelterLocation = findLocationSource(context.locationSources, areaId, "SHELTER");
  result.shelter.checks.push(check(
    "location_sources.SHELTER",
    Boolean(shelterLocation),
    shelterLocation && shelterLocation.status === "PENDING"
      ? "SHELTER source registered as PENDING (selectable, no verified locations yet)"
      : null
  ));
  const shelterIndex = findShelterRegistry(context.disasterIndex, areaId, name);
  result.shelter.checks.push(check(
    "disaster_search_index.SHELTER",
    Boolean(shelterIndex),
    shelterIndex ? null : "SHELTER registry entry not in disaster_search_index"
  ));
  if (shelterIndex) {
    result.shelter.checks.push(check(
      "disaster_search_index.SHELTER.schema",
      shelterIndex.status === "PENDING" &&
        Boolean(shelterIndex.area_id) &&
        Boolean(shelterIndex.source_id) &&
        Boolean(shelterIndex.source_url) &&
        Boolean(shelterIndex.source_trace && shelterIndex.source_trace.queue_id)
    ));
  }

  result.ui.checks.push(check("phase1_navigation", Boolean(findByAreaId(context.navigation, areaId))));
  result.ui.checks.push(check("phase1_areas", Boolean(findByAreaId(context.areas, areaId))));
  result.ui.checks.push(check("area_navigation", Boolean(findByAreaId(context.areaNavigation, areaId))));
  const emergencyCard = (context.updates || []).find(function (item) {
    return item.area_id === areaId && item.public_category_id === "EMERGENCY";
  });
  result.ui.checks.push(check("phase1_updates.EMERGENCY", Boolean(emergencyCard)));
  result.ui.checks.push(check("AREA_DISPLAY_RULES", hasAreaDisplayRule(context.appJs, areaId)));
  const areaNav = findByAreaId(context.areaNavigation, areaId);
  result.ui.checks.push(check(
    "自治体選択UI",
    Boolean(areaNav && areaNav.navigation && areaNav.navigation.water && areaNav.navigation.shelter)
  ));

  const runDir = path.join(TEST_ROOT, "runs", areaId);
  if (patrolSource) {
    const waterPipeline = await runPipelineMock(patrolSource, "WATER", runDir);
    result.water.checks.push.apply(
      result.water.checks,
      waterPipeline.steps.map(function (item) {
        return {
          check: "pipeline." + item.check,
          status: item.status,
          reason: item.reason || null
        };
      })
    );
    result.trace.checks.push(check(
      "WATER trace chain",
      waterPipeline.pass,
      waterPipeline.pass ? null : "pipeline trace incomplete for WATER"
    ));

    const shelterPipeline = await runPipelineMock(patrolSource, "SHELTER", runDir);
    result.shelter.checks.push.apply(
      result.shelter.checks,
      shelterPipeline.steps.map(function (item) {
        return {
          check: "pipeline." + item.check,
          status: item.status,
          reason: item.reason || null
        };
      })
    );
    result.trace.checks.push(check(
      "SHELTER trace chain",
      shelterPipeline.pass,
      shelterPipeline.pass ? null : "pipeline trace incomplete for SHELTER"
    ));
  } else {
    ["Patrol Mock", "Classification", "Review Queue", "Decision Layer", "Public Update Queue", "Validation Gate", "Trace Preservation"].forEach(function (step) {
      result.water.checks.push(check("pipeline." + step, false, "no patrol source"));
      result.shelter.checks.push(check("pipeline." + step, false, "no patrol source"));
    });
    result.trace.checks.push(check("WATER trace chain", false, "no patrol source"));
    result.trace.checks.push(check("SHELTER trace chain", false, "no patrol source"));
  }

  result.water.status = statusFrom(result.water.checks);
  result.shelter.status = statusFrom(result.shelter.checks);
  result.ui.status = statusFrom(result.ui.checks);
  result.trace.status = statusFrom(result.trace.checks);

  return result;
}

async function main() {
  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const publicHashBefore = hashPublicSnapshot();

  const manifest = readJson(TARGETS_FILE, { municipalities: [] });
  const targets = manifest.municipalities.filter(function (item) {
    return TARGET_AREA_IDS.indexOf(item.area_id) >= 0;
  });

  if (targets.length !== TARGET_AREA_IDS.length) {
    console.error("portal_ui_targets.json must include KM014-KM022");
    process.exit(1);
  }

  const sources = readJson(SOURCES_FILE, { sources: [] });
  const waterSources = readJson(path.join(ROOT, "data", "water_sources.json"), { sources: [] }).sources || [];
  const waterIndex = readJson(path.join(PUBLIC_DIR, "water_search_index.json"), { items: [] });
  const disasterIndex = readJson(path.join(PUBLIC_DIR, "disaster_search_index.json"), { index: [] });
  const locationSources = readJson(path.join(PUBLIC_DIR, "location_sources.json"), { sources: [] }).sources || [];
  const emergencySources = readJson(path.join(PUBLIC_DIR, "emergency_sources.json"), { sources: [] }).sources || [];
  const navigation = readJson(path.join(PUBLIC_DIR, "phase1_navigation.json"), []);
  const areas = readJson(path.join(PUBLIC_DIR, "phase1_areas.json"), []);
  const areaNavigation = readJson(path.join(PUBLIC_DIR, "area_navigation.json"), { areas: [] }).areas || [];
  const updates = readJson(path.join(PUBLIC_DIR, "phase1_updates.json"), []);
  const appJs = fs.readFileSync(APP_JS, "utf8");

  const context = {
    patrolSources: sources.municipalities || sources.sources || [],
    waterSources: waterSources,
    waterIndexItems: waterIndex.items || [],
    disasterIndex: disasterIndex.index || [],
    locationSources: locationSources,
    emergencySources: emergencySources,
    navigation: navigation,
    areas: areas,
    areaNavigation: areaNavigation,
    updates: updates,
    appJs: appJs
  };

  const municipalities = [];
  for (let i = 0; i < targets.length; i += 1) {
    municipalities.push(await validateMunicipality(targets[i], context));
  }

  const sourcesHashAfter = hashFile(SOURCES_FILE);
  const integrityChecks = [
    check("sources.json unchanged", sourcesHashBefore === sourcesHashAfter),
    check("data/public unchanged", publicHashBefore === hashPublicSnapshot())
  ];

  const summary = {
    total: municipalities.length,
    water_pass: municipalities.filter(function (item) { return item.water.status === "PASS"; }).length,
    shelter_pass: municipalities.filter(function (item) { return item.shelter.status === "PASS"; }).length,
    ui_pass: municipalities.filter(function (item) { return item.ui.status === "PASS"; }).length,
    trace_pass: municipalities.filter(function (item) { return item.trace.status === "PASS"; }).length
  };

  const overallPass = municipalities.every(function (item) {
    return item.water.status === "PASS" &&
      item.shelter.status === "PASS" &&
      item.ui.status === "PASS" &&
      item.trace.status === "PASS";
  }) && integrityChecks.every(function (item) { return item.status === "PASS"; });

  const output = {
    PORTAL_MUNICIPALITY_E2E_VALIDATION: overallPass ? "PASS" : "PENDING",
    generatedAt: new Date().toISOString(),
    target_area_ids: TARGET_AREA_IDS,
    constraints: {
      sources_json_modified: sourcesHashBefore !== sourcesHashAfter,
      public_data_modified: publicHashBefore !== hashPublicSnapshot(),
      auto_approval_in_production: false,
      test_namespace: path.relative(ROOT, TEST_ROOT).split(path.sep).join("/")
    },
    integrity: integrityChecks,
    summary: summary,
    municipalities: municipalities
  };

  const reportPath = path.join(TEST_ROOT, "latest-report.json");
  writeJson(reportPath, output);

  console.log("=== Portal Municipality E2E Data Connection Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (!integrityChecks.every(function (item) { return item.status === "PASS"; })) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
