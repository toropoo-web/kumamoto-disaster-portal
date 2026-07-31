#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TARGETS_FILE = path.join(ROOT, "data", "municipality_expansion", "portal_ui_targets.json");
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");
const RUN_ROOT = path.join(ROOT, "data", "shelter_registry_apply");

const {
  classifyChangeEntry
} = require("../monitor/diff-classification");

const {
  classificationToQueueItem,
  buildQueueBatch
} = require("../monitor/review-queue");

const { setReviewDecision } = require("../monitor/review-decision-engine");

const {
  convertApprovedQueueItems,
  buildPublicCandidateBatch,
  isApprovedQueueItem
} = require("../monitor/review-approved-converter");

const {
  runCandidateGateChecks,
  buildGateBatch
} = require("../monitor/public-update-validation-gate");

const {
  preparePublicUpdateApply,
  confirmPublicUpdateApply,
  rollbackPublicUpdateApply
} = require("../monitor/public-update-apply-engine");

const SHELTER_KEYWORDS = ["避難所", "開設", "閉鎖", "避難場所"];

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

function getPrimaryPatrolSource(sources, areaId) {
  return (sources || []).find(function (item) {
    return item.area_id === areaId && item.status === "ACTIVE" && item.patrol_role === "primary";
  }) || (sources || []).find(function (item) {
    return item.area_id === areaId && item.status === "ACTIVE";
  }) || null;
}

function buildShelterChangeEntry(target, patrolSource) {
  return {
    source: patrolSource.id,
    sourceName: target.name,
    category: "municipality",
    areaId: target.area_id,
    url: target.disaster_url,
    detectedAt: new Date().toISOString(),
    changeType: "CONTENT_AND_TITLE_CHANGED",
    previousHash: "shelter-" + target.area_id + "-before",
    currentHash: "shelter-" + target.area_id + "-after",
    keywords: SHELTER_KEYWORDS,
    status: "DETECTED",
    changed_text: SHELTER_KEYWORDS.join(" ") + " 情報更新",
    titleChanged: {
      from: "防災情報",
      to: target.name + " 避難所情報"
    }
  };
}

function runPaths(areaId) {
  const base = path.join(RUN_ROOT, areaId);
  return {
    changeLog: path.join(base, "change-log.json"),
    classified: path.join(base, "classified.json"),
    reviewQueue: path.join(base, "patrol_review_queue.json"),
    publicQueue: path.join(base, "patrol_public_update_queue.json"),
    gate: path.join(base, "patrol_public_update_gate.json"),
    applyQueue: path.join(base, "public_update_apply_queue.json"),
    applyHistory: path.join(base, "apply_history.json"),
    diffDir: path.join(base, "diff")
  };
}

