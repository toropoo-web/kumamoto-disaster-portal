#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const VALIDATORS = [
  "scripts/validate-data.js",
  "scripts/validate-ui.js",
  "scripts/validate-communication-display.js",
  "scripts/validate-water-cross-view.js",
  "scripts/validate-water-search.js",
  "scripts/validate-water-patrol.js",
  "scripts/validate-disaster-sources.js",
  "scripts/validate-volunteer-schema.js",
  "scripts/validate-disaster-search-index.js",
  "scripts/validate-disaster-post-index.js",
  "scripts/validate-disaster-search-ui.js",
  "scripts/validate-support-service-visual-priority.js",
  "scripts/validate-support-service-coverage-operation.js",
  "scripts/validate-support-service-category-acquisition.js",
  "scripts/validate-support-service-category-review-apply.js",
  "scripts/validate-support-service-live-operation.js",
  "scripts/validate-support-service-live-patrol-final.js",
  "scripts/validate-support-service-production-readiness.js",
  "scripts/validate-support-service-operation-monitor.js",
  "scripts/validate-support-service-source-expansion-operation.js",
  "scripts/validate-support-service-source-review-registration.js",
  "scripts/validate-support-service-source-registry-apply.js",
  "scripts/validate-support-service-patrol.js",
  "scripts/validate-support-service-source-information.js",
  "scripts/validate-support-service-change-queue.js",
  "scripts/validate-support-service-x-discovery.js",
  "scripts/validate-support-service-x-public-search.js",
  "scripts/validate-support-service-phase28-keywords.js",
  "scripts/validate-municipality-top-patrol-sources.js",
  "scripts/validate-municipality-patrol-source-expansion.js",
  "scripts/validate-public-status.js",
  "scripts/validate-diff-classification.js",
  "scripts/validate-patrol-review-queue.js",
  "scripts/validate-review-approved-converter.js",
  "scripts/validate-review-decision-layer.js",
  "scripts/validate-public-update-validation-gate.js",
  "scripts/validate-public-update-apply.js",
  "scripts/validate-disaster-pipeline-e2e.js",
  "scripts/validate-patrol-url-discovery.js",
  "scripts/validate-patrol-discovery-accuracy.js --fixture-only",
  "scripts/validate-patrol-discovery-pipeline.js --fixture-only",
  "scripts/validate-municipality-registry.js",
  "scripts/validate-patrol-production-flow.js",
  "scripts/validate-municipality-expansion.js",
  "scripts/validate-x-feed-fail-open.js",
  "scripts/validate-x-feed-sync-workflow.js",
  "scripts/validate-force-update-pipeline.js",
  "scripts/validate-production-readiness.js --skip-public-hash"
];

function main() {
  const errors = [];

  VALIDATORS.forEach(function (entry) {
    const parts = entry.split(" ");
    const script = parts[0];
    const args = parts.slice(1).join(" ");
    const command = "node " + script + (args ? " " + args : "");

    try {
      execSync(command, { cwd: ROOT, stdio: "inherit" });
    } catch (error) {
      errors.push(command);
    }
  });

  const result = {
    OFFICIAL_INFO_LAYER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    validator_count: VALIDATORS.length,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("OFFICIAL_INFO_LAYER_VALIDATION_COMPLETE");
}

main();
