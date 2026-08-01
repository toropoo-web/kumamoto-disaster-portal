#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const PATROL_PUBLISH_VALIDATORS = [
  "node scripts/validate-data.js",
  "node scripts/validate-communication-display.js",
  "node scripts/validate-water-cross-view.js",
  "node scripts/validate-water-search.js",
  "node scripts/validate-water-patrol.js",
  "node scripts/validate-disaster-sources.js",
  "node scripts/validate-volunteer-schema.js",
  "node scripts/validate-disaster-search-index.js",
  "node scripts/validate-disaster-post-index.js",
  "node scripts/validate-municipality-top-patrol-sources.js",
  "node scripts/validate-municipality-patrol-source-expansion.js",
  "node scripts/validate-public-status.js"
];

function main() {
  const errors = [];
  const validators = PATROL_PUBLISH_VALIDATORS.filter(function (entry) {
    const scriptPath = entry.split(" ")[1];
    return fs.existsSync(path.join(ROOT, scriptPath));
  });

  validators.forEach(function (entry) {
    try {
      execSync(entry, { cwd: ROOT, stdio: "inherit" });
    } catch (error) {
      errors.push(entry);
    }
  });

  const result = {
    OFFICIAL_INFO_LAYER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    validator_count: validators.length,
    scope: "patrol_publish_gate",
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("OFFICIAL_INFO_LAYER_VALIDATION_COMPLETE");
}

main();
