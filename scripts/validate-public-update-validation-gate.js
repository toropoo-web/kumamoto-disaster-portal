#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  INCIDENT_SCOPE,
  GATE_STATUSES,
  isValidUrlFormat,
  collectContaminationErrors,
  validateGateResultShape,
  validateGateBatch,
  runCandidateGateChecks,
  buildGateBatch,
  runPublicUpdateValidationGate
} = require("../monitor/public-update-validation-gate");

const {
  queueItemToPublicCandidate,
  buildPublicCandidateBatch
} = require("../monitor/review-approved-converter");

function buildSampleQueueItem() {
  return {
    queue_id: "RQ-20260730-TEST-GATE-WATER-01",
    municipality: "宇土市",
    category: "WATER",
    title: "水道の復旧状況について",
    source_url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
    detected_keywords: ["断水", "復旧"],
    status: "APPROVED",
    created_at: "2026-07-30T00:00:00.000Z",
    review_required: false,
    source_id: "KM002-uto-water",
    original_url: "https://www.city.uto.lg.jp/article/view/1014/16317.html",
    before_hash: "before-hash",
    after_hash: "after-hash",
    changed_text: "水道の復旧状況について",
    detected_at: "2026-07-30T00:00:00.000Z",
    diff_type: "CONTENT_CHANGED",
    auto_publish: false,
    source_trace: {
      classification_id: "CLS-20260730-TEST-GATE-WATER-01",
      classification_file: "data/update_candidates/classified-test.json",
      source_change_log: "monitor/change-log/2026-07-30.json",
      diff_type: "CONTENT_CHANGED"
    }
  };
}

