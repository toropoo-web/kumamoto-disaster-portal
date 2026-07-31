#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE_HUB = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "patrol-url-discovery",
  "uto-emergency-hub.html"
);
const FIXTURE_WATER = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "patrol-url-discovery",
  "uto-water-page.html"
);

const {
  validateRegistry,
  validateMunicipalityRecord,
  validateDiscoveryTargetRecord,
  listMunicipalityTargets,
  getEnabledDiscoveryTargets,
  buildPipelineTargetsFromDiscoveryTargets,
  buildDiscoveryRunId,
  annotateReviewQueueWithRegistry,
  MUNICIPALITY_ID_PATTERN,
  DOMAIN_PATTERN,
  URL_PATTERN,
  MUNICIPALITIES_FILE,
  DISCOVERY_TARGETS_FILE
} = require("../monitor/municipality-registry");

const { normalizeUrl } = require("../monitor/patrol-url-discovery-engine");
const { SOURCES_FILE } = require("../monitor/patrol-discovery-controller");

function hashFile(filePath) {
  return require("crypto")
    .createHash("sha256")
    .update(fs.readFileSync(filePath))
    .digest("hex");
}

function runUnitTests(errors, checks) {
  const validation = validateRegistry();
  checks.push({ check: "registry validation", pass: validation.valid });
  if (!validation.valid) {
    errors.push.apply(errors, validation.errors);
  }

  checks.push({ check: "kumamoto municipality count", pass: validation.municipality_count === 45 });
  if (validation.municipality_count !== 45) {
    errors.push("expected 45 Kumamoto municipalities");
  }

  checks.push({ check: "discovery target count", pass: validation.target_count === 45 });
  if (validation.target_count !== 45) {
    errors.push("expected 45 discovery targets");
  }

  const municipalities = JSON.parse(fs.readFileSync(MUNICIPALITIES_FILE, "utf8")).municipalities;
  const duplicatePass = municipalities.every(function (item, index, array) {
    return array.findIndex(function (other) {
      return other.municipality_id === item.municipality_id;
    }) === index;
  });
  checks.push({ check: "municipality_id unique", pass: duplicatePass });
  if (!duplicatePass) {
    errors.push("duplicate municipality_id detected");
  }

  const domainPass = municipalities.every(function (item) {
    return !item.official_domain || DOMAIN_PATTERN.test(item.official_domain);
  });
  checks.push({ check: "domain format", pass: domainPass });
  if (!domainPass) {
    errors.push("invalid domain format");
  }

  const urlPass = municipalities.every(function (item) {
    return !item.official_url || URL_PATTERN.test(item.official_url);
  });
  checks.push({ check: "official_url format", pass: urlPass });
  if (!urlPass) {
    errors.push("invalid official_url format");
  }

  const inactiveExcluded = getEnabledDiscoveryTargets().every(function (target) {
    const municipality = municipalities.find(function (item) {
      return item.municipality_id === target.municipality_id;
    });
    return municipality && municipality.status === "ACTIVE";
  });
  checks.push({ check: "inactive excluded from enabled targets", pass: inactiveExcluded });
  if (!inactiveExcluded) {
    errors.push("inactive municipality included in enabled targets");
  }

  const pipelineTargets = buildPipelineTargetsFromDiscoveryTargets(
    getEnabledDiscoveryTargets({ limit: 1 })
  );
  const pipelineSchemaPass =
    pipelineTargets.targets.length === 1 &&
    Boolean(pipelineTargets.targets[0].official_domain) &&
    Boolean(pipelineTargets.targets[0].municipality_id);
  checks.push({ check: "pipeline target conversion", pass: pipelineSchemaPass });
  if (!pipelineSchemaPass) {
    errors.push("pipeline target conversion failed");
  }

  const discoveryRunId = buildDiscoveryRunId("2026-07-31T00:00:00.000Z");
  const annotated = annotateReviewQueueWithRegistry(
    {
      item_count: 1,
      items: [
        {
          review_id: "PRD-TEST",
          municipality: "宇土市",
          source_trace: { pipeline_run_id: "PDP-TEST" }
        }
      ]
    },
    discoveryRunId,
    new Map([
      [
        "JP432091",
        {
          municipality_id: "JP432091",
          target_id: "DST-432091",
          municipality: "宇土市"
        }
      ]
    ])
  );
  const tracePass =
    annotated.discovery_run_id === discoveryRunId &&
    annotated.items[0].municipality_id === "JP432091" &&
    annotated.items[0].source_trace.discovery_run_id === discoveryRunId;
  checks.push({ check: "trace preservation", pass: tracePass });
  if (!tracePass) {
    errors.push("trace preservation failed");
  }

  const idFormatPass = municipalities.every(function (item) {
    return MUNICIPALITY_ID_PATTERN.test(item.municipality_id);
  });
  checks.push({ check: "municipality_id format", pass: idFormatPass });
  if (!idFormatPass) {
    errors.push("invalid municipality_id format");
  }
}

