#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  buildXFeedOperationCheck,
  validateXFeedOperationCheck,
  writeXFeedOperationCheck
} = require(path.join(ROOT, "monitor", "x-feed-operation-check"));
const { X_FEED_POSTS_URL } = require("./sync-x-feed");

function loadRawPostsForComparison() {
  const fixturePath = path.join(
    ROOT,
    "monitor",
    "fixtures",
    "x-municipality-fetch-relax",
    "posts-fixture.json"
  );
  if (fs.existsSync(fixturePath)) {
    return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  }
  return [];
}

async function main() {
  const report = buildXFeedOperationCheck({
    rawPosts: loadRawPostsForComparison(),
    generatedAt: new Date().toISOString()
  });

  const outputPath = writeXFeedOperationCheck(report);
  const errors = validateXFeedOperationCheck(report);

  const result = {
    X_FEED_OPERATION_CHECK: errors.length === 0 ? "PASS" : "FAIL",
    output: path.relative(ROOT, outputPath).split(path.sep).join("/"),
    municipality_post_count: report.municipality_post_count,
    disaster_related_ratio: report.disaster_related_ratio,
    fetch_success_rate: report.fetch_success_rate,
    noise_assessment: report.noise_check.assessment,
    errors: errors
  };

  console.log("=== X Feed Operation Check ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(JSON.stringify({ X_FEED_OPERATION_CHECK: "FAIL", error: err.message }, null, 2));
  process.exit(1);
});