async function applyShelterRegistryForTarget(target, patrolSource, dryRun) {
  const paths = runPaths(target.area_id);
  ensureDir(paths.diffDir);

  const changeEntry = buildShelterChangeEntry(target, patrolSource);
  writeJson(paths.changeLog, [changeEntry]);

  const snapshot = {
    title: changeEntry.titleChanged.to,
    contentHash: changeEntry.currentHash
  };
  const classifications = classifyChangeEntry(changeEntry, snapshot, 0);
  const shelterClassification = classifications.find(function (item) {
    return item.category === "SHELTER" && item.municipality === target.name;
  });
  if (!shelterClassification) {
    return { area_id: target.area_id, status: "FAIL", reason: "SHELTER classification missing" };
  }

  writeJson(paths.classified, {
    generatedAt: new Date().toISOString(),
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    classificationCount: 1,
    categorySummary: { WATER: 0, SHELTER: 1, COMMUNICATION: 0, VOLUNTEER: 0, ROAD: 0, SUPPORT: 0 },
    autoPublish: false,
    sourceChangeLog: path.relative(ROOT, paths.changeLog).split(path.sep).join("/"),
    classifications: [shelterClassification]
  });

  const queueItem = classificationToQueueItem(shelterClassification, {
    classificationFile: paths.classified,
    sourceChangeLog: paths.changeLog
  });
  writeJson(paths.reviewQueue, buildQueueBatch([queueItem], {
    sourceClassificationFile: paths.classified
  }));

  setReviewDecision({
    queuePath: paths.reviewQueue,
    queueId: queueItem.queue_id,
    status: "APPROVED",
    reviewer: "shelter-registry-apply-operator",
    reviewNote: "SHELTER registry apply for " + target.name
  });

  const reviewQueueAfter = readJson(paths.reviewQueue, { items: [] });
  const approvedItem = (reviewQueueAfter.items || []).find(function (item) {
    return item.queue_id === queueItem.queue_id && isApprovedQueueItem(item);
  });
  if (!approvedItem) {
    return { area_id: target.area_id, status: "FAIL", reason: "review approval missing" };
  }

  const candidate = convertApprovedQueueItems([approvedItem])[0];
  writeJson(paths.publicQueue, buildPublicCandidateBatch([candidate], {
    sourceReviewQueueFile: paths.reviewQueue
  }));

  const gateResult = await runCandidateGateChecks(candidate, { skipUrlCheck: true });
  writeJson(paths.gate, buildGateBatch([gateResult], {
    sourcePublicUpdateQueueFile: paths.publicQueue
  }));

  if (gateResult.gate_status !== "PASS") {
    return { area_id: target.area_id, status: "FAIL", reason: "validation gate FAIL", errors: gateResult.errors };
  }

  const prepareResult = preparePublicUpdateApply({
    gatePath: paths.gate,
    applyQueuePath: paths.applyQueue,
    diffDir: paths.diffDir,
    skipUrlCheck: true
  });
  if (!prepareResult.prepared || prepareResult.pendingCount !== 1) {
    return { area_id: target.area_id, status: "FAIL", reason: "apply prepare failed", errors: prepareResult.errors };
  }

  const confirmResult = confirmPublicUpdateApply({
    gatePath: paths.gate,
    applyQueuePath: paths.applyQueue,
    applyHistoryPath: paths.applyHistory,
    diffDir: paths.diffDir,
    dryRun: dryRun
  });

  if (!confirmResult.applied && !dryRun) {
    return { area_id: target.area_id, status: "FAIL", reason: "apply confirm failed", errors: confirmResult.errors };
  }

  return {
    area_id: target.area_id,
    name: target.name,
    status: dryRun ? "DRY_RUN_PASS" : "PASS",
    update_id: candidate.update_id,
    queue_id: queueItem.queue_id,
    classification_id: shelterClassification.id,
    source_id: patrolSource.id
  };
}

async function main() {
  const dryRun = process.argv.indexOf("--dry-run") >= 0;
  const rollbackOnly = process.argv.indexOf("--rollback") >= 0;
  const targets = readJson(TARGETS_FILE, { municipalities: [] }).municipalities;
  const sources = readJson(SOURCES_FILE, { municipalities: [] }).municipalities || [];

  ensureDir(RUN_ROOT);

  if (rollbackOnly) {
    const rolled = [];
    targets.slice().reverse().forEach(function (target) {
      const paths = runPaths(target.area_id);
      const history = readJson(paths.applyHistory, { entries: [] });
      (history.entries || []).slice().reverse().forEach(function (entry) {
        const result = rollbackPublicUpdateApply(entry.apply_id, {
          applyHistoryPath: paths.applyHistory,
          applyQueuePath: paths.applyQueue,
          diffDir: paths.diffDir
        });
        rolled.push({ area_id: target.area_id, apply_id: entry.apply_id, rolledBack: result.rolledBack === true });
      });
    });
    console.log(JSON.stringify({ SHELTER_REGISTRY_ROLLBACK: "COMPLETE", rolled: rolled }, null, 2));
    return;
  }

  const results = [];
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const patrolSource = getPrimaryPatrolSource(sources, target.area_id);
    if (!patrolSource) {
      console.error("Missing patrol source for " + target.area_id);
      process.exit(1);
    }
    results.push(await applyShelterRegistryForTarget(target, patrolSource, dryRun));
  }

  const failed = results.filter(function (item) {
    return item.status === "FAIL";
  });

  console.log(
    JSON.stringify(
      {
        SHELTER_REGISTRY_APPLY: failed.length ? "FAIL" : dryRun ? "DRY_RUN_PASS" : "PASS",
        municipality_count: targets.length,
        applied_count: results.filter(function (item) {
          return item.status === "PASS";
        }).length,
        target_layer: "shelter_search_index",
        target_file: "data/public/disaster_search_index.json",
        results: results
      },
      null,
      2
    )
  );

  if (failed.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
