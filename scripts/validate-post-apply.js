#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");

const PUBLIC_FILES = [
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json"
];

const { runPostApplyValidation } = require("../monitor/post-apply-validation");
const { saveUpdateHistory, buildAppliedRecord } = require("../monitor/update-history");
const { getOperationStatus, saveOperationStatus } = require("../monitor/operation-status");

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  const requiredFiles = [
    "monitor/post-apply-validation.js",
    "monitor/update-history.js",
    "monitor/operation-status.js",
    "operations/update-history/.gitkeep"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  let validationResult;
  try {
    validationResult = await runPostApplyValidation({ appliedUrls: [] });
    if (validationResult.POST_APPLY_VALIDATION !== "PASS") {
      errors.push("Post-apply validation failed on current public data");
    }
  } catch (err) {
    errors.push("Post-apply validation error: " + err.message);
  }

  let historyResult;
  try {
    const mockApply = {
      applied: false,
      approvedCount: 0,
      previews: []
    };
    const mockApproved = [{ approvedAt: new Date().toISOString(), approvedBy: "validation", candidates: [] }];
    historyResult = saveUpdateHistory(mockApply, validationResult, mockApproved);

    ["applied.json", "validation.json", "summary.md"].forEach((name) => {
      if (!fs.existsSync(path.join(historyResult.operationDir, name))) {
        errors.push("Missing update history file: " + name);
      }
    });
  } catch (err) {
    errors.push("Update history save failed: " + err.message);
  }

  let operationStatus;
  try {
    operationStatus = await getOperationStatus();
    if (!operationStatus.CURRENT_STATUS) {
      errors.push("Operation status missing CURRENT_STATUS");
    }
    if (operationStatus.CURRENT_STATUS.MONITORING !== "ACTIVE") {
      errors.push("MONITORING should be ACTIVE");
    }
  } catch (err) {
    errors.push("Operation status failed: " + err.message);
  }

  try {
    const saved = await saveOperationStatus();
    if (!fs.existsSync(saved.statusPath)) {
      errors.push("operation-status.json not generated");
    }
  } catch (err) {
    errors.push("saveOperationStatus failed: " + err.message);
  }

  const appliedRecord = buildAppliedRecord(
    { applied: true, approvedCount: 1 },
    [{
      approvedAt: "2026-07-29T08:00:00+09:00",
      approvedBy: "test-reviewer",
      candidates: [{
        id: "TEST-001",
        municipality: "テスト市",
        url: "https://www.city.uki.kumamoto.jp/kinkyu/2606699",
        reviewStatus: "APPROVED",
        publicUpdate: { target: "phase1_updates", action: "update", fields: { displayed_updated_at: "2026-07-29T08:00:00+09:00" } }
      }]
    }]
  );

  if (!appliedRecord.entries.length) {
    errors.push("buildAppliedRecord failed");
  }

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during post-apply validation: " + file);
    }
  });

  const result = {
    AUTO_UPDATE_FLOW: errors.length === 0 ? "PASS" : "FAIL",
    POST_APPLY_VALIDATION: validationResult ? validationResult.POST_APPLY_VALIDATION : "FAIL",
    UPDATE_HISTORY: historyResult ? historyResult.UPDATE_HISTORY : "FAIL",
    OPERATION_STATUS: operationStatus ? "PASS" : "FAIL",
    PUBLIC_DATA_CHANGE: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "NONE",
    PUBLIC_DATA_AUTO_DELETE: false,
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    CURRENT_STATUS: operationStatus ? operationStatus.CURRENT_STATUS : null,
    errors
  };

  console.log("=== Post-Apply Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
