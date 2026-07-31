#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");

const DEFAULT_ALLOWED_PREFIX = "data/public/";

function getStagedFiles() {
  return execSync("git diff --cached --name-only", { encoding: "utf8" })
    .split(/\r?\n/)
    .map(function (line) {
      return line.trim();
    })
    .filter(Boolean);
}

function verifyPublicCommitStaging(options) {
  options = options || {};
  const allowedPrefix = options.allowedPrefix || DEFAULT_ALLOWED_PREFIX;
  const extraAllowed = new Set(options.extraAllowed || []);
  const staged = getStagedFiles();
  const errors = [];

  staged.forEach(function (filePath) {
    if (filePath.indexOf(allowedPrefix) === 0 || extraAllowed.has(filePath)) {
      return;
    }
    errors.push("REFUSING_COMMIT: staged path outside allowlist: " + filePath);
  });

  return {
    PUBLIC_COMMIT_STAGING: errors.length === 0 ? "PASS" : "FAIL",
    staged: staged,
    allowedPrefix: allowedPrefix,
    errors: errors
  };
}

function main() {
  const result = verifyPublicCommitStaging();
  console.log("=== Public Commit Staging Guard ===");
  console.log(JSON.stringify(result, null, 2));

  if (result.errors.length) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  verifyPublicCommitStaging
};
