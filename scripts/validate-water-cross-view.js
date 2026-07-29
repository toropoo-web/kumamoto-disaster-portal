#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  OUTPUT_FILE,
  PUBLIC_OUTPUT_FILE,
  buildAndWriteWaterCrossView,
  validateWaterCrossView
} = require(path.join(__dirname, "..", "monitor", "water-cross-view-engine"));

function main() {
  const errors = [];

  ["monitor/water-cross-view-engine.js", "scripts/build-water-cross-view.js"].forEach(function (file) {
    if (!fs.existsSync(path.join(ROOT, file))) {
      errors.push("Missing file: " + file);
    }
  });

  const payload = buildAndWriteWaterCrossView();
  errors.push.apply(errors, validateWaterCrossView(payload));

  if (!fs.existsSync(OUTPUT_FILE)) {
    errors.push("Missing output: data/water_cross_view.json");
  }
  if (!fs.existsSync(PUBLIC_OUTPUT_FILE)) {
    errors.push("Missing output: data/public/water_cross_view.json");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  const css = fs.readFileSync(path.join(ROOT, "css", "styles.css"), "utf8");

  [
    { name: "water cross view render", pattern: /renderWaterCrossView/ },
    { name: "water cross view load", pattern: /loadJson\("water_cross_view\.json"\)/ },
    { name: "water cross view section id", pattern: /water-cross-view/ }
  ].forEach(function (check) {
    if (!check.pattern.test(appJs)) {
      errors.push("JS check failed: " + check.name);
    }
  });

  [
    { name: "water cross view styles", pattern: /\.water-cross-view/ },
    { name: "water cross view card", pattern: /\.water-cross-view__card/ }
  ].forEach(function (check) {
    if (!check.pattern.test(css)) {
      errors.push("CSS check failed: " + check.name);
    }
  });

  const output = {
    WATER_CROSS_VIEW_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    MUNICIPALITY_COUNT: payload.municipality_count,
    TOTAL_LOCATIONS: payload.municipalities.reduce(function (sum, entry) {
      return sum + entry.location_count;
    }, 0),
    errors
  };

  console.log("=== Water Cross View Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE27_WATER_CROSS_VIEW_IMPLEMENTATION_COMPLETE");
}

main();
