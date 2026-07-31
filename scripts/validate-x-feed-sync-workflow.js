#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const WORKFLOW_FILE = path.join(ROOT, ".github", "workflows", "x-feed-sync.yml");

function main() {
  const errors = [];
  const workflow = fs.readFileSync(WORKFLOW_FILE, "utf8");

  const checks = [
    { id: "repository_dispatch", pass: /repository_dispatch:/.test(workflow) },
    { id: "x-feed-updated", pass: /x-feed-updated/.test(workflow) },
    { id: "schedule_backup", pass: /15,45 \* \* \* \*/.test(workflow) },
    { id: "sync_script", pass: /npm run sync:x-feed/.test(workflow) },
    { id: "validate_script", pass: /validate:x-feed/.test(workflow) },
    { id: "commit_guard", pass: /verify-public-commit-staging\.js/.test(workflow) },
    { id: "dispatch_logging", pass: /Log sync trigger/.test(workflow) }
  ];

  checks.forEach(function (check) {
    if (!check.pass) {
      errors.push("x-feed-sync workflow missing: " + check.id);
    }
  });

  const result = {
    X_FEED_SYNC_WORKFLOW_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== X Feed Sync Workflow Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
