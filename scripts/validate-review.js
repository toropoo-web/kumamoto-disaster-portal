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

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const errors = [];
  const publicHashesBefore = {};

  PUBLIC_FILES.forEach((file) => {
    publicHashesBefore[file] = hashFile(path.join(ROOT, file));
  });

  let reviewResult;
  try {
    const { generateReviewArtifacts } = require(path.join(ROOT, "monitor", "review-engine"));
    reviewResult = generateReviewArtifacts();
  } catch (err) {
    errors.push("Review generation failed: " + err.message);
  }

  const requiredFiles = [
    "monitor/candidate-format.js",
    "monitor/review-engine.js",
    "monitor/apply-engine.js",
    "monitor/UPDATE_FLOW.md",
    "scripts/review-candidates.js",
    "scripts/apply-approved.js",
    "data/approved/.gitkeep"
  ];

  requiredFiles.forEach((file) => {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  if (!fs.existsSync(path.join(ROOT, "monitor", "reports", "review_queue.md"))) {
    errors.push("review_queue.md was not generated");
  }

  const normalizedPath = path.join(ROOT, "monitor", "reports", "normalized_candidates.json");
  if (!fs.existsSync(normalizedPath)) {
    errors.push("normalized_candidates.json was not generated");
  } else {
    const normalized = JSON.parse(fs.readFileSync(normalizedPath, "utf8"));
    normalized.candidates.forEach((candidate) => {
      const required = [
        "id",
        "source",
        "municipality",
        "url",
        "detectedAt",
        "changeType",
        "priority",
        "keywords",
        "before",
        "after",
        "reviewStatus"
      ];
      required.forEach((key) => {
        if (!Object.prototype.hasOwnProperty.call(candidate, key)) {
          errors.push("Candidate " + candidate.id + " missing field: " + key);
        }
      });
      if (!["HIGH", "MEDIUM", "LOW"].includes(candidate.priority)) {
        errors.push("Candidate " + candidate.id + " has invalid priority");
      }
    });
  }

  PUBLIC_FILES.forEach((file) => {
    const after = hashFile(path.join(ROOT, file));
    if (after !== publicHashesBefore[file]) {
      errors.push("Public data modified during review validation: " + file);
    }
  });

  const result = {
    UPDATE_CANDIDATE_PARSE: errors.length === 0 ? "PASS" : "FAIL",
    PRIORITY_CLASSIFICATION: reviewResult ? "PASS" : "FAIL",
    REVIEW_QUEUE_GENERATION: fs.existsSync(path.join(ROOT, "monitor", "reports", "review_queue.md"))
      ? "PASS"
      : "FAIL",
    PUBLIC_DATA_AUTO_MODIFY: false,
    PUBLIC_DATA_PROTECTION: errors.some((e) => e.includes("Public data modified")) ? "FAIL" : "PASS",
    CANDIDATE_COUNT: reviewResult ? reviewResult.candidateCount : 0,
    PRIORITY_COUNTS: reviewResult ? reviewResult.priorityCounts : null,
    errors
  };

  console.log("=== Review Flow Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
