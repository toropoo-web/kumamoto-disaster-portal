#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const STATIC_FILES = [
  "index.html",
  "css/styles.css",
  "js/app.js",
  "data/public/phase1_areas.json",
  "data/public/phase1_navigation.json",
  "data/public/phase1_updates.json",
  "data/public/communication_status.json",
  "data/public/status.json",
  "data/public/x_feed_preview.json",
  "data/public/area_navigation.json",
  "data/public/disaster_locations.json",
  "data/public/location_sources.json",
  "data/public/water_cross_view.json",
  "data/public/emergency_sources.json",
  "data/public/infrastructure_sources.json",
  "data/public/infrastructure_status.json"
];

function main() {
  const errors = [];

  STATIC_FILES.forEach((file) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      errors.push(`Missing: ${file}`);
      return;
    }
    if (file.endsWith(".json")) {
      try {
        JSON.parse(fs.readFileSync(full, "utf8"));
      } catch (err) {
        errors.push(`Invalid JSON: ${file} (${err.message})`);
      }
    }
  });

  const result = {
    STATIC_BUILD: errors.length === 0 ? "PASS" : "FAIL",
    JSON_LOAD: errors.filter((e) => e.includes("JSON")).length === 0 ? "PASS" : "FAIL",
    errors
  };

  console.log("=== Static Build Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }
}

main();
