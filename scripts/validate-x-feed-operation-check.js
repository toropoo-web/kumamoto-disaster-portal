#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT = path.join(__dirname, "..");
const {
  buildXFeedOperationCheck,
  validateXFeedOperationCheck,
  loadXFeedOperationCheck,
  OUTPUT_FILE,
  retainStalePreview,
  OUTPUT_PATH
} = require(path.join(ROOT, "monitor", "x-feed-operation-check"));

function runNodeScript(scriptName) {
  const result = spawnSync(process.execPath, [path.join(ROOT, "scripts", scriptName)], {
    cwd: ROOT,
    encoding: "utf8"
  });
  return {
    script: scriptName,
    pass: result.status === 0,
    status: result.status,
    output: (result.stdout || "") + (result.stderr || "")
  };
}

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function main() {
  const errors = [];
  const checks = [];

  const existing = loadXFeedOperationCheck();
  if (!existing) {
    const generated = buildXFeedOperationCheck();
    writeReport(generated);
  }

  const loaded = loadXFeedOperationCheck() || buildXFeedOperationCheck();
  errors.push.apply(errors, validateXFeedOperationCheck(loaded));

  checks.push({
    check: "report file exists",
    pass: fs.existsSync(OUTPUT_FILE)
  });

  checks.push({
    check: "municipality_x_feed_summary has account rows",
    pass:
      Array.isArray(loaded.municipality_x_feed_summary) &&
      loaded.municipality_x_feed_summary.every(function (row) {
        return row.account && typeof row.count === "number" && row.status;
      })
  });

  checks.push({
    check: "content classification includes A/B/C",
    pass:
      loaded.content_classification &&
      loaded.content_classification.counts &&
      ["A", "B", "C"].every(function (key) {
        return typeof loaded.content_classification.counts[key] === "number";
      })
  });

  checks.push({
    check: "PHASE39D A/B information captured",
    pass: loaded.content_classification && loaded.content_classification.ab_information_captured === true
  });
  if (!loaded.content_classification || !loaded.content_classification.ab_information_captured) {
    errors.push("PHASE39D A/B information not captured");
  }

  checks.push({
    check: "noise check present",
    pass:
      loaded.noise_check &&
      typeof loaded.noise_check.normal_post_excess === "boolean" &&
      typeof loaded.noise_check.disaster_posts_buried === "boolean"
  });

  checks.push({
    check: "fail-open check PASS",
    pass: loaded.fail_open_check && loaded.fail_open_check.status === "PASS"
  });

  const requiredValidations = [
    "validate-x-feed-fail-open.js",
    "validate-x-feed-preview.js",
    "validate-x-municipality-fetch-relax.js"
  ];

  requiredValidations.forEach(function (scriptName) {
    const result = runNodeScript(scriptName);
    checks.push({
      check: scriptName + " PASS",
      pass: result.pass
    });
    if (!result.pass) {
      errors.push(scriptName + " failed");
    }
  });

  const buildResult = spawnSync("npm", ["run", "build"], {
    cwd: ROOT,
    encoding: "utf8",
    shell: true
  });
  checks.push({
    check: "npm run build PASS",
    pass: buildResult.status === 0
  });
  if (buildResult.status !== 0) {
    errors.push("npm run build failed");
  }

  const failOpenSource = fs.readFileSync(path.join(ROOT, "scripts", "sync-x-feed.js"), "utf8");
  checks.push({
    check: "exclusion rules unchanged",
    pass: /SRC-PER-001/.test(failOpenSource) && /shinjirokoiz/.test(failOpenSource)
  });

  const output = {
    PHASE39E_X_FEED_OPERATION_CHECK: errors.length === 0 ? "PASS" : "FAIL",
    municipality_post_count: loaded.municipality_post_count,
    disaster_related_ratio: loaded.disaster_related_ratio,
    fetch_success_rate: loaded.fetch_success_rate,
    noise_assessment: loaded.noise_check ? loaded.noise_check.assessment : null,
    classification_counts: loaded.content_classification ? loaded.content_classification.counts : null,
    checks: checks,
    errors: errors
  };

  console.log("=== X Feed Operation Check Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }

  console.log("PHASE39E_X_FEED_OPERATION_CHECK_COMPLETE");
}

function writeReport(report) {
  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2) + "\n", "utf8");
}

main();
