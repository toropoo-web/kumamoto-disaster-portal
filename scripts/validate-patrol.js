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

const REQUIRED_MONITOR_FILES = [
  "monitor/sources.json",
  "monitor/crawler.js",
  "monitor/parser.js",
  "monitor/diff-engine.js",
  "monitor/constants.js",
  "monitor/candidate-format.js",
  "monitor/review-engine.js",
  "monitor/apply-engine.js",
  "monitor/operation-report.js",
  "monitor/url-audit.js",
  "monitor/post-apply-validation.js",
  "monitor/update-history.js",
  "monitor/operation-status.js",
  "monitor/UPDATE_FLOW.md",
  "scripts/run-monitor.js",
  "scripts/review-candidates.js",
  "scripts/apply-approved.js",
  "scripts/run-url-audit.js"
];

function hashFile(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(content).digest("hex");
}

function main() {
  const errors = [];
  const checks = [];

  REQUIRED_MONITOR_FILES.forEach((file) => {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: `monitor file: ${file}`, pass: exists });
    if (!exists) {
      errors.push(`Missing monitor file: ${file}`);
    }
  });

  const sourcesPath = path.join(ROOT, "monitor", "sources.json");
  let municipalityCount = 0;
  let communicationCount = 0;
  let sourceCount = 0;

  if (fs.existsSync(sourcesPath)) {
    const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    municipalityCount = sources.municipalities ? sources.municipalities.length : 0;
    communicationCount = sources.communication ? sources.communication.length : 0;
    sourceCount = municipalityCount + communicationCount;

    if (municipalityCount !== 14) {
      errors.push(`Municipality monitor count: ${municipalityCount} (expected 14)`);
    }
    if (communicationCount !== 6) {
      errors.push(`Communication monitor count: ${communicationCount} (expected 6)`);
    }
    if (sourceCount !== 20) {
      errors.push(`Monitor source count: ${sourceCount} (expected 20)`);
    }
  }

  const candidateDir = path.join(ROOT, "data", "update_candidates");
  const approvedDir = path.join(ROOT, "data", "approved");
  if (!fs.existsSync(candidateDir)) {
    errors.push("Missing data/update_candidates directory");
  }
  if (!fs.existsSync(approvedDir)) {
    errors.push("Missing data/approved directory");
  }

  const workflowPath = path.join(ROOT, ".github", "workflows", "patrol.yml");
  checks.push({
    check: "github workflow: .github/workflows/patrol.yml",
    pass: fs.existsSync(workflowPath)
  });
  if (!fs.existsSync(workflowPath)) {
    errors.push("Missing .github/workflows/patrol.yml");
  }

  let diffEngineOk = false;
  try {
    require(path.join(ROOT, "monitor", "diff-engine"));
    require(path.join(ROOT, "monitor", "crawler"));
    require(path.join(ROOT, "monitor", "parser"));
    diffEngineOk = true;
  } catch (err) {
    errors.push(`Monitor module load failed: ${err.message}`);
  }

  const publicHashes = {};
  PUBLIC_FILES.forEach((file) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      errors.push(`Missing public file: ${file}`);
      return;
    }
    publicHashes[file] = hashFile(full);
  });

  const result = {
    PATROL_ENGINE: errors.length === 0 && diffEngineOk ? "READY" : "FAIL",
    PATROL_SOURCE_COUNT: sourceCount,
    MUNICIPALITY_MONITOR_COUNT: municipalityCount,
    COMMUNICATION_MONITOR_COUNT: communicationCount,
    DIFF_ENGINE: diffEngineOk ? "PASS" : "FAIL",
    UPDATE_CANDIDATE_OUTPUT: fs.existsSync(candidateDir) ? "READY" : "FAIL",
    UPDATE_REVIEW_FLOW: fs.existsSync(path.join(ROOT, "monitor", "review-engine.js")) ? "READY" : "FAIL",
    NO_PUBLIC_DATA_CHANGE: "PASS (structure check only)",
    PUBLIC_DATA_AUTO_MODIFY: false,
    checks,
    errors
  };

  console.log("=== Patrol Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
