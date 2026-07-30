#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { inspectPublishPipeline } = require("../monitor/patrol-publish-pipeline");
const { inspectSnapshotStore } = require("../monitor/patrol-snapshot-store");

function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/patrol-publish-pipeline.js",
    "monitor/patrol-snapshot-store.js",
    "monitor/public-data-build.js",
    "scripts/publish-patrol-pipeline.js",
    "scripts/seed-patrol-snapshots.js",
    "scripts/sync-patrol-public-status.js",
    "scripts/verify-public-commit-staging.js",
    "monitor/baselines/patrol-snapshots.seed.json",
    ".github/workflows/patrol.yml",
    ".github/workflows/publish-patrol.yml",
    ".github/workflows/ci.yml"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const patrolWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/patrol.yml"), "utf8");
  [
    { name: "snapshot cache restore", pattern: /actions\/cache@v4/ },
    { name: "seed patrol snapshots", pattern: /seed-patrol-snapshots\.js/ },
    { name: "review queue generation", pattern: /npm run review/ },
    { name: "sync patrol public status", pattern: /sync-patrol-public-status\.js/ },
    { name: "public index build", pattern: /npm run build/ },
    { name: "publication validation", pattern: /npm test/ },
    { name: "public commit guard", pattern: /verify-public-commit-staging\.js/ },
    { name: "water cross view commit", pattern: /water_cross_view\.json/ }
  ].forEach(function (item) {
    if (!item.pattern.test(patrolWorkflow)) {
      errors.push("patrol.yml missing: " + item.name);
    }
  });

  const publishWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/publish-patrol.yml"), "utf8");
  if (!/publish-patrol-pipeline\.js/.test(publishWorkflow)) {
    errors.push("publish-patrol.yml missing publish script");
  }
  if (!/verify-public-commit-staging\.js/.test(publishWorkflow)) {
    errors.push("publish-patrol.yml missing public commit staging guard");
  }
  if (!/--lenient/.test(publishWorkflow)) {
    errors.push("publish-patrol.yml missing lenient publish mode");
  }
  if (!/water_cross_view\.json/.test(publishWorkflow)) {
    errors.push("publish-patrol.yml missing public index commit targets");
  }

  const ciWorkflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
  if (!/npm test/.test(ciWorkflow) || !/npm run build/.test(ciWorkflow)) {
    errors.push("ci.yml must run npm test and npm run build");
  }

  const applyApprovedJs = fs.readFileSync(path.join(ROOT, "scripts", "apply-approved.js"), "utf8");
  if (!/runPublicDataBuild/.test(applyApprovedJs)) {
    errors.push("apply-approved.js must run public data build after apply");
  }

  const pipeline = inspectPublishPipeline();
  if (pipeline.pipeline.patrol !== "READY") {
    errors.push("patrol stage not ready");
  }
  if (pipeline.pipeline.reviewQueue !== "READY" && pipeline.counts.updateCandidateBatches === 0) {
    errors.push("review queue missing and no candidate batches found");
  }

  const snapshots = inspectSnapshotStore();
  if (!snapshots.files.find(function (item) {
    return item.kind === "patrol" && item.seedExists;
  })) {
    errors.push("patrol snapshot seed baseline missing");
  }

  const output = {
    PATROL_PUBLISH_PIPELINE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    pipeline: pipeline.pipeline,
    counts: pipeline.counts,
    snapshotStore: snapshots,
    checks: checks,
    errors: errors
  };

  console.log("=== Patrol Publish Pipeline Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PATROL_PUBLISH_PIPELINE_VALIDATION_COMPLETE");
}

main();
