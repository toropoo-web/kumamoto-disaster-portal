#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  DISASTER_SOURCES_FILE,
  WATER_SOURCES_FILE,
  CATEGORIES,
  SOURCE_TYPES,
  REGION_KYUSHU_SOUTH,
  PREFECTURES,
  validateDisasterRegistry,
  validateWaterCompatibility,
  validateVolunteerSchemaExample,
  loadWaterSources,
  getDisasterSources
} = require("../monitor/disaster-sources");

function main() {
  const errors = [];
  const checks = [];

  [
    DISASTER_SOURCES_FILE,
    WATER_SOURCES_FILE,
    path.join(ROOT, "monitor", "disaster-sources.js")
  ].forEach(function (file) {
    const exists = fs.existsSync(file);
    checks.push({ check: path.relative(ROOT, file), pass: exists });
    if (!exists) {
      errors.push("Missing file: " + path.relative(ROOT, file));
    }
  });

  try {
    JSON.parse(fs.readFileSync(DISASTER_SOURCES_FILE, "utf8"));
    checks.push({ check: "disaster_sources.json valid JSON", pass: true });
  } catch (err) {
    errors.push("disaster_sources.json invalid JSON: " + err.message);
    checks.push({ check: "disaster_sources.json valid JSON", pass: false });
  }

  const registryResult = validateDisasterRegistry();
  errors.push.apply(errors, registryResult.errors);
  checks.push({
    check: "category coverage",
    pass: CATEGORIES.every(function (name) {
      return typeof registryResult.categoryCounts[name] === "number";
    }),
    categoryCounts: registryResult.categoryCounts
  });

  const volunteerErrors = validateVolunteerSchemaExample();
  checks.push({
    check: "VOLUNTEER schema registrable",
    pass: volunteerErrors.length === 0,
    volunteerErrors: volunteerErrors
  });
  errors.push.apply(
    errors,
    volunteerErrors.map(function (message) {
      return "VOLUNTEER schema: " + message;
    })
  );

  const waterCompatErrors = validateWaterCompatibility();
  errors.push.apply(errors, waterCompatErrors);
  checks.push({
    check: "WATER legacy compatibility",
    pass: waterCompatErrors.length === 0
  });

  const adapted = loadWaterSources();
  const activeWater = getDisasterSources("WATER", { activeOnly: true, officialOnly: true });
  checks.push({
    check: "loadWaterSources adapter",
    pass: adapted.category === "WATER" && adapted.sources.length === activeWater.length,
    adaptedCount: adapted.sources.length,
    activeWaterCount: activeWater.length
  });

  if (adapted.sources.length !== activeWater.length) {
    errors.push("loadWaterSources adapter count mismatch");
  }

  const output = {
    DISASTER_SOURCES_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    region: REGION_KYUSHU_SOUTH,
    prefectures: PREFECTURES[REGION_KYUSHU_SOUTH],
    categories: CATEGORIES,
    sourceTypes: SOURCE_TYPES,
    sourceCount: registryResult.sourceCount,
    categoryCounts: registryResult.categoryCounts,
    checks: checks,
    errors: errors
  };

  console.log("=== Disaster Sources Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("DISASTER_SOURCES_VALIDATION_COMPLETE");
}

main();
