#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  sanitizeSocialJsonValue,
  containsBlockedPublicUrl
} = require(path.join(ROOT, "monitor", "disaster-social-url"));

const TARGET_FILES = [
  "data/public/disaster_social_index.json",
  "data/public/disaster_social_sources.json",
  "data/community/disaster_social_index.json",
  "data/community/disaster_social_sources.json",
  "data/community/disaster_social_inbox.json",
  "data/community/disaster_social_review_queue.json",
  "data/community/disaster_social_apply_queue.json"
];

function main() {
  const errors = [];
  const results = [];

  TARGET_FILES.forEach(function (relativePath) {
    const filePath = path.join(ROOT, relativePath);
    if (!fs.existsSync(filePath)) {
      errors.push("missing file: " + relativePath);
      return;
    }
    const original = JSON.parse(fs.readFileSync(filePath, "utf8"));
    const sanitized = sanitizeSocialJsonValue(original);
    const hadBlocked = containsBlockedPublicUrl(original);
    const hasBlocked = containsBlockedPublicUrl(sanitized);
    fs.writeFileSync(filePath, JSON.stringify(sanitized, null, 2) + "\n", "utf8");
    results.push({
      file: relativePath,
      had_blocked_urls: hadBlocked,
      has_blocked_urls: hasBlocked
    });
    if (hasBlocked) {
      errors.push("blocked urls remain in " + relativePath);
    }
  });

  console.log("=== Sanitize Disaster Social URLs ===");
  console.log(JSON.stringify({ results: results, errors: errors }, null, 2));
  if (errors.length) {
    process.exit(1);
  }
}

main();
