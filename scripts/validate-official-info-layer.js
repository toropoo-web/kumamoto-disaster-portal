#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const PACKAGE_JSON = path.join(ROOT, "package.json");

const X_CROSS_SEARCH_VALIDATORS = [
  "validate-disaster-social-index.js",
  "validate-disaster-social-pipeline.js",
  "validate-disaster-cross-search-community-scope.js",
  "validate-disaster-social-community-rebuild.js"
];

function resolveOfficialInfoValidators() {
  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  const testCommand = packageJson.scripts.test || "";

  return testCommand
    .split(" && ")
    .map(function (entry) {
      return entry.trim();
    })
    .filter(function (entry) {
      return entry.indexOf("node scripts/") === 0;
    })
    .filter(function (entry) {
      return !X_CROSS_SEARCH_VALIDATORS.some(function (name) {
        return entry.indexOf(name) !== -1;
      });
    })
    .filter(function (entry) {
      const scriptPath = entry.split(" ")[1];
      return fs.existsSync(path.join(ROOT, scriptPath));
    });
}

function main() {
  const validators = resolveOfficialInfoValidators();
  const errors = [];
  const skippedMissing = [];

  const packageJson = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf8"));
  (packageJson.scripts.test || "")
    .split(" && ")
    .map(function (entry) {
      return entry.trim();
    })
    .filter(function (entry) {
      return entry.indexOf("node scripts/") === 0;
    })
    .filter(function (entry) {
      return !X_CROSS_SEARCH_VALIDATORS.some(function (name) {
        return entry.indexOf(name) !== -1;
      });
    })
    .forEach(function (entry) {
      const scriptPath = entry.split(" ")[1];
      if (!fs.existsSync(path.join(ROOT, scriptPath))) {
        skippedMissing.push(entry);
      }
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
    skipped_missing_count: skippedMissing.length,
    skipped_missing: skippedMissing,
    errors: errors
  };

  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("OFFICIAL_INFO_LAYER_VALIDATION_COMPLETE");
}

main();
