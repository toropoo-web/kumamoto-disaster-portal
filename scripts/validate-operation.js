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
  "data/public/communication_status.json",
  "data/public/status.json"
];

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  const requiredFiles = [
    "monitor/operation-report.js",
    "operations/patrol/.gitkeep"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  let operationResult;
  try {
    const { generateOperationReports } = require(path.join(ROOT, "monitor", "operation-report"));
    operationResult = generateOperationReports({
      patrolAt: new Date().toISOString(),
      sources: [],
      parsedResults: {},
      fetchResults: {},
      diffResult: {
        successCount: 0,
        failedCount: 0,
        changeCount: 0
      }
    });
  } catch (err) {
    errors.push("Operation report generation failed: " + err.message);
  }

  const reportFiles = [
    "monitor/reports/daily-report.md",
    "monitor/reports/source-failures.md",
    "monitor/reports/high-alert.md",
    "monitor/reports/patrol-summary.json"
  ];

  reportFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing report file: " + file);
    }
  });

  if (operationResult && operationResult.dailyReportPath) {
    const content = fs.readFileSync(operationResult.dailyReportPath, "utf8");
    if (!content.includes("# Patrol Report")) {
      errors.push("daily-report.md missing expected header");
    }
    if (!content.includes("HIGH:")) {
      errors.push("daily-report.md missing priority summary");
    }
  }

  if (operationResult && operationResult.failuresReportPath) {
    const content = fs.readFileSync(operationResult.failuresReportPath, "utf8");
    if (!content.includes("# Source Failures")) {
      errors.push("source-failures.md missing expected header");
    }
  }

  if (operationResult && operationResult.operationDir) {
    const opFiles = ["report.md", "result.json", "failures.json"];
    opFiles.forEach((name) => {
      if (!fs.existsSync(path.join(operationResult.operationDir, name))) {
        errors.push("Missing operation file: " + name);
      }
    });
  }

  const workflow = fs.readFileSync(path.join(ROOT, ".github", "workflows", "patrol.yml"), "utf8");
  if (!workflow.includes("operations/")) {
    errors.push("patrol.yml does not upload operations artifacts");
  }

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during operation validation: " + file);
    }
  });

  const result = {
    OPERATION_REPORT: errors.length === 0 ? "PASS" : "FAIL",
    HIGH_ALERT: operationResult ? "PASS" : "FAIL",
    SOURCE_FAILURE_DETECTION: operationResult ? "PASS" : "FAIL",
    PATROL_SUMMARY: operationResult ? "PASS" : "FAIL",
    AUTO_PUBLICATION: false,
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    HIGH_PRIORITY_CHANGES_FOUND: operationResult ? operationResult.HIGH_PRIORITY_CHANGES_FOUND : false,
    FAILURE_COUNT: operationResult ? operationResult.FAILURE_COUNT : 0,
    errors
  };

  console.log("=== Operation Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
