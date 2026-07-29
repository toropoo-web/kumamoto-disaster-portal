#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const SNAPSHOT_FILE = path.join(ROOT, "monitor", "reports", "emergency-snapshots.json");
const CANDIDATE_FILE = path.join(ROOT, "data", "candidates", "emergency_candidates.json");
const EMERGENCY_SOURCES_FILE = path.join(ROOT, "data", "public", "emergency_sources.json");

const PUBLIC_FILES = [
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json",
  "data/public/status.json"
];

const EXPECTED_TSUNAMI_TEXT = "この地震による津波の心配はありません。";
const KM001_X_SOURCE_ID = "EMG-SRC-KM001-X-001";

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function hashContent(text) {
  return crypto.createHash("sha256").update(text || "").digest("hex");
}

function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  const requiredFiles = [
    "data/public/emergency_sources.json",
    "monitor/emergency-sources.js",
    "monitor/emergency-fetcher.js",
    "monitor/emergency-diff-engine.js",
    "scripts/run-emergency-patrol.js",
    "data/candidates/emergency_candidates.json"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  let sourceCount = 0;
  if (fs.existsSync(EMERGENCY_SOURCES_FILE)) {
    const registry = JSON.parse(fs.readFileSync(EMERGENCY_SOURCES_FILE, "utf8"));
    sourceCount = (registry.sources || []).filter((source) => source.status === "ACTIVE").length;
    if (sourceCount < 10) {
      errors.push("emergency_sources ACTIVE count too low: " + sourceCount);
    }

    const km001X = (registry.sources || []).find((source) => source.source_id === KM001_X_SOURCE_ID);
    if (!km001X || km001X.source_type !== "MUNICIPAL_X") {
      errors.push("Missing KM001 MUNICIPAL_X emergency source");
    }
  }

  const snapshotBackup = fs.existsSync(SNAPSHOT_FILE)
    ? fs.readFileSync(SNAPSHOT_FILE, "utf8")
    : null;

  const seededSnapshots = {
    version: 1,
    sources: {}
  };
  seededSnapshots.sources[KM001_X_SOURCE_ID] = {
    url: "https://x.com/city_kumamoto/status/fixture-tsunami-000",
    reachable: true,
    title: "旧スナップショット",
    originalText: "旧スナップショット（差分検知テスト用）",
    pageUpdatedAt: "2026-07-29T05:00:00+09:00",
    publishedAt: "2026-07-29T05:00:00+09:00",
    keywords: [],
    contaminationRisk: false,
    contentHash: hashContent("旧スナップショット（差分検知テスト用）"),
    checkedAt: "2026-07-29T05:00:00+09:00",
    sourceName: "熊本市",
    source_type: "MUNICIPAL_X"
  };

  fs.mkdirSync(path.dirname(SNAPSHOT_FILE), { recursive: true });
  fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify(seededSnapshots, null, 2) + "\n", "utf8");

  const patrolResult = spawnSync("node", ["scripts/run-emergency-patrol.js", "--fixture"], {
    cwd: ROOT,
    encoding: "utf8"
  });

  if (patrolResult.status !== 0) {
    errors.push("patrol:emergency --fixture failed: " + (patrolResult.stderr || patrolResult.stdout));
  }

  if (!fs.existsSync(CANDIDATE_FILE)) {
    errors.push("emergency_candidates.json not generated");
  } else {
    const candidates = JSON.parse(fs.readFileSync(CANDIDATE_FILE, "utf8"));
    const tsunamiCandidate = (candidates.candidates || []).find((candidate) => {
      return candidate.source_id === KM001_X_SOURCE_ID && candidate.original_text === EXPECTED_TSUNAMI_TEXT;
    });

    if (!tsunamiCandidate) {
      errors.push("KM001 tsunami emergency candidate not generated");
    } else {
      if (tsunamiCandidate.type !== "EMERGENCY_INFO") {
        errors.push("candidate type must be EMERGENCY_INFO");
      }
      if (tsunamiCandidate.suggestedReview !== "EMERGENCY_INFO") {
        errors.push("candidate suggestedReview must be EMERGENCY_INFO");
      }
      if (tsunamiCandidate.relatedPublicTarget !== "phase1_updates") {
        errors.push("candidate relatedPublicTarget must be phase1_updates");
      }
      if (tsunamiCandidate.review_status !== "PENDING") {
        errors.push("candidate review_status must be PENDING");
      }
    }
  }

  const approvedPath = path.join(ROOT, "data", "approved", "20260729-km001-emergency-tsunami.json");
  if (!fs.existsSync(approvedPath)) {
    errors.push("Missing approved create fixture for KM001 emergency");
  } else {
    const approved = JSON.parse(fs.readFileSync(approvedPath, "utf8"));
    const createCandidate = (approved.candidates || []).find((candidate) => {
      return candidate.publicUpdate && candidate.publicUpdate.action === "create";
    });
    if (!createCandidate) {
      errors.push("Approved fixture missing create action");
    } else if (createCandidate.publicUpdate.fields.original_text !== EXPECTED_TSUNAMI_TEXT) {
      errors.push("Approved fixture original_text mismatch");
    } else if (createCandidate.publicUpdate.target !== "phase1_updates") {
      errors.push("Approved fixture target must be phase1_updates");
    }
  }

  const updates = JSON.parse(fs.readFileSync(path.join(ROOT, "data", "public", "phase1_updates.json"), "utf8"));
  const displayed = updates.find((record) => {
    return record.emergency_source_id === KM001_X_SOURCE_ID && record.original_text === EXPECTED_TSUNAMI_TEXT;
  });
  if (!displayed) {
    errors.push("phase1_updates missing applied KM001 emergency record");
  }

  if (snapshotBackup !== null) {
    fs.writeFileSync(SNAPSHOT_FILE, snapshotBackup, "utf8");
  } else if (fs.existsSync(SNAPSHOT_FILE)) {
    fs.unlinkSync(SNAPSHOT_FILE);
  }

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during emergency patrol validation: " + file);
    }
  });

  const result = {
    EMERGENCY_PATROL: errors.length === 0 ? "PASS" : "FAIL",
    SOURCE_COUNT: sourceCount,
    PATROL_COMMAND: "npm run patrol:emergency",
    CANDIDATE: fs.existsSync(CANDIDATE_FILE) ? "PASS" : "FAIL",
    APPLY_CREATE: fs.existsSync(approvedPath) ? "PASS" : "FAIL",
    DISPLAY: displayed ? "PASS" : "FAIL",
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    errors
  };

  console.log("=== Emergency Patrol Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
