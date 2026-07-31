#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  COUNTER_FILE,
  validateInternalOperationCounter,
  writeInternalOperationCounter,
  PORTAL_FEATURE_SURFACES
} = require("../monitor/internal-operation-counter");

const { getMunicipalityPatrolSources } = require(path.join(ROOT, "monitor", "municipality-patrol-sources"));

function main() {
  const errors = [];
  const checks = [];

  function check(name, pass, detail) {
    checks.push({ check: name, pass: pass, detail: detail || null });
    if (!pass) {
      errors.push(name + (detail ? ": " + detail : ""));
    }
  }

  check(
    "engine file exists",
    fs.existsSync(path.join(ROOT, "monitor", "internal-operation-counter.js"))
  );
  check(
    "admin page exists",
    fs.existsSync(path.join(ROOT, "admin", "internal-operation", "index.html"))
  );
  check(
    "admin script exists",
    fs.existsSync(path.join(ROOT, "admin", "js", "internal-operation-counter.js"))
  );

  const buildResult = writeInternalOperationCounter({ recordGeneration: false });
  check("counter build", buildResult.ok, (buildResult.errors || []).join("; "));
  check("counter file written", fs.existsSync(COUNTER_FILE));

  const report = JSON.parse(fs.readFileSync(COUNTER_FILE, "utf8"));
  const schemaErrors = validateInternalOperationCounter(report);
  check("counter schema", schemaErrors.length === 0, schemaErrors.join("; "));

  check("no personal data flag", report.constraints && report.constraints.no_personal_data === true);
  check("no cookies flag", report.constraints && report.constraints.no_cookies === true);
  check("no external analytics flag", report.constraints && report.constraints.no_external_analytics === true);

  const disasterIndex = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "disaster_search_index.json"), "utf8")
  );
  const items = disasterIndex.index || disasterIndex.items || [];
  const volunteerCount = items.filter(function (item) {
    return item.category === "VOLUNTEER";
  }).length;
  const waterCount = items.filter(function (item) {
    return item.category === "WATER";
  }).length;

  check("WATER category count maintained", waterCount === 43, "expected 43 got " + waterCount);
  check("VOLUNTEER category count maintained", volunteerCount === 20, "expected 20 got " + volunteerCount);
  check(
    "category_usage_count includes WATER",
    report.category_usage_count && report.category_usage_count.WATER === 43
  );
  check(
    "category_usage_count includes VOLUNTEER",
    report.category_usage_count && report.category_usage_count.VOLUNTEER === 20
  );

  const sources = require(path.join(ROOT, "monitor", "sources.json"));
  const municipalityPatrolCount = getMunicipalityPatrolSources().length;
  const communicationCount = (sources.communication || []).length;
  const patrolTotal = municipalityPatrolCount + communicationCount;
  check(
    "patrol source count maintained",
    report.patrol_status_summary && report.patrol_status_summary.source_count === 147,
    "expected 147 got " + (report.patrol_status_summary && report.patrol_status_summary.source_count)
  );
  check("patrol municipality source count", municipalityPatrolCount === 140);
  check("patrol communication source count", communicationCount === 7);
  check("patrol total sources", patrolTotal === 147);

  check(
    "page_view_count formula",
    report.page_view_count === 23 + PORTAL_FEATURE_SURFACES.length,
    "expected " + (23 + PORTAL_FEATURE_SURFACES.length)
  );
  check("last_access_time present", Boolean(report.last_access_time));

  const publicApp = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  check("public app unchanged for counter", publicApp.indexOf("INTERNAL_OPERATION_COUNTER") === -1);
  check("public index unchanged for counter", (function () {
    const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
    return html.indexOf("internal-operation") === -1;
  })());

  const output = {
    INTERNAL_OPERATION_COUNTER_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Internal Operation Counter Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }

  console.log("PHASE39B_INTERNAL_OPERATION_COUNTER_VALIDATION_COMPLETE");
}

main();
