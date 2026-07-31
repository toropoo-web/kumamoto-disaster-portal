#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const TEST_ROOT = path.join(ROOT, "data", "test", "disaster-pipeline-e2e");
const FIXTURE_FILE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "disaster-pipeline-e2e",
  "uto-water-change.json"
);
const PRODUCTION_PUBLIC_DIR = path.join(ROOT, "data", "public");

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

const {
  preparePublicUpdateApply,
  confirmPublicUpdateApply,
  rollbackPublicUpdateApply,
  validateCandidateForApply,
  hashContent
} = require("../monitor/public-update-apply-engine");

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

function hashDirectoryFiles(dirPath) {
  if (!fs.existsSync(dirPath)) {
    return "";
  }
  return fs
    .readdirSync(dirPath)
    .filter(function (name) {
      return name.endsWith(".json");
    })
    .sort()
    .map(function (name) {
      const content = fs.readFileSync(path.join(dirPath, name), "utf8");
      return name + ":" + crypto.createHash("sha256").update(content).digest("hex");
    })
    .join("|");
}

function assertStep(layer, condition, message, errors, steps) {
  const pass = Boolean(condition);
  steps.push({ layer: layer, pass: pass, message: message });
  if (!pass) {
    errors.push(layer + ": " + message);
  }
  return pass;
}

function buildTestWaterIndex() {
  return {
    category: "WATER",
    version: 2,
    regions: ["熊本県"],
    source_registry: "data/test/disaster-pipeline-e2e/water_sources.json",
    location_item_count: 0,
    registry_item_count: 0,
    item_count: 0,
    last_updated: "2026-07-31T00:00:00.000Z",
    items: [],
    test_namespace: "disaster-pipeline-e2e"
  };
}

async function runNegativeChecks(candidate, errors, steps) {
  const pendingErrors = validateCandidateForApply(candidate, "PENDING");
  assertStep(
    "Negative",
    pendingErrors.some(function (message) {
      return message.indexOf("PENDING") >= 0;
    }),
    "PENDING Apply rejected",
    errors,
    steps
  );

  const rejectedErrors = validateCandidateForApply(candidate, "REJECTED");
  assertStep(
    "Negative",
    rejectedErrors.some(function (message) {
      return message.indexOf("REJECTED") >= 0;
    }),
    "REJECTED Apply rejected",
    errors,
    steps
  );

  const failGateBatch = buildGateBatch(
    [
      {
        update_id: candidate.update_id,
        gate_status: "FAIL",
        validated_at: new Date().toISOString(),
        checks: [],
        errors: ["forced gate fail"],
        candidate: candidate
      }
    ],
    { sourcePublicUpdateQueueFile: "data/test/disaster-pipeline-e2e/public_update_queue.json" }
  );

  const failApplyQueue = {
    version: 1,
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    autoPublish: false,
    sourceGateFile: "data/test/disaster-pipeline-e2e/gate.json",
    itemCount: 1,
    pendingCount: 1,
    blockedCount: 0,
    items: [
      {
        apply_id: "APL-NEGATIVE-FAIL",
        update_id: candidate.update_id,
        category: candidate.category,
        target_layer: candidate.target_layer,
        operation: "ADD",
        status: "PENDING_APPLY",
        source_trace: candidate.source_trace,
        diff_file: "data/test/disaster-pipeline-e2e/diff/APL-NEGATIVE-FAIL.json"
      }
    ]
  };

  const failGatePath = path.join(TEST_ROOT, "negative-gate-fail.json");
  const failQueuePath = path.join(TEST_ROOT, "negative-apply-queue.json");
  writeJson(failGatePath, failGateBatch);
  writeJson(failQueuePath, failApplyQueue);

  const failConfirm = confirmPublicUpdateApply({
    gatePath: failGatePath,
    applyQueuePath: failQueuePath,
    dryRun: true
  });

  assertStep(
    "Negative",
    failConfirm.applied !== true &&
      (failConfirm.errors || []).some(function (message) {
        return message.indexOf("gate FAIL") >= 0 || message.indexOf("not in gate PASS") >= 0;
      }),
    "Gate FAIL Apply rejected",
    errors,
    steps
  );
}

