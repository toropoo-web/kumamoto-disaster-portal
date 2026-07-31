#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const {
  loadSupportServiceSourceRegistry,
  validateSupportServiceSourceRegistry
} = require(path.join(ROOT, "monitor", "support-service-source-registry"));

const {
  collectPatrolPostsFromRegistry
} = require(path.join(ROOT, "monitor", "support-service-patrol-fetcher"));

const {
  runSupportServicePatrol,
  loadSupportServicePatrolLog,
  validateSupportServicePatrolLog
} = require(path.join(ROOT, "monitor", "support-service-patrol-engine"));

const {
  compareSupportInformationChanges
} = require(path.join(ROOT, "monitor", "support-service-diff-engine"));

const {
  buildSupportServiceChangeQueue
} = require(path.join(ROOT, "monitor", "support-service-change-queue"));

const {
  buildDisasterSearchIndex
} = require(path.join(ROOT, "monitor", "disaster-search-index-engine"));

const PUBLIC_WATER_FILES = [
  "data/water_search_index.json",
  "data/public/water_search_index.json",
  "data/water_cross_view.json",
  "data/public/water_cross_view.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function baseInformation(overrides) {
  return Object.assign(
    {
      information_id: "SSINF-PATROL0001",
      source_id: "SSRC-7E2F4A91B0",
      category: "SUPPORT_SERVICE",
      subcategory: "BATH",
      subcategory_detail: "SHOWER",
      title: "無料シャワー",
      facility_name: "熊本市総合体育館",
      address: "熊本県熊本市中央区",
      municipality: "熊本市",
      opening_type: "FREE_OPEN",
      published_at: "2026-07-28",
      available_from: "2026-07-28",
      available_until: "UNKNOWN",
      checked_at: "2026-07-31T03:00:00.000Z",
      status: "ACTIVE"
    },
    overrides || {}
  );
}

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/support-service-patrol-engine.js",
    "monitor/support-service-patrol-fetcher.js",
    "scripts/run-support-service-patrol.js",
    "data/support_service_discovery/support_service_patrol_log.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const publicHashesBefore = {};
  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (fs.existsSync(fullPath)) {
      publicHashesBefore[file] = hashFile(fullPath);
    }
  });

  const indexBefore = buildDisasterSearchIndex();
  const categoriesBefore = {};
  indexBefore.index.forEach(function (entry) {
    categoriesBefore[entry.category] = (categoriesBefore[entry.category] || 0) + 1;
  });

  const sourceRegistry = loadSupportServiceSourceRegistry();
  const registryErrors = validateSupportServiceSourceRegistry(sourceRegistry);
  checks.push({
    check: "case1 source registry load",
    pass: registryErrors.length === 0 && (sourceRegistry.sources || []).length > 0,
    sourceCount: (sourceRegistry.sources || []).length,
    errors: registryErrors
  });
  errors.push.apply(errors, registryErrors);
  if (!(sourceRegistry.sources || []).length) {
    errors.push("case1 failed: source registry is empty");
  }

  const collected = collectPatrolPostsFromRegistry(sourceRegistry, {
    fixture: true,
    referenceDate: "2026-07-31"
  });
  checks.push({
    check: "case1 patrol post collection",
    pass: collected.source_count > 0,
    sourceCount: collected.source_count,
    discoveredCount: collected.discovered_count
  });
  if (!collected.source_count) {
    errors.push("case1 failed: patrol post collection returned zero sources");
  }

  const patrolResult = runSupportServicePatrol({
    fixture: true,
    referenceDate: "2026-07-31",
    write: false,
    currentInformation: {
      informations: []
    }
  });
  checks.push({
    check: "case2 new information detection",
    pass: patrolResult.status === "SUCCESS" && patrolResult.candidate_count > 0,
    candidateCount: patrolResult.candidate_count,
    changeTypeSummary: patrolResult.change_type_summary
  });
  if (patrolResult.status !== "SUCCESS" || patrolResult.candidate_count <= 0) {
    errors.push("case2 failed: expected candidate generation from patrol");
  }
  if (!patrolResult.batch || !patrolResult.batch.candidates[0] || !patrolResult.batch.candidates[0].source_id) {
    errors.push("case2 failed: candidate missing source_id");
  } else {
    checks.push({
      check: "case2 candidate keeps source_id",
      pass: Boolean(patrolResult.batch.candidates[0].source_id)
    });
  }

  const endedDiff = compareSupportInformationChanges(
    [baseInformation({ information_id: "SSINF-ENDPATROL1", status: "ACTIVE" })],
    [
      baseInformation({
        information_id: "SSINF-ENDPATROL1",
        status: "EXPIRED",
        available_until: "2026-07-30"
      })
    ]
  );
  checks.push({
    check: "case3 ended generation",
    pass:
      endedDiff.changes.length === 1 &&
      endedDiff.changes[0].change_type === "ENDED" &&
      endedDiff.changes[0].after.status === "EXPIRED"
  });
  if (endedDiff.changes[0] && endedDiff.changes[0].change_type !== "ENDED") {
    errors.push("case3 failed: expected ENDED change");
  }

  const unchangedEntry = baseInformation({ information_id: "SSINF-UNCPATROL1" });
  const unchangedDiff = compareSupportInformationChanges(
    [unchangedEntry],
    [Object.assign({}, unchangedEntry)]
  );
  checks.push({
    check: "case4 unchanged generation",
    pass:
      unchangedDiff.changes.length === 1 && unchangedDiff.changes[0].change_type === "UNCHANGED"
  });
  if (unchangedDiff.changes[0] && unchangedDiff.changes[0].change_type !== "UNCHANGED") {
    errors.push("case4 failed: expected UNCHANGED change");
  }

  const endedQueue = buildSupportServiceChangeQueue(
    [baseInformation({ information_id: "SSINF-ENDPATROL1", status: "ACTIVE" })],
    [
      baseInformation({
        information_id: "SSINF-ENDPATROL1",
        status: "EXPIRED",
        available_until: "2026-07-30"
      })
    ]
  );
  checks.push({
    check: "case3 ended enters change queue",
    pass:
      endedQueue.change_type_summary.ENDED === 1 && endedQueue.reviewable_change_count >= 1
  });
  if (endedQueue.change_type_summary.ENDED !== 1) {
    errors.push("case3 failed: ENDED not reflected in change queue");
  }

  const unchangedQueue = buildSupportServiceChangeQueue(
    [unchangedEntry],
    [Object.assign({}, unchangedEntry)]
  );
  checks.push({
    check: "case4 unchanged stored only",
    pass:
      unchangedQueue.change_type_summary.UNCHANGED === 1 &&
      unchangedQueue.reviewable_change_count === 0
  });
  if (unchangedQueue.reviewable_change_count !== 0) {
    errors.push("case4 failed: UNCHANGED should not enter reviewable queue");
  }

  checks.push({
    check: "AUTO_PUBLISH false in patrol result",
    pass: patrolResult.AUTO_PUBLISH === false && patrolResult.auto_publish === false
  });
  if (patrolResult.AUTO_PUBLISH !== false) {
    errors.push("AUTO_PUBLISH must remain false");
  }

  const patrolLog = loadSupportServicePatrolLog();
  const patrolLogErrors = validateSupportServicePatrolLog(patrolLog);
  checks.push({
    check: "patrol log schema valid",
    pass: patrolLogErrors.length === 0,
    errors: patrolLogErrors
  });
  errors.push.apply(errors, patrolLogErrors);

  const indexAfter = buildDisasterSearchIndex();
  const categoriesAfter = {};
  indexAfter.index.forEach(function (entry) {
    categoriesAfter[entry.category] = (categoriesAfter[entry.category] || 0) + 1;
  });

  checks.push({
    check: "case5 WATER index count unchanged",
    pass: categoriesBefore.WATER === categoriesAfter.WATER,
    waterBefore: categoriesBefore.WATER,
    waterAfter: categoriesAfter.WATER
  });
  checks.push({
    check: "case5 VOLUNTEER index count unchanged",
    pass: categoriesBefore.VOLUNTEER === categoriesAfter.VOLUNTEER,
    volunteerBefore: categoriesBefore.VOLUNTEER,
    volunteerAfter: categoriesAfter.VOLUNTEER
  });
  if (categoriesBefore.WATER !== categoriesAfter.WATER) {
    errors.push("case5 failed: WATER index count changed");
  }
  if (categoriesBefore.VOLUNTEER !== categoriesAfter.VOLUNTEER) {
    errors.push("case5 failed: VOLUNTEER index count changed");
  }

  PUBLIC_WATER_FILES.forEach(function (file) {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath) || !publicHashesBefore[file]) {
      return;
    }
    const after = hashFile(fullPath);
    const pass = after === publicHashesBefore[file];
    checks.push({ check: "case5 water file unchanged: " + file, pass: pass });
    if (!pass) {
      errors.push("case5 failed: water file changed during validation: " + file);
    }
  });

  const output = {
    SUPPORT_SERVICE_PATROL_OPERATION_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLISH: false,
    sourceRegistryCount: (sourceRegistry.sources || []).length,
    patrolCandidateCount: patrolResult.candidate_count,
    indexCategoriesBefore: categoriesBefore,
    indexCategoriesAfter: categoriesAfter,
    checks: checks,
    errors: errors
  };

  console.log("=== SUPPORT_SERVICE Patrol Operation Validation (Phase20) ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE20_SUPPORT_SERVICE_PATROL_OPERATION_COMPLETE");
}

main();