async function runFixtureNationalDiscovery(errors, checks) {
  const { runNationalDiscovery } = require("../monitor/municipality-registry");
  const sourcesBefore = hashFile(SOURCES_FILE);

  const result = await runNationalDiscovery({
    dryRunOutput: true,
    prefecture: "熊本県",
    municipalityIds: ["JP432091"],
    limit: 1,
    generatedAt: "2026-07-31T00:00:00.000Z",
    fixtureMap: {
      宇土市: {
        entry: fs.readFileSync(FIXTURE_HUB, "utf8"),
        candidates: {
          [normalizeUrl("https://www.city.uto.lg.jp/article/view/1014/16317.html")]: fs.readFileSync(
            FIXTURE_WATER,
            "utf8"
          )
        }
      }
    }
  });

  checks.push({ check: "national discovery fixture run", pass: result.target_count === 1 });
  if (result.target_count !== 1) {
    errors.push("national discovery fixture run failed");
  }

  const targetResult = (result.national_run && result.national_run.target_results[0]) || null;
  const fixtureTracePass =
    targetResult &&
    targetResult.municipality_id === "JP432091" &&
    targetResult.discovery_run_id === result.discovery_run_id &&
    result.discovery_run_id === "NDR-2026-07-31T00-00-00-000Z";
  checks.push({ check: "fixture trace with municipality_id", pass: fixtureTracePass });
  if (!fixtureTracePass) {
    errors.push("fixture trace with municipality_id failed");
  }

  const reviewQueueSchemaPass =
    result.review_queue &&
    result.review_queue.auto_register === false &&
    (result.review_queue.items || []).every(function (item) {
      return item.source_trace && item.source_trace.discovery_run_id === result.discovery_run_id;
    });
  checks.push({ check: "review queue registry trace", pass: reviewQueueSchemaPass });
  if (!reviewQueueSchemaPass) {
    errors.push("review queue registry trace failed");
  }

  const sourcesAfter = hashFile(SOURCES_FILE);
  checks.push({ check: "sources.json unchanged", pass: sourcesBefore === sourcesAfter });
  if (sourcesBefore !== sourcesAfter) {
    errors.push("sources.json was modified");
  }
}

async function main() {
  const errors = [];
  const checks = [];

  runUnitTests(errors, checks);
  await runFixtureNationalDiscovery(errors, checks);

  const listRows = listMunicipalityTargets({ prefecture: "熊本県", activeOnly: true });
  checks.push({ check: "list command data", pass: listRows.length === 45 });
  if (listRows.length !== 45) {
    errors.push("list command data count mismatch");
  }

  const result = {
    NATIONAL_DISCOVERY_REGISTRY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    checks: checks,
    errors: errors
  };

  console.log("=== Municipality Registry Validation ===");
  console.log(JSON.stringify(result, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
