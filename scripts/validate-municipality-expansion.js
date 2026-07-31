#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE_FILE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "municipality-expansion",
  "input-fixture.json"
);
const SOURCES_FILE = path.join(ROOT, "monitor", "sources.json");

const {
  runMunicipalityExpansionFlow,
  validateExpansionInput,
  resolveSpecifiedMunicipalities,
  validateMunicipalityOutput,
  validateReviewQueueItem,
  hashFile
} = require("../monitor/municipality-expansion-flow");

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function assertCheck(name, pass, errors, checks, detail) {
  checks.push({ check: name, pass: pass, detail: detail || null });
  if (!pass) {
    errors.push(name + (detail ? ": " + detail : ""));
  }
}

async function main() {
  const errors = [];
  const checks = [];
  const fixture = readJson(FIXTURE_FILE);
  const sourcesHashBefore = hashFile(SOURCES_FILE);

  const inputValidation = validateExpansionInput({
    portal: fixture.portal,
    municipalities: fixture.municipalities
  });
  assertCheck("input schema valid", inputValidation.valid, errors, checks);

  const resolved = resolveSpecifiedMunicipalities(fixture.municipalities);
  assertCheck("specified municipalities resolved", resolved.valid, errors, checks);
  assertCheck(
    "only portal-specified municipalities",
    resolved.municipalities.length === fixture.municipalities.length,
    errors,
    checks
  );

  const unknown = resolveSpecifiedMunicipalities(["存在しない自治体"]);
  assertCheck(
    "unknown municipality rejected",
    !unknown.valid && unknown.not_found.length === 1,
    errors,
    checks
  );

  const result = await runMunicipalityExpansionFlow(
    { portal: fixture.portal, municipalities: fixture.municipalities },
    {
      dryRun: true,
      generatedAt: "2026-07-31T00:00:00.000Z",
      runId: "MEX-FIXTURE-TEST",
      fixtureMap: fixture.fixture_map
    }
  );

  assertCheck("expansion flow SUCCESS", result.result.status === "SUCCESS", errors, checks);
  assertCheck(
    "municipality count matches input",
    result.result.municipality_count === fixture.municipalities.length,
    errors,
    checks
  );
  assertCheck(
    "discovery scope portal-specified only",
    result.result.discovery_scope === "PORTAL_SPECIFIED_ONLY",
    errors,
    checks
  );
  assertCheck(
    "auto municipality discovery disabled",
    result.result.safety.auto_municipality_discovery === false,
    errors,
    checks
  );
  assertCheck(
    "auto sources register disabled",
    result.result.safety.auto_sources_register === false,
    errors,
    checks
  );
  assertCheck(
    "sources.json unchanged",
    result.result.safety.sources_json_unchanged === true,
    errors,
    checks
  );
  assertCheck(
    "sources.json hash verified",
    hashFile(SOURCES_FILE) === sourcesHashBefore,
    errors,
    checks
  );

  fixture.municipalities.forEach(function (name) {
    const item = result.result.municipalities.find(function (row) {
      return row.municipality === name;
    });
    assertCheck(name + " output present", Boolean(item), errors, checks);
    if (item) {
      const shapeErrors = validateMunicipalityOutput(item);
      assertCheck(name + " output schema", shapeErrors.length === 0, errors, checks);
      assertCheck(
        name + " patrol candidates found",
        item.patrol_candidates.length >= 1,
        errors,
        checks
      );
      assertCheck(
        name + " recommended_primary set",
        Boolean(item.recommended_primary),
        errors,
        checks
      );
      assertCheck(
        name + " manual sources registration",
        item.sources_registration === "MANUAL_REQUIRED",
        errors,
        checks
      );
      assertCheck(
        name + " dry run not FAIL",
        item.dry_run_status !== "FAIL",
        errors,
        checks,
        item.dry_run_status
      );
    }
  });

  const reviewItems = result.result.review_queue.items || [];
  assertCheck("review items generated", reviewItems.length >= 1, errors, checks);
  reviewItems.forEach(function (item) {
    assertCheck(
      "review item " + item.review_id + " schema",
      validateReviewQueueItem(item).length === 0,
      errors,
      checks
    );
    assertCheck(
      "review item auto_register false",
      item.auto_register === false,
      errors,
      checks
    );
    assertCheck(
      "review item decision PENDING",
      item.decision && item.decision.status === "PENDING",
      errors,
      checks
    );
  });

  const output = {
    MUNICIPALITY_EXPANSION_FLOW_PASS: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Municipality Expansion Flow Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
