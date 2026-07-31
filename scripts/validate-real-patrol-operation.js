#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const PRODUCTION_SNAPSHOTS = path.join(ROOT, "monitor", "reports", "snapshots.json");
const PUBLIC_DIR = path.join(ROOT, "data", "public");
const TEST_ROOT = path.join(ROOT, "data", "test", "real-patrol-operation");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");

const TARGET_AREA_IDS = [
  "KM014", "KM015", "KM016", "KM017", "KM018",
  "KM019", "KM020", "KM021", "KM022"
];

const ALLOWED_CATEGORIES = ["WATER", "SHELTER", "ROAD", "SUPPORT", "COMMUNICATION"];

function normalizeDetectedChanges(detected) {
  if (!detected) {
    return [];
  }
  return Array.isArray(detected) ? detected : [detected];
}

const { fetchSource } = require("../monitor/crawler");
const { parsePage } = require("../monitor/parser");
const { compareSource } = require("../monitor/diff-engine");
const {
  classifyChangeLogEntries,
  validateClassificationShape,
  summarizeByCategory,
  writeClassificationBatch
} = require("../monitor/diff-classification");
const {
  classificationToQueueItem,
  buildQueueBatch,
  validateQueueItem,
  validateQueueBatch
} = require("../monitor/review-queue");
const {
  convertApprovedQueueItems,
  buildPublicCandidateBatch,
  queueItemToPublicCandidate,
  CATEGORY_TARGET_LAYERS,
  isApprovedQueueItem
} = require("../monitor/review-approved-converter");
const {
  runCandidateGateChecks,
  buildGateBatch,
  validateGateBatch
} = require("../monitor/public-update-validation-gate");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function writeJson(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function hashFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return crypto.createHash("sha256").update(fs.readFileSync(filePath, "utf8")).digest("hex");
}

function hashPublicSnapshot() {
  return [
    "disaster_search_index.json",
    "water_search_index.json",
    "phase1_updates.json",
    "location_sources.json"
  ]
    .map(function (name) {
      return name + ":" + hashFile(path.join(PUBLIC_DIR, name));
    })
    .join("|");
}

function check(name, pass, reason) {
  return { check: name, status: pass ? "PASS" : reason ? "PENDING" : "FAIL", reason: reason || null };
}

function loadTargetSources() {
  const sources = readJson(SOURCES_FILE, { municipalities: [] });
  return (sources.municipalities || []).filter(function (item) {
    return TARGET_AREA_IDS.indexOf(item.area_id) >= 0 && item.status === "ACTIVE";
  });
}

function groupByAreaId(sources) {
  const map = {};
  sources.forEach(function (source) {
    if (!map[source.area_id]) {
      map[source.area_id] = [];
    }
    map[source.area_id].push(source);
  });
  return map;
}

function validateClassificationEntry(entry) {
  const errors = [];
  if (ALLOWED_CATEGORIES.indexOf(entry.category) < 0) {
    errors.push("disallowed category: " + entry.category);
  }
  errors.push.apply(errors, validateClassificationShape(entry));
  if (entry.autoPublish !== false) {
    errors.push("autoPublish must be false");
  }
  if (entry.confidence !== "HIGH") {
    errors.push("speculative classification not allowed (confidence must be HIGH with keyword match)");
  }
  return errors;
}

