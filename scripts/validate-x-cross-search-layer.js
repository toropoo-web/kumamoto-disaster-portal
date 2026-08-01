#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const VALIDATORS = [
  "scripts/validate-disaster-social-index.js",
  "scripts/validate-disaster-social-pipeline.js",
  "scripts/validate-disaster-cross-search-community-scope.js",
  "scripts/validate-disaster-social-community-rebuild.js"
];

function main() {
  const errors = [];

  VALIDATORS.forEach(function (script) {
    const command = "node " + script;

    try {
      execSync(command, { cwd: ROOT, stdio: "inherit" });
    } catch (error) {
      errors.push(command);
    }
  });

  const result = {
    X_CROSS_SEARCH_LAYER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    validator_count: VALIDATORS.length,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("X_CROSS_SEARCH_LAYER_VALIDATION_COMPLETE");
}

main();