async function main() {
  const errors = [];
  const steps = [];
  const trace = {};
  const runId = "e2e-" + new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(TEST_ROOT, "runs", runId);

  const paths = {
    changeLog: path.join(runDir, "change-log.json"),
    classified: path.join(runDir, "classified.json"),
    reviewQueue: path.join(runDir, "patrol_review_queue.json"),
    publicUpdateQueue: path.join(runDir, "patrol_public_update_queue.json"),
    gate: path.join(runDir, "patrol_public_update_gate.json"),
    applyQueue: path.join(runDir, "public_update_apply_queue.json"),
    applyHistory: path.join(runDir, "apply_history.json"),
    diffDir: path.join(runDir, "diff"),
    testWaterIndex: path.join(runDir, "public", "water_search_index.json")
  };

  ensureDir(runDir);
  ensureDir(paths.diffDir);
  ensureDir(path.dirname(paths.testWaterIndex));

  const productionHashBefore = hashDirectoryFiles(PRODUCTION_PUBLIC_DIR);
  const fixture = readJson(FIXTURE_FILE, null);
  if (!fixture) {
    console.error("fixture missing: " + FIXTURE_FILE);
    process.exit(1);
  }

  const changeEntry = fixture.change_log_entry;
  writeJson(paths.changeLog, [changeEntry]);

  assertStep(
    "Step1 Patrol Mock",
    changeEntry.source === fixture.source_id,
    "source_id preserved: " + changeEntry.source,
    errors,
    steps
  );
  assertStep(
    "Step1 Patrol Mock",
    changeEntry.previousHash && changeEntry.currentHash,
    "before_hash/after_hash present",
    errors,
    steps
  );
  trace.source_id = changeEntry.source;
  trace.before_hash = changeEntry.previousHash;
  trace.after_hash = changeEntry.currentHash;

  const classifications = classifyChangeEntry(changeEntry, fixture.snapshot, 0);
  const waterClassification = classifications.find(function (item) {
    return item.category === "WATER" && item.municipality === fixture.municipality;
  });

  assertStep(
    "Step2 Classification",
    Boolean(waterClassification),
    "WATER classification generated for 宇土市",
    errors,
    steps
  );

  if (waterClassification) {
    const classificationErrors = validateClassificationShape(waterClassification);
    assertStep(
      "Step2 Classification",
      waterClassification.category === "WATER",
      "category=WATER",
      errors,
      steps
    );
    assertStep(
      "Step2 Classification",
      waterClassification.confidence === "HIGH",
      "confidence=HIGH",
      errors,
      steps
    );
    assertStep(
      "Step2 Classification",
      waterClassification.autoPublish === false,
      "autoPublish=false",
      errors,
      steps
    );
    assertStep(
      "Step2 Classification",
      classificationErrors.length === 0,
      "classification schema valid",
      errors,
      steps
    );

    const classifiedBatch = {
      generatedAt: new Date().toISOString(),
      incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
      classificationCount: 1,
      categorySummary: {
        WATER: 1,
        SHELTER: 0,
        COMMUNICATION: 0,
        VOLUNTEER: 0,
        ROAD: 0,
        SUPPORT: 0
      },
      autoPublish: false,
      sourceChangeLog: path.relative(ROOT, paths.changeLog).split(path.sep).join("/"),
      classifications: [waterClassification]
    };
    writeJson(paths.classified, classifiedBatch);

    trace.classification_id = waterClassification.id;
  }

  const queueItem = classificationToQueueItem(waterClassification, {
    classificationFile: paths.classified,
    sourceChangeLog: paths.changeLog
  });
  const queueBatch = buildQueueBatch([queueItem], {
    sourceClassificationFile: paths.classified
  });
  writeJson(paths.reviewQueue, queueBatch);

  assertStep(
    "Step3 Review Queue",
    queueItem.status === "PENDING",
    "status=PENDING",
    errors,
    steps
  );
  assertStep(
    "Step3 Review Queue",
    queueItem.review_required === true,
    "review_required=true",
    errors,
    steps
  );
  assertStep(
    "Step3 Review Queue",
    validateQueueItem(queueItem).length === 0,
    "review queue item schema valid",
    errors,
    steps
  );
  trace.queue_id = queueItem.queue_id;

  const decisionResult = setReviewDecision({
    queuePath: paths.reviewQueue,
    queueId: queueItem.queue_id,
    status: "APPROVED",
    reviewer: "e2e-manual-reviewer",
    reviewNote: "E2E validation approval"
  });

  assertStep(
    "Step4 Decision",
    decisionResult.saved === true && decisionResult.status === "APPROVED",
    "manual APPROVED with reviewer",
    errors,
    steps
  );
  assertStep(
    "Step4 Decision",
    decisionResult.reviewer === "e2e-manual-reviewer",
    "reviewer required and recorded",
    errors,
    steps
  );

  const reviewQueueAfterDecision = readJson(paths.reviewQueue, { items: [] });
  const approvedItem = (reviewQueueAfterDecision.items || []).find(function (item) {
    return item.queue_id === queueItem.queue_id;
  });
  assertStep(
    "Step4 Decision",
    approvedItem && isApprovedQueueItem(approvedItem),
    "queue item APPROVED",
    errors,
    steps
  );

  const publicCandidates = convertApprovedQueueItems([approvedItem]);
  const publicBatch = buildPublicCandidateBatch(publicCandidates, {
    sourceReviewQueueFile: paths.reviewQueue
  });
  writeJson(paths.publicUpdateQueue, publicBatch);

  const candidate = publicCandidates[0];
  assertStep(
    "Step5 Public Update Queue",
    candidate && candidate.status === "READY",
    "status=READY",
    errors,
    steps
  );
  assertStep(
    "Step5 Public Update Queue",
    candidate && candidate.target_layer === "water_search_index",
    "target_layer exists",
    errors,
    steps
  );
  assertStep(
    "Step5 Public Update Queue",
    validatePublicCandidate(candidate).length === 0,
    "public candidate schema valid",
    errors,
    steps
  );
  trace.update_id = candidate.update_id;

  const gateResult = await runCandidateGateChecks(candidate, { skipUrlCheck: true });
  const gateBatch = buildGateBatch([gateResult], {
    sourcePublicUpdateQueueFile: paths.publicUpdateQueue
  });
  writeJson(paths.gate, gateBatch);

  assertStep(
    "Step6 Validation Gate",
    gateResult.gate_status === "PASS",
    "Gate PASS",
    errors,
    steps
  );
  assertStep(
    "Step6 Validation Gate",
    validateGateBatch(gateBatch).length === 0,
    "gate batch valid",
    errors,
    steps
  );

  writeJson(paths.testWaterIndex, buildTestWaterIndex());
  const beforeApplyHash = hashContent(readJson(paths.testWaterIndex, {}));

  const prepareResult = preparePublicUpdateApply({
    gatePath: paths.gate,
    applyQueuePath: paths.applyQueue,
    diffDir: paths.diffDir,
    targetFiles: {
      water_search_index: paths.testWaterIndex
    },
    skipUrlCheck: true
  });

  assertStep(
    "Step7 Apply Prepare",
    prepareResult.prepared === true && prepareResult.pendingCount === 1,
    "apply_queue and diff generated",
    errors,
    steps
  );
  assertStep(
    "Step7 Apply Prepare",
    fs.existsSync(paths.applyQueue),
    "apply_queue file exists",
    errors,
    steps
  );

  const applyQueue = readJson(paths.applyQueue, { items: [] });
  const applyItem = (applyQueue.items || [])[0];
  const diffPath = applyItem && applyItem.diff_file
    ? path.join(ROOT, applyItem.diff_file)
    : path.join(paths.diffDir, applyItem.apply_id + ".json");

  assertStep(
    "Step7 Apply Prepare",
    fs.existsSync(diffPath),
    "diff file exists",
    errors,
    steps
  );

  const productionHashAfterPrepare = hashDirectoryFiles(PRODUCTION_PUBLIC_DIR);
  assertStep(
    "Step7 Apply Prepare",
    productionHashBefore === productionHashAfterPrepare,
    "data/public unchanged after prepare",
    errors,
    steps
  );

  trace.apply_id = applyItem ? applyItem.apply_id : null;

  const confirmResult = confirmPublicUpdateApply({
    gatePath: paths.gate,
    applyQueuePath: paths.applyQueue,
    applyHistoryPath: paths.applyHistory,
    diffDir: paths.diffDir
  });

  const afterApplyData = readJson(paths.testWaterIndex, {});
  const afterApplyHash = hashContent(afterApplyData);

  assertStep(
    "Step8 Apply Confirm",
    confirmResult.applied === true && confirmResult.appliedCount === 1,
    "test namespace apply confirmed",
    errors,
    steps
  );
  assertStep(
    "Step8 Apply Confirm",
    afterApplyData.item_count === 1,
    "test water index updated",
    errors,
    steps
  );
  assertStep(
    "Step8 Apply Confirm",
    afterApplyHash !== beforeApplyHash,
    "after_hash generated",
    errors,
    steps
  );

  const history = readJson(paths.applyHistory, { entries: [] });
  const historyEntry = (history.entries || []).find(function (entry) {
    return entry.apply_id === trace.apply_id;
  });
  assertStep(
    "Step8 Apply Confirm",
    Boolean(historyEntry),
    "audit saved",
    errors,
    steps
  );
  assertStep(
    "Step8 Apply Confirm",
    historyEntry && historyEntry.before_hash === beforeApplyHash,
    "before_hash matches pre-apply state",
    errors,
    steps
  );

  const rollbackResult = rollbackPublicUpdateApply(trace.apply_id, {
    applyHistoryPath: paths.applyHistory,
    applyQueuePath: paths.applyQueue,
    diffDir: paths.diffDir
  });
  const afterRollbackData = readJson(paths.testWaterIndex, {});
  const afterRollbackHash = hashContent(afterRollbackData);

  assertStep(
    "Step9 Rollback",
    rollbackResult.rolledBack === true,
    "rollbackApply succeeded",
    errors,
    steps
  );
  assertStep(
    "Step9 Rollback",
    afterRollbackHash === beforeApplyHash,
    "restored state hash matches original",
    errors,
    steps
  );
  assertStep(
    "Step9 Rollback",
    afterRollbackData.item_count === 0,
    "test water index restored to empty",
    errors,
    steps
  );

  const productionHashAfterAll = hashDirectoryFiles(PRODUCTION_PUBLIC_DIR);
  assertStep(
    "Production Guard",
    productionHashBefore === productionHashAfterAll,
    "data/public production unchanged",
    errors,
    steps
  );

  assertStep(
    "Trace",
    trace.queue_id && trace.classification_id && trace.update_id && trace.apply_id,
    "queue_id/classification_id/update_id/apply_id tracked",
    errors,
    steps
  );

  if (candidate && approvedItem) {
    assertStep(
      "Trace",
      candidate.source_trace.queue_id === queueItem.queue_id &&
        candidate.source_trace.classification_id === waterClassification.id,
      "source_trace fully preserved through pipeline",
      errors,
      steps
    );
  }

  await runNegativeChecks(candidate, errors, steps);

  const layerStatus = steps.reduce(function (acc, step) {
    if (!acc[step.layer]) {
      acc[step.layer] = { pass: 0, fail: 0 };
    }
    if (step.pass) {
      acc[step.layer].pass += 1;
    } else {
      acc[step.layer].fail += 1;
    }
    return acc;
  }, {});

  const result = {
    DISASTER_PIPELINE_E2E_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    runId: runId,
    namespace: "data/test/disaster-pipeline-e2e",
    productionPublicModified: false,
    layerStatus: layerStatus,
    traceIds: trace,
    rollback: {
      apply_id: trace.apply_id,
      rolledBack: rollbackResult.rolledBack === true,
      restoredHash: afterRollbackHash,
      originalHash: beforeApplyHash
    },
    artifacts: {
      runDir: path.relative(ROOT, runDir).split(path.sep).join("/"),
      changeLog: path.relative(ROOT, paths.changeLog).split(path.sep).join("/"),
      classified: path.relative(ROOT, paths.classified).split(path.sep).join("/"),
      reviewQueue: path.relative(ROOT, paths.reviewQueue).split(path.sep).join("/"),
      publicUpdateQueue: path.relative(ROOT, paths.publicUpdateQueue).split(path.sep).join("/"),
      gate: path.relative(ROOT, paths.gate).split(path.sep).join("/"),
      applyQueue: path.relative(ROOT, paths.applyQueue).split(path.sep).join("/"),
      applyHistory: path.relative(ROOT, paths.applyHistory).split(path.sep).join("/"),
      testWaterIndex: path.relative(ROOT, paths.testWaterIndex).split(path.sep).join("/")
    },
    steps: steps,
    errors: errors
  };

  writeJson(path.join(runDir, "e2e-report.json"), result);

  console.log("=== Disaster Pipeline E2E Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
