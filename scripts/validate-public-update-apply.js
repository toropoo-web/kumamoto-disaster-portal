#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.join(__dirname, "..");

const {
  buildApplyId,
  buildPublicItem,
  buildApplyQueueItem,
  buildApplyDiff,
  validateApplyDiff,
  validateApplyQueueItem,
  validateCandidateForApply,
  extractPassCandidates,
  preparePublicUpdateApply,
  rollbackPublicUpdateApply,
  hashContent,
  determineOperation
} = require("../monitor/public-update-apply-engine");

const { queueItemToPublicCandidate } = require("../monitor/review-approved-converter");
const { buildGateBatch } = require("../monitor/public-update-validation-gate");

function buildSampleQueueItem(overrides) {
  return Object.assign(
    {
      queue_id: "RQ-20260730-TEST-APPLY-WATER-01",
      municipality: "宇土市",
      category: "WATER",
      title: "水道の復旧状況について",
      source_url: "https://apply-test.example.com/water/uto-unique-" + Date.now() + ".html",
      detected_keywords: ["断水", "復旧"],
      status: "APPROVED",
      created_at: "2026-07-30T00:00:00.000Z",
      review_required: false,
      source_id: "KM002-uto-water-apply-test",
      before_hash: "before-hash",
      after_hash: "after-hash",
      changed_text: "水道の復旧状況について",
      detected_at: "2026-07-30T00:00:00.000Z",
      diff_type: "CONTENT_CHANGED",
      auto_publish: false,
      source_trace: {
        classification_id: "CLS-20260730-TEST-APPLY-WATER-01",
        classification_file: "data/update_candidates/classified-test.json",
        source_change_log: "monitor/change-log/2026-07-30.json",
        diff_type: "CONTENT_CHANGED"
      }
    },
    overrides
  );
}

function buildSampleCandidate(overrides) {
  const queueItem = buildSampleQueueItem(overrides);
  const candidate = queueItemToPublicCandidate(queueItem);
  candidate.update_id = "UPD-TEST-APPLY-" + Date.now();
  return candidate;
}

function buildTempGateFile(passCandidates, failCandidates) {
  const results = passCandidates.map(function (candidate) {
    return {
      update_id: candidate.update_id,
      gate_status: "PASS",
      validated_at: new Date().toISOString(),
      checks: [{ name: "schema", pass: true }],
      errors: [],
      candidate: candidate
    };
  });

  failCandidates.forEach(function (candidate) {
    results.push({
      update_id: candidate.update_id,
      gate_status: "FAIL",
      validated_at: new Date().toISOString(),
      checks: [{ name: "schema", pass: false }],
      errors: ["forced fail"],
      candidate: candidate
    });
  });

  const gateBatch = buildGateBatch(results, {
    sourcePublicUpdateQueueFile: "data/public_update_queue/patrol_public_update_queue.json"
  });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kumamoto-apply-test-"));
  const gatePath = path.join(tempDir, "patrol_public_update_gate.json");
  fs.writeFileSync(gatePath, JSON.stringify(gateBatch, null, 2) + "\n", "utf8");
  return { gatePath: gatePath, gateBatch: gateBatch, tempDir: tempDir };
}

function buildTempWaterFile() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kumamoto-water-test-"));
  const filePath = path.join(tempDir, "water_search_index.json");
  const data = {
    category: "WATER",
    version: 2,
    regions: ["熊本県"],
    item_count: 0,
    items: []
  };
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + "\n", "utf8");
  return { filePath: filePath, tempDir: tempDir };
}

