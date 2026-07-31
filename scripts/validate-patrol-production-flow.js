#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const TEST_ROOT = path.join(ROOT, "data", "test", "patrol-production-flow");
const FIXTURE_FILE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "patrol-production",
  "uto-water-registry-apply.json"
);
const PATROL_FIXTURE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "disaster-pipeline-e2e",
  "uto-water-change.json"
);

const {
  runPatrolProductionFlow,
  verifyRegistryApply,
  verifySourcesIntegrity,
  verifySnapshotResult,
  createRollbackBundle,
  rollbackProductionRun,
  hashFile,
  hashPublicDirectory,
  SOURCES_FILE
} = require("../monitor/patrol-production-controller");

const { validateQueueItem } = require("../monitor/review-queue");

const { validateClassificationShape } = require("../monitor/diff-classification");

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

function assertCheck(name, pass, errors, checks, detail) {
  checks.push({ check: name, pass: pass, detail: detail || null });
  if (!pass) {
    errors.push(name + (detail ? ": " + detail : ""));
  }
}

async function main() {
  const errors = [];
  const checks = [];
  const runId = "ppf-" + new Date().toISOString().replace(/[:.]/g, "-");
  const runDir = path.join(TEST_ROOT, "runs", runId);
  const registryApplyHistoryFile = path.join(runDir, "registry_apply_history.json");
  const fixture = readJson(FIXTURE_FILE, null);

  ensureDir(runDir);

  const productionFixture = readJson(PATROL_FIXTURE, null);
  writeJson(registryApplyHistoryFile, {
    version: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    incidentScope: "2026_KUMAMOTO_EARTHQUAKE",
    entries: [fixture.registry_apply]
  });

  const sourcesHashBefore = hashFile(SOURCES_FILE);
  const publicHashBefore = hashPublicDirectory();

  const registryVerify = verifyRegistryApply([fixture.registry_apply], {
    sourceIds: [fixture.source_id]
  });
  assertCheck("registry apply APPROVED + COMPLETE", registryVerify.valid, errors, checks);
  assertCheck(
    "registry apply trace preserved",
    fixture.registry_apply.source_trace.discovery_run_id === "NDR-FIXTURE",
    errors,
    checks
  );

  const integrity = verifySourcesIntegrity(registryVerify.approved);
  assertCheck("sources.json integrity", integrity.valid, errors, checks);
  assertCheck("sources.json hash captured", Boolean(integrity.sources_hash), errors, checks);

  const result = await runPatrolProductionFlow({
    runId: runId,
    runDir: runDir,
    generatedAt: "2026-07-31T00:00:00.000Z",
    dryRun: false,
    skipHistory: true,
    persistArtifacts: true,
    sourceIds: [fixture.source_id],
    fixturePath: PATROL_FIXTURE,
    registryApplyHistoryFile: registryApplyHistoryFile
  });

  assertCheck("production flow SUCCESS", result.run.status === "SUCCESS", errors, checks);
  assertCheck("patrol executed", result.run.patrol_result.source_count === 1, errors, checks);
  assertCheck("patrol no failures", result.run.patrol_result.failed_count === 0, errors, checks);

  const snapshotVerify = verifySnapshotResult(result.run.snapshot_result, registryVerify.approved);
  assertCheck("snapshot generated", snapshotVerify.valid, errors, checks);
  assertCheck(
    "snapshot source_id match",
    result.run.snapshot_result.source_id === fixture.source_id,
    errors,
    checks
  );
  assertCheck(
    "snapshot URL match",
    result.run.snapshot_result.url === productionFixture.source_url,
    errors,
    checks
  );

  assertCheck(
    "diff classification connected",
    result.run.classification_result.count >= 1,
    errors,
    checks
  );

  const waterClassification = (result.run.review_queue_result.items || []).find(function (item) {
    return item.category === "WATER" && item.municipality === fixture.municipality;
  });
  assertCheck("WATER classification in review queue", Boolean(waterClassification), errors, checks);

  if (waterClassification) {
    assertCheck(
      "review queue schema valid",
      validateQueueItem(waterClassification).length === 0,
      errors,
      checks
    );
    assertCheck(
      "review queue status PENDING",
      waterClassification.status === "PENDING",
      errors,
      checks
    );
    assertCheck(
      "review queue trace preserved",
      Boolean(waterClassification.source_trace && waterClassification.source_trace.classification_id),
      errors,
      checks
    );
    const classificationErrors = validateClassificationShape(
      result.run.classification_result.count
        ? readJson(path.join(runDir, "classified.json"), { classifications: [] }).classifications.find(
            function (item) {
              return item.category === "WATER";
            }
          )
        : null
    );
    assertCheck(
      "classification schema valid",
      classificationErrors.length === 0,
      errors,
      checks
    );
  }

  assertCheck(
    "sources.json unchanged",
    hashFile(SOURCES_FILE) === sourcesHashBefore,
    errors,
    checks
  );
  assertCheck(
    "public data unchanged",
    hashPublicDirectory() === publicHashBefore,
    errors,
    checks
  );

  const rollbackBundle = createRollbackBundle(runId, {
    registryApplyHistoryFile: registryApplyHistoryFile,
    snapshotFile: path.join(runDir, "snapshots.json")
  });
  assertCheck("rollback bundle created", rollbackBundle.saved === true, errors, checks);

  const rollbackResult = rollbackProductionRun(runId, { dryRun: true });
  assertCheck("rollback dry-run possible", rollbackResult.rolledBack === true, errors, checks);

  const output = {
    PATROL_PRODUCTION_CONNECTION_PASS: errors.length === 0 ? "PASS" : "FAIL",
    run_id: runId,
    checks: checks,
    errors: errors
  };

  writeJson(path.join(runDir, "validation-report.json"), output);

  console.log("=== Patrol Production Flow Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