async function main() {
  const runId = "rpo-" + new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(TEST_ROOT, "runs", runId);
  const changeLogPath = path.join(runDir, "change-log.json");
  const classifiedPath = path.join(runDir, "classified.json");
  const reviewQueuePath = path.join(runDir, "patrol_review_queue.json");
  const publicQueuePath = path.join(runDir, "patrol_public_update_queue.json");
  const gatePath = path.join(runDir, "patrol_public_update_gate.json");

  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const publicHashBefore = hashPublicSnapshot();

  const manifest = readJson(TARGETS_FILE, { municipalities: [] });
  const municipalityNames = {};
  manifest.municipalities.forEach(function (item) {
    municipalityNames[item.area_id] = item.name;
  });

  const sources = loadTargetSources();
  const sourcesByArea = groupByAreaId(sources);
  const productionSnapshots = readJson(PRODUCTION_SNAPSHOTS, { sources: {} });

  const patrolResults = [];
  const changeEntries = [];

  for (let i = 0; i < sources.length; i += 1) {
    const source = sources[i];
    const fetched = await fetchSource(source.url);
    const parsed = parsePage(fetched);
    const previous = productionSnapshots.sources[source.id] || null;
    const detected = normalizeDetectedChanges(compareSource(source, parsed, previous));
    const reachable = parsed.reachable === true;

    const entry = {
      area_id: source.area_id,
      source_id: source.id,
      municipality: source.name,
      url: source.url,
      reachable: reachable,
      has_baseline: Boolean(previous),
      change_detected: detected.length > 0,
      previous_hash: previous ? previous.contentHash : null,
      current_hash: parsed.contentHash || null,
      change_count: detected.length
    };

    if (detected.length) {
      detected.forEach(function (change) {
        changeEntries.push(change);
        if (!change.previousHash || !change.currentHash) {
          entry.hash_preservation = false;
        }
      });
      entry.hash_preservation = detected.every(function (change) {
        return change.previousHash && change.currentHash;
      });
    } else if (reachable && previous) {
      entry.hash_preservation = true;
      entry.stable = entry.previous_hash === entry.current_hash;
    } else if (reachable && !previous) {
      entry.hash_preservation = true;
      entry.stable = false;
      entry.baseline_missing = true;
    } else {
      entry.hash_preservation = false;
    }

    patrolResults.push(entry);
  }

  writeJson(changeLogPath, changeEntries);

  const testSnapshots = { sources: productionSnapshots.sources || {} };
  const classifications = classifyChangeLogEntries(changeEntries, testSnapshots);
  writeJson(
    classifiedPath,
  {
      generatedAt: new Date().toISOString(),
      incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
      classificationCount: classifications.length,
      categorySummary: summarizeByCategory(classifications),
      autoPublish: false,
      sourceChangeLog: path.relative(ROOT, changeLogPath).split(path.sep).join("/"),
      classifications: classifications
    }
  );

  const queueItems = classifications.map(function (classification) {
    return classificationToQueueItem(classification, {
      classificationFile: classifiedPath,
      sourceChangeLog: changeLogPath
    });
  });
  const reviewBatch = buildQueueBatch(queueItems, {
    sourceClassificationFile: classifiedPath
  });
  writeJson(reviewQueuePath, reviewBatch);

  const approvedItems = (reviewBatch.items || []).filter(isApprovedQueueItem);
  const publicCandidates = convertApprovedQueueItems(approvedItems);
  writeJson(
    publicQueuePath,
    buildPublicCandidateBatch(publicCandidates, {
      sourceReviewQueueFile: path.relative(ROOT, reviewQueuePath).split(path.sep).join("/")
    })
  );

  const gateResults = [];
  for (let i = 0; i < queueItems.length; i += 1) {
    const previewCandidate = queueItemToPublicCandidate(queueItems[i]);
    gateResults.push(await runCandidateGateChecks(previewCandidate, { skipUrlCheck: true }));
  }
  writeJson(
    gatePath,
    buildGateBatch(gateResults, {
      sourcePublicUpdateQueueFile: path.relative(ROOT, publicQueuePath).split(path.sep).join("/")
    })
  );

  const municipalities = TARGET_AREA_IDS.map(function (areaId) {
    const name = municipalityNames[areaId] || areaId;
    const areaPatrol = patrolResults.filter(function (item) {
      return item.area_id === areaId;
    });
    const areaChanges = changeEntries.filter(function (item) {
      const source = sources.find(function (entry) {
        return entry.id === item.source;
      });
      return source && source.area_id === areaId;
    });
    const areaClassifications = classifications.filter(function (item) {
      return item.municipality === name;
    });
    const areaQueue = (reviewBatch.items || []).filter(function (item) {
      return item.municipality === name;
    });
    const areaGate = gateResults.filter(function (item, index) {
      return areaQueue[index] && areaQueue[index].municipality === name;
    });

    const patrolChecks = [];
    patrolChecks.push(check(
      "source_fetch",
      areaPatrol.length > 0 && areaPatrol.every(function (item) {
        return item.reachable;
      }),
      areaPatrol.length ? null : "no ACTIVE sources"
    ));
    patrolChecks.push(check(
      "update_detection_or_stable",
      areaPatrol.every(function (item) {
        return item.reachable && (item.change_detected || item.stable || item.baseline_missing);
      })
    ));
    patrolChecks.push(check(
      "hash_preservation",
      areaPatrol.every(function (item) {
        return item.hash_preservation !== false;
      })
    ));

    const classificationChecks = [];
    if (areaChanges.length === 0) {
      classificationChecks.push(check("classification_entries", true, "no content change detected"));
    } else {
      classificationChecks.push(check(
        "classification_entries",
        areaClassifications.length > 0,
        "changes detected but no keyword-based classification"
      ));
      areaClassifications.forEach(function (entry, index) {
        const errors = validateClassificationEntry(entry);
        classificationChecks.push(check(
          "classification[" + index + "]." + entry.category,
          errors.length === 0,
          errors.join("; ")
        ));
      });
    }

    const reviewChecks = [];
    if (areaQueue.length === 0) {
      reviewChecks.push(check("review_queue", true, "no classifications to queue"));
    } else {
      areaQueue.forEach(function (item, index) {
        const itemErrors = validateQueueItem(item);
        reviewChecks.push(check(
          "review[" + index + "].schema",
          itemErrors.length === 0,
          itemErrors.join("; ")
        ));
        reviewChecks.push(check(
          "review[" + index + "].status=PENDING",
          item.status === "PENDING"
        ));
        reviewChecks.push(check(
          "review[" + index + "].review_required",
          item.review_required === true
        ));
        reviewChecks.push(check(
          "review[" + index + "].auto_publish",
          item.auto_publish === false
        ));
      });
    }

    const publicUpdateChecks = [
      check(
        "public_update_without_approval",
        publicCandidates.filter(function (item) {
          return item.municipality === name;
        }).length === 0
      ),
      check(
        "no_pending_in_public_queue",
        !(reviewBatch.items || []).some(function (item) {
          return item.municipality === name && item.status === "PENDING" &&
            publicCandidates.some(function (candidate) {
              return candidate.source_trace && candidate.source_trace.queue_id === item.queue_id;
            });
        })
      )
    ];

    const gateChecks = [];
    if (areaQueue.length === 0) {
      gateChecks.push(check("validation_gate", true, "no candidates without approval"));
    } else {
      areaQueue.forEach(function (item, index) {
        const preview = queueItemToPublicCandidate(item);
        const expectedLayer = CATEGORY_TARGET_LAYERS[item.category];
        gateChecks.push(check(
          "gate[" + index + "].category_mapping",
          preview && preview.target_layer === expectedLayer
        ));
        gateChecks.push(check(
          "gate[" + index + "].source_trace",
          Boolean(
            item.source_trace &&
              item.source_trace.classification_id &&
              item.source_trace.source_change_log
          )
        ));
        const gateResult = gateResults[queueItems.indexOf(item)];
        if (gateResult) {
          gateChecks.push(check(
            "gate[" + index + "].readiness",
            gateResult.gate_status === "PASS",
            gateResult.errors && gateResult.errors.length ? gateResult.errors.join("; ") : null
          ));
        }
      });
    }

    function statusFrom(checks) {
      if (checks.some(function (item) { return item.status === "FAIL"; })) {
        return "FAIL";
      }
      if (checks.some(function (item) { return item.status === "PENDING"; })) {
        return "PENDING";
      }
      return "PASS";
    }

    return {
      area_id: areaId,
      name: name,
      source_count: areaPatrol.length,
      change_count: areaChanges.length,
      patrol: { checks: patrolChecks, status: statusFrom(patrolChecks) },
      classification: { checks: classificationChecks, status: statusFrom(classificationChecks) },
      review: { checks: reviewChecks, status: statusFrom(reviewChecks) },
      public_update: { checks: publicUpdateChecks, status: statusFrom(publicUpdateChecks) },
      gate: { checks: gateChecks, status: statusFrom(gateChecks) }
    };
  });

  const integrityChecks = [
    check("sources.json unchanged", sourcesHashBefore === hashFile(SOURCES_FILE)),
    check("data/public unchanged", publicHashBefore === hashPublicSnapshot())
  ];

  const reviewBatchErrors = validateQueueBatch(reviewBatch);
  const gateBatchErrors = validateGateBatch(readJson(gatePath, {}));

  const summary = {
    source_count: sources.length,
    change_count: changeEntries.length,
    classification_count: classifications.length,
    review_count: (reviewBatch.items || []).length,
    approved_count: approvedItems.length,
    public_update_count: publicCandidates.length,
    patrol_pass: municipalities.filter(function (item) { return item.patrol.status === "PASS"; }).length,
    classification_pass: municipalities.filter(function (item) { return item.classification.status === "PASS"; }).length,
    review_pass: municipalities.filter(function (item) { return item.review.status === "PASS"; }).length,
    gate_pass: municipalities.filter(function (item) { return item.gate.status === "PASS"; }).length
  };

  const overallPass =
    integrityChecks.every(function (item) { return item.status === "PASS"; }) &&
    reviewBatchErrors.length === 0 &&
    gateBatchErrors.length === 0 &&
    approvedItems.length === 0 &&
    publicCandidates.length === 0 &&
    municipalities.every(function (item) {
      return item.patrol.status === "PASS" &&
        item.classification.status === "PASS" &&
        item.review.status === "PASS" &&
        item.gate.status === "PASS";
    });

  const output = {
    REAL_PATROL_OPERATION_VALIDATION: overallPass ? "PASS" : "PENDING",
    runId: runId,
    generatedAt: new Date().toISOString(),
    namespace: path.relative(ROOT, runDir).split(path.sep).join("/"),
    constraints: {
      sources_json_modified: sourcesHashBefore !== hashFile(SOURCES_FILE),
      public_data_modified: publicHashBefore !== hashPublicSnapshot(),
      auto_approval: false,
      apply_confirm: false
    },
    integrity: integrityChecks,
    summary: summary,
    global_checks: {
      review_batch_valid: reviewBatchErrors.length === 0,
      gate_batch_valid: gateBatchErrors.length === 0,
      approved_count: approvedItems.length,
      public_update_count: publicCandidates.length
    },
    municipalities: municipalities,
    artifacts: {
      changeLog: path.relative(ROOT, changeLogPath).split(path.sep).join("/"),
      classified: path.relative(ROOT, classifiedPath).split(path.sep).join("/"),
      reviewQueue: path.relative(ROOT, reviewQueuePath).split(path.sep).join("/"),
      publicQueue: path.relative(ROOT, publicQueuePath).split(path.sep).join("/"),
      gate: path.relative(ROOT, gatePath).split(path.sep).join("/")
    }
  };

  writeJson(path.join(TEST_ROOT, "latest-report.json"), output);

  console.log("=== Real Patrol Operation Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (!integrityChecks.every(function (item) { return item.status === "PASS"; })) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