function main() {
  const errors = [];
  const checks = [];

  const modulePath = path.join(ROOT, "monitor", "public-update-apply-engine.js");
  const scriptPath = path.join(ROOT, "scripts", "apply-public-updates.js");
  checks.push({
    check: "monitor/public-update-apply-engine.js exists",
    pass: fs.existsSync(modulePath)
  });
  checks.push({
    check: "scripts/apply-public-updates.js exists",
    pass: fs.existsSync(scriptPath)
  });

  const failCandidate = buildSampleCandidate({
    update_id: "UPD-TEST-FAIL",
    source_url: "https://apply-test.example.com/fail.html"
  });
  const passCandidate = buildSampleCandidate();
  const gateFixture = buildTempGateFile([passCandidate], [failCandidate]);
  const extracted = extractPassCandidates(gateFixture.gateBatch);

  const failRejectedPass = extracted.rejected.some(function (item) {
    return item.update_id === failCandidate.update_id && item.reason === "gate FAIL";
  });
  checks.push({ check: "Gate FAIL rejected", pass: failRejectedPass });
  if (!failRejectedPass) {
    errors.push("Gate FAIL was not rejected");
  }

  const passAcceptedPass = extracted.passed.some(function (item) {
    return item.candidate.update_id === passCandidate.update_id;
  });
  checks.push({ check: "Gate PASS accepted", pass: passAcceptedPass });
  if (!passAcceptedPass) {
    errors.push("Gate PASS was not accepted");
  }

  const pendingErrors = validateCandidateForApply(passCandidate, "PENDING");
  const pendingRejectedPass = pendingErrors.some(function (message) {
    return message.indexOf("PENDING") >= 0;
  });
  checks.push({ check: "PENDING rejected", pass: pendingRejectedPass });
  if (!pendingRejectedPass) {
    errors.push("PENDING was not rejected");
  }

  const rejectedErrors = validateCandidateForApply(passCandidate, "REJECTED");
  const rejectedRejectedPass = rejectedErrors.some(function (message) {
    return message.indexOf("REJECTED") >= 0;
  });
  checks.push({ check: "REJECTED rejected", pass: rejectedRejectedPass });
  if (!rejectedRejectedPass) {
    errors.push("REJECTED was not rejected");
  }

  const waterFixture = buildTempWaterFile();
  const newItem = buildPublicItem(passCandidate);
  const operationInfo = determineOperation(
    "water_search_index",
    JSON.parse(fs.readFileSync(waterFixture.filePath, "utf8")),
    passCandidate
  );
  const applyItem = buildApplyQueueItem(passCandidate, operationInfo, {
    applyId: buildApplyId(passCandidate.update_id)
  });
  const publicData = JSON.parse(fs.readFileSync(waterFixture.filePath, "utf8"));
  const diff = buildApplyDiff(
    applyItem,
    "water_search_index",
    publicData,
    newItem,
    operationInfo
  );

  const diffGeneratedPass = Boolean(
    diff.target === "water_search_index" &&
      diff.before &&
      diff.after &&
      Array.isArray(diff.changed_fields) &&
      diff.changed_fields.indexOf("items") >= 0 &&
      diff.before_hash &&
      diff.after_hash
  );
  checks.push({ check: "Diff generation", pass: diffGeneratedPass });
  if (!diffGeneratedPass) {
    errors.push("Diff generation failed");
  }

  const rollbackPass =
    diff.rollback &&
    diff.rollback.enabled === true &&
    diff.rollback.restore_content &&
    diff.rollback.before_hash === diff.before_hash;
  checks.push({ check: "Rollback metadata preserved", pass: rollbackPass });
  if (!rollbackPass) {
    errors.push("Rollback metadata missing");
  }

  const tracePass =
    applyItem.source_trace.queue_id === passCandidate.source_trace.queue_id &&
    diff.source_trace.queue_id === passCandidate.source_trace.queue_id;
  checks.push({ check: "source_trace preserved", pass: tracePass });
  if (!tracePass) {
    errors.push("source_trace not preserved");
  }

  const diffValidationErrors = validateApplyDiff(diff);
  checks.push({
    check: "diff schema validation",
    pass: diffValidationErrors.length === 0,
    diffValidationErrors: diffValidationErrors
  });
  if (diffValidationErrors.length) {
    errors.push.apply(errors, diffValidationErrors);
  }

  const queueValidationErrors = validateApplyQueueItem(applyItem);
  checks.push({
    check: "apply queue item validation",
    pass: queueValidationErrors.length === 0
  });
  if (queueValidationErrors.length) {
    errors.push.apply(errors, queueValidationErrors);
  }

  const prepareResult = preparePublicUpdateApply({
    gatePath: gateFixture.gatePath,
    dryRun: true,
    targetFiles: {
      water_search_index: waterFixture.filePath
    }
  });
  const preparePass =
    prepareResult.prepared === true &&
    prepareResult.itemCount === 1 &&
    prepareResult.pendingCount === 1;
  checks.push({ check: "prepare dry-run with PASS candidate", pass: preparePass });
  if (!preparePass) {
    errors.push("prepare dry-run failed");
  }

  const publicDir = path.join(ROOT, "data", "public");
  const publicBefore = fs.existsSync(publicDir)
    ? fs.readdirSync(publicDir).sort().join("|")
    : "";
  preparePublicUpdateApply({
    gatePath: gateFixture.gatePath,
    dryRun: true,
    targetFiles: {
      water_search_index: waterFixture.filePath
    }
  });
  const publicAfter = fs.existsSync(publicDir)
    ? fs.readdirSync(publicDir).sort().join("|")
    : "";
  const noPublicModifyPass = publicBefore === publicAfter;
  checks.push({ check: "prepare does not modify data/public", pass: noPublicModifyPass });
  if (!noPublicModifyPass) {
    errors.push("prepare modified data/public");
  }

  const rollbackDryRun = rollbackPublicUpdateApply("APL-NOT-FOUND", { dryRun: true });
  const rollbackMissingPass = rollbackDryRun.rolledBack === false;
  checks.push({ check: "rollback handles missing apply_id", pass: rollbackMissingPass });
  if (!rollbackMissingPass) {
    errors.push("rollback missing apply_id handling failed");
  }

  const hashStablePass = hashContent({ a: 1 }) === hashContent({ a: 1 });
  checks.push({ check: "hash generation stable", pass: hashStablePass });
  if (!hashStablePass) {
    errors.push("hash generation unstable");
  }

  try {
    fs.rmSync(gateFixture.tempDir, { recursive: true, force: true });
    fs.rmSync(waterFixture.tempDir, { recursive: true, force: true });
  } catch (cleanupErr) {
    // ignore temp cleanup errors
  }

  const result = {
    PUBLIC_UPDATE_APPLY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors,
    diffExample: {
      target: diff.target,
      operation: diff.operation,
      changed_fields: diff.changed_fields,
      before_hash: diff.before_hash,
      after_hash: diff.after_hash,
      rollback_enabled: diff.rollback && diff.rollback.enabled
    }
  };

  console.log("=== Public Update Apply Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main();