async function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "public-update-validation-gate.js");
  const scriptPath = path.join(ROOT, "scripts", "gate-public-updates.js");
  checks.push({
    check: "monitor/public-update-validation-gate.js exists",
    pass: fs.existsSync(modulePath)
  });
  checks.push({
    check: "scripts/gate-public-updates.js exists",
    pass: fs.existsSync(scriptPath)
  });

  if (!fs.existsSync(modulePath) || !fs.existsSync(scriptPath)) {
    errors.push("validation gate module or script missing");
  }

  GATE_STATUSES.forEach(function (status) {
    const pass = ["PASS", "FAIL", "BLOCKED"].indexOf(status) >= 0;
    checks.push({ check: "gate status enum includes " + status, pass: pass });
    if (!pass) {
      errors.push("invalid gate status enum: " + status);
    }
  });

  const urlPass = isValidUrlFormat("https://example.com/path");
  const invalidUrlPass = !isValidUrlFormat("not-a-url");
  checks.push({ check: "source_url format validation", pass: urlPass && invalidUrlPass });
  if (!urlPass || !invalidUrlPass) {
    errors.push("source_url format validation failed");
  }

  const candidate = queueItemToPublicCandidate(buildSampleQueueItem());
  const validResult = await runCandidateGateChecks(candidate, { skipUrlCheck: true });
  const validPass =
    validResult.gate_status === "PASS" &&
    validResult.errors.length === 0 &&
    validResult.candidate.update_id === candidate.update_id;
  checks.push({ check: "valid candidate passes gate", pass: validPass });
  if (!validPass) {
    errors.push("valid candidate did not pass gate");
  }

  const contaminatedCandidate = Object.assign({}, candidate, {
    update_id: "UPD-TEST-CONTAMINATION",
    title: "2016年熊本地震の情報"
  });
  const contaminationErrors = collectContaminationErrors(contaminatedCandidate);
  const contaminationPass = contaminationErrors.length > 0;
  checks.push({ check: "2016 contamination detection", pass: contaminationPass });
  if (!contaminationPass) {
    errors.push("2016 contamination not detected");
  }

  const contaminatedResult = await runCandidateGateChecks(contaminatedCandidate, {
    skipUrlCheck: true
  });
  const contaminatedFailPass =
    contaminatedResult.gate_status === "FAIL" && contaminatedResult.errors.length > 0;
  checks.push({ check: "contaminated candidate fails gate", pass: contaminatedFailPass });
  if (!contaminatedFailPass) {
    errors.push("contaminated candidate should fail gate");
  }

  const autoPublishCandidate = Object.assign({}, candidate, {
    update_id: "UPD-TEST-AUTO-PUBLISH",
    auto_publish: true
  });
  const autoPublishResult = await runCandidateGateChecks(autoPublishCandidate, {
    skipUrlCheck: true
  });
  const autoPublishFailPass =
    autoPublishResult.gate_status === "FAIL" &&
    autoPublishResult.errors.some(function (message) {
      return message.indexOf("auto_publish") >= 0;
    });
  checks.push({ check: "auto_publish true fails gate", pass: autoPublishFailPass });
  if (!autoPublishFailPass) {
    errors.push("auto_publish true should fail gate");
  }

  const gateBatch = buildGateBatch([validResult, contaminatedResult], {
    sourcePublicUpdateQueueFile: "data/public_update_queue/patrol_public_update_queue.json"
  });
  const batchShapePass =
    gateBatch.incidentScope === INCIDENT_SCOPE &&
    gateBatch.autoPublish === false &&
    gateBatch.passedUpdates.length === 1 &&
    gateBatch.failedUpdates.length === 1;
  checks.push({ check: "gate batch shape", pass: batchShapePass });
  if (!batchShapePass) {
    errors.push("gate batch shape invalid");
  }

  const batchErrors = validateGateBatch(gateBatch);
  checks.push({
    check: "gate batch validation",
    pass: batchErrors.length === 0,
    batchErrors: batchErrors
  });
  if (batchErrors.length) {
    errors.push.apply(errors, batchErrors);
  }

  const shapeErrors = validateGateResultShape(validResult);
  checks.push({ check: "gate result shape validation", pass: shapeErrors.length === 0 });
  if (shapeErrors.length) {
    errors.push.apply(errors, shapeErrors);
  }

  const emptyQueuePath = path.join(ROOT, "data", "public_update_queue", "patrol_public_update_queue.json");
  if (fs.existsSync(emptyQueuePath)) {
    const emptyRun = await runPublicUpdateValidationGate({
      inputPath: emptyQueuePath,
      dryRun: true,
      skipUrlCheck: true
    });
    const emptyPass =
      emptyRun.updateCount === 0 &&
      emptyRun.gateSummary.total === 0 &&
      emptyRun.gateSummary.passed === 0;
    checks.push({ check: "empty public update queue dry-run", pass: emptyPass });
    if (!emptyPass) {
      errors.push("empty public update queue dry-run failed");
    }
  }

  const publicDir = path.join(ROOT, "data", "public");
  const publicBefore = fs.existsSync(publicDir)
    ? fs.readdirSync(publicDir).sort().join("|")
    : "";
  await runPublicUpdateValidationGate({
    inputPath: emptyQueuePath,
    dryRun: true,
    skipUrlCheck: true
  });
  const publicAfter = fs.existsSync(publicDir)
    ? fs.readdirSync(publicDir).sort().join("|")
    : "";
  const noPublicModifyPass = publicBefore === publicAfter;
  checks.push({ check: "gate does not modify data/public", pass: noPublicModifyPass });
  if (!noPublicModifyPass) {
    errors.push("gate modified data/public");
  }

  const convertedBatch = buildPublicCandidateBatch([candidate]);
  const convertedBatchPass =
    convertedBatch.autoPublish === false && convertedBatch.incidentScope === INCIDENT_SCOPE;
  checks.push({ check: "converter batch remains compatible", pass: convertedBatchPass });
  if (!convertedBatchPass) {
    errors.push("converter batch compatibility failed");
  }

  const result = {
    PUBLIC_UPDATE_VALIDATION_GATE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Public Update Validation Gate Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
