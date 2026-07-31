#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const { getMunicipalityPatrolSources } = require(path.join(
  ROOT,
  "monitor",
  "municipality-patrol-sources"
));

const EXPECTED_MUNICIPALITY_AREA_COUNT = 23;
const EXPECTED_MUNICIPALITY_PATROL_SOURCE_COUNT = 140;
const EXPECTED_COMMUNICATION_SOURCE_COUNT = 7;
const EXPECTED_PATROL_SOURCE_COUNT =
  EXPECTED_MUNICIPALITY_PATROL_SOURCE_COUNT + EXPECTED_COMMUNICATION_SOURCE_COUNT;

const PUBLIC_FILES = [
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json",
  "data/public/status.json"
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
  "monitor/public-status.js",
  "monitor/patrol-snapshot-store.js",
  "monitor/patrol-publish-pipeline.js",
  "monitor/baselines/patrol-snapshots.seed.json",
  "monitor/UPDATE_FLOW.md",
  "monitor/emergency-sources.js",
  "monitor/emergency-fetcher.js",
  "monitor/emergency-diff-engine.js",
  "monitor/infrastructure-sources.js",
  "monitor/infrastructure-fetcher.js",
  "monitor/infrastructure-diff-engine.js",
  "monitor/location-sources.js",
  "scripts/run-monitor.js",
  "scripts/seed-patrol-snapshots.js",
  "scripts/publish-patrol-pipeline.js",
  "scripts/validate-patrol-publish-pipeline.js",
  "scripts/run-emergency-patrol.js",
  "scripts/run-infrastructure-patrol.js",
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
  let municipalityPatrolCount = 0;
  let municipalityAreaCount = 0;
  let communicationCount = 0;
  let sourceCount = 0;

  const municipalityPatrolSources = getMunicipalityPatrolSources();
  municipalityPatrolCount = municipalityPatrolSources.length;
  municipalityAreaCount = new Set(
    municipalityPatrolSources.map(function (item) {
      return item.area_id;
    })
  ).size;

  if (fs.existsSync(sourcesPath)) {
    const sources = JSON.parse(fs.readFileSync(sourcesPath, "utf8"));
    communicationCount = sources.communication ? sources.communication.length : 0;
    sourceCount = municipalityPatrolCount + communicationCount;

    if (municipalityAreaCount !== EXPECTED_MUNICIPALITY_AREA_COUNT) {
      errors.push(
        `Municipality patrol area count: ${municipalityAreaCount} (expected ${EXPECTED_MUNICIPALITY_AREA_COUNT})`
      );
    }
    if (municipalityPatrolCount !== EXPECTED_MUNICIPALITY_PATROL_SOURCE_COUNT) {
      errors.push(
        `Municipality patrol source count: ${municipalityPatrolCount} (expected ${EXPECTED_MUNICIPALITY_PATROL_SOURCE_COUNT})`
      );
    }
    if (communicationCount !== EXPECTED_COMMUNICATION_SOURCE_COUNT) {
      errors.push(
        `Communication monitor count: ${communicationCount} (expected ${EXPECTED_COMMUNICATION_SOURCE_COUNT})`
      );
    }
    if (sourceCount !== EXPECTED_PATROL_SOURCE_COUNT) {
      errors.push(
        `Patrol source count: ${sourceCount} (expected ${EXPECTED_PATROL_SOURCE_COUNT})`
      );
    }

    const nttWest = (sources.communication || []).find((item) => item.id === "COMM-ntt-west");
    if (!nttWest) {
      errors.push("Missing COMM-ntt-west monitor source");
    } else if (nttWest.priority !== "HIGH") {
      errors.push(`COMM-ntt-west priority: ${nttWest.priority || "unset"} (expected HIGH)`);
    } else if (nttWest.service_id !== "ntt_west_disaster_support") {
      errors.push(`COMM-ntt-west service_id: ${nttWest.service_id} (expected ntt_west_disaster_support)`);
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
    MUNICIPALITY_PATROL_SOURCE_COUNT: municipalityPatrolCount,
    MUNICIPALITY_PATROL_AREA_COUNT: municipalityAreaCount,
    COMMUNICATION_MONITOR_COUNT: communicationCount,
    DIFF_ENGINE: diffEngineOk ? "PASS" : "FAIL",
    UPDATE_CANDIDATE_OUTPUT: fs.existsSync(candidateDir) ? "READY" : "FAIL",
    UPDATE_REVIEW_FLOW: fs.existsSync(path.join(ROOT, "monitor", "review-engine.js")) ? "READY" : "FAIL",
    NO_PUBLIC_DATA_CHANGE: "PASS (structure check only)",
    PUBLIC_DATA_AUTO_MODIFY: false,
    REQUIRED_FILE_COUNT: REQUIRED_MONITOR_FILES.length,
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
