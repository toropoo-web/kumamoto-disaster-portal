#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  enrichSocialIndexPayload,
  normalizeSocialSourcesPayload
} = require(path.join(ROOT, "monitor", "disaster-social-source-display"));

const FILES = [
  {
    index: "data/community/disaster_social_index.json",
    sources: "data/community/disaster_social_sources.json"
  },
  {
    index: "data/public/disaster_social_index.json",
    sources: "data/public/disaster_social_sources.json"
  }
];

function main() {
  const errors = [];
  const results = [];

  FILES.forEach(function (pair) {
    const indexPath = path.join(ROOT, pair.index);
    const sourcesPath = path.join(ROOT, pair.sources);
    const sourcesPayload = normalizeSocialSourcesPayload(
      JSON.parse(fs.readFileSync(sourcesPath, "utf8"))
    );
    const indexPayload = enrichSocialIndexPayload(
      JSON.parse(fs.readFileSync(indexPath, "utf8")),
      sourcesPayload
    );

    const missingSourceType = indexPayload.entries.filter(function (entry) {
      return !entry.source_type;
    }).length;
    const missingCapturedAt = indexPayload.entries.filter(function (entry) {
      return typeof entry.captured_at !== "string";
    }).length;

    fs.writeFileSync(sourcesPath, JSON.stringify(sourcesPayload, null, 2) + "\n", "utf8");
    fs.writeFileSync(indexPath, JSON.stringify(indexPayload, null, 2) + "\n", "utf8");

    results.push({
      index: pair.index,
      entry_count: indexPayload.entries.length,
      missing_source_type: missingSourceType,
      missing_captured_at: missingCapturedAt
    });

    if (missingSourceType > 0) {
      errors.push(pair.index + " has entries without source_type");
    }
    if (missingCapturedAt > 0) {
      errors.push(pair.index + " has entries without captured_at string");
    }
  });

  console.log("=== Enrich Disaster Social Index Sources ===");
  console.log(JSON.stringify({ results: results, errors: errors }, null, 2));
  if (errors.length) {
    process.exit(1);
  }
}

main();
