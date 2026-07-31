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
const ACCURACY_SUMMARY_FILE = path.join(ROOT, "data", "patrol_discovery", "accuracy-summary.json");
const COMPARISON_REPORT_FILE = path.join(ROOT, "data", "patrol_discovery", "reports", "controller_vs_accuracy.json");

const {
  loadPipelineTargets,
  validatePipelineTargets,
  classifyRegistryComparison,
  validateReviewQueueItem,
  validatePipelineRun,
  runPatrolDiscoveryPipeline,
  SOURCES_FILE,
  PIPELINE_TARGETS_FILE
} = require("../monitor/patrol-discovery-controller");

const {
  normalizeUrl,
  calculateCandidateScore,
  resolveDiscoveryTarget,
  inferPublicCategory,
  buildPatrolCandidate
} = require("../monitor/patrol-url-discovery-engine");

const { getRegisteredSources } = require("../monitor/patrol-discovery-accuracy");

function parseArgs(argv) {
  const options = { fixtureOnly: true, live: false };
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--live") {
      options.live = true;
      options.fixtureOnly = false;
    } else if (argv[i] === "--fixture-only") {
      options.fixtureOnly = true;
      options.live = false;
    }
  }
  return options;
}

function runUnitTests(errors, checks) {
  const targets = loadPipelineTargets(PIPELINE_TARGETS_FILE);
  const targetErrors = validatePipelineTargets(targets);
  checks.push({ check: "pipeline target schema", pass: targetErrors.length === 0 });
  if (targetErrors.length) {
    errors.push.apply(errors, targetErrors);
  }

  const targetPass = targets.targets.length === 12;
  checks.push({ check: "pipeline targets count", pass: targetPass });
  if (!targetPass) {
    errors.push("expected 12 pipeline targets");
  }

  const registry = JSON.parse(fs.readFileSync(SOURCES_FILE, "utf8"));
  const registered = getRegisteredSources("宇土市", registry);
  const target = resolveDiscoveryTarget({
    prefecture: "熊本県",
    municipality: "宇土市",
    official_domain: "city.uto.lg.jp"
  });
  const waterLink = {
    url: normalizeUrl("https://www.city.uto.lg.jp/article/view/1014/16317.html"),
    label: "水道の復旧状況について",
    matched_hints: ["断水", "復旧"]
  };
  const analysis = {
    verdict: "PASS",
    keywords: ["断水", "復旧"],
    contamination_risk: false
  };
  const categoryInfo = inferPublicCategory(waterLink, analysis.title);
  const candidate = buildPatrolCandidate(target, waterLink, analysis, {
    discoveredAt: "2026-07-31T00:00:00.000Z"
  });
  const scoreA = calculateCandidateScore(waterLink, analysis, categoryInfo, target);
  const scoreB = calculateCandidateScore(waterLink, analysis, categoryInfo, target);
  checks.push({ check: "score reproducibility", pass: scoreA === scoreB, score: scoreA });
  if (scoreA !== scoreB) {
    errors.push("score reproducibility failed");
  }

  const matchComparison = classifyRegistryComparison(candidate, registered, [candidate]);
  checks.push({ check: "MATCH classification", pass: matchComparison.classification === "MATCH" });
  if (matchComparison.classification !== "MATCH") {
    errors.push("MATCH classification failed");
  }

  const falseCandidate = Object.assign({}, candidate, {
    candidate_url: "https://www.city.uto.lg.jp/bousai/hazardmap.html",
    page_type: "hazard_map",
    score: 20,
    score_tier: "LOW",
    recommended_role: "skip",
    exclusion: { excluded: true, exclusion_type: "hazard_map" }
  });
  const falseComparison = classifyRegistryComparison(falseCandidate, registered, [falseCandidate]);
  checks.push({
    check: "FALSE_POSITIVE classification",
    pass: falseComparison.classification === "FALSE_POSITIVE"
  });
  if (falseComparison.classification !== "FALSE_POSITIVE") {
    errors.push("FALSE_POSITIVE classification failed");
  }

  const { buildReviewQueueItem } = require("../monitor/patrol-discovery-controller");
  const reviewItem = buildReviewQueueItem(
    Object.assign({}, candidate, {
      source_trace: {
        discovered_from: target.entry_url,
        discovery_methods: ["entry_link"],
        cms_pattern: "CMS_A",
        crawl_depth: 1
      }
    }),
    { classification: "BETTER_CANDIDATE", current_url: "https://example.com/current" },
    "PDP-UNIT-TEST",
    0
  );
  const reviewItemErrors = validateReviewQueueItem(reviewItem);
  checks.push({ check: "review queue item schema", pass: reviewItemErrors.length === 0 });
  if (reviewItemErrors.length) {
    errors.push.apply(errors, reviewItemErrors);
  }
}

function buildComparisonReport(controllerSummary, accuracySummary) {
  const controllerTotals = controllerSummary.totals || {};
  const accuracyTotals = (accuracySummary && accuracySummary.totals) || {};
  const controllerPrimaryRate = controllerSummary.primary_discovery_rate || 0;
  const accuracyPrimaryRate = (accuracySummary && accuracySummary.primary_discovery_rate) || 0;
  const controllerFalsePositiveRate = controllerSummary.false_positive_rate || 0;
  const accuracyFalsePositiveRate =
    accuracyTotals.candidates > 0
      ? Number((accuracyTotals.FALSE_POSITIVE / accuracyTotals.candidates).toFixed(3))
      : 0;

  const municipalitiesMissingPrimary = [];
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    baseline: "accuracy-summary.json",
    controller: "reports/summary.json",
    metrics: {
      primary_discovery_rate: {
        accuracy: accuracyPrimaryRate,
        controller: controllerPrimaryRate,
        delta: Number((controllerPrimaryRate - accuracyPrimaryRate).toFixed(3))
      },
      better_candidate_count: {
        accuracy: accuracyTotals.BETTER_CANDIDATE || 0,
        controller: controllerTotals.BETTER_CANDIDATE || 0,
        delta: (controllerTotals.BETTER_CANDIDATE || 0) - (accuracyTotals.BETTER_CANDIDATE || 0)
      },
      false_positive_rate: {
        accuracy: accuracyFalsePositiveRate,
        controller: controllerFalsePositiveRate,
        delta: Number((controllerFalsePositiveRate - accuracyFalsePositiveRate).toFixed(3))
      },
      candidate_count: {
        accuracy: accuracyTotals.candidates || 0,
        controller: controllerTotals.candidates || 0,
        delta: (controllerTotals.candidates || 0) - (accuracyTotals.candidates || 0)
      }
    },
    municipalities_missing_primary: municipalitiesMissingPrimary
  };
}

async function runLiveValidation(errors, checks) {
  const liveResult = await runPatrolDiscoveryPipeline({
    live: true,
    maxCandidates: 15
  });

  checks.push({
    check: "live pipeline completed",
    pass: liveResult.run.municipalities.length === 12
  });
  if (liveResult.run.municipalities.length !== 12) {
    errors.push("live pipeline did not complete 12 municipalities");
  }

  checks.push({
    check: "live review queue generated",
    pass: liveResult.review_queue.item_count > 0
  });
  if (liveResult.review_queue.item_count <= 0) {
    errors.push("live review queue empty");
  }

  const missingPrimary = liveResult.run.municipalities
    .filter(function (item) {
      return (
        item.primary_coverage &&
        item.primary_coverage.primary_total > 0 &&
        item.primary_coverage.primary_discovered === 0
      );
    })
    .map(function (item) {
      return item.municipality;
    });

  const accuracySummary = fs.existsSync(ACCURACY_SUMMARY_FILE)
    ? JSON.parse(fs.readFileSync(ACCURACY_SUMMARY_FILE, "utf8"))
    : null;
  const comparison = buildComparisonReport(liveResult.summary, accuracySummary);
  comparison.municipalities_missing_primary = missingPrimary;
  fs.mkdirSync(path.dirname(COMPARISON_REPORT_FILE), { recursive: true });
  fs.writeFileSync(COMPARISON_REPORT_FILE, JSON.stringify(comparison, null, 2) + "\n", "utf8");

  checks.push({
    check: "comparison report generated",
    pass: fs.existsSync(COMPARISON_REPORT_FILE)
  });

  if (liveResult.errors.length) {
    errors.push.apply(errors, liveResult.errors);
  }

  console.log("=== Patrol Discovery Pipeline (Live) ===");
  console.log(JSON.stringify(liveResult.summary, null, 2));
  console.log("");
  console.log("COMPARISON_REPORT=" + COMPARISON_REPORT_FILE);
}

async function main() {
  const options = parseArgs(process.argv);
  const errors = [];
  const checks = [];

  runUnitTests(errors, checks);

  if (options.fixtureOnly) {
    const filteredTargets = {
      prefecture: "熊本県",
      targets: loadPipelineTargets(PIPELINE_TARGETS_FILE).targets.filter(function (target) {
        return target.municipality === "宇土市";
      })
    };
    const tempTargetsPath = path.join(ROOT, "data", "patrol_discovery", "pipeline_targets.fixture.json");
    fs.writeFileSync(tempTargetsPath, JSON.stringify(filteredTargets, null, 2) + "\n", "utf8");

    const sourcesBefore = fs.readFileSync(SOURCES_FILE, "utf8");
    const fixtureResult = await runPatrolDiscoveryPipeline({
      dryRunOutput: true,
      generatedAt: "2026-07-31T00:00:00.000Z",
      pipelineRunId: "PDP-FIXTURE-TEST",
      targetsPath: tempTargetsPath,
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
      },
      maxCandidates: 4
    });

    const uto = fixtureResult.run.municipalities.find(function (item) {
      return item.municipality === "宇土市";
    });
    const fixturePass = uto && uto.candidate_count >= 3 && (uto.comparison_summary.MATCH || 0) >= 1;
    checks.push({ check: "fixture pipeline run", pass: fixturePass });
    if (!fixturePass) {
      errors.push("fixture pipeline run failed");
    }

    const reviewPass =
      fixtureResult.review_queue &&
      fixtureResult.review_queue.auto_register === false &&
      fixtureResult.review_queue.items.every(function (item) {
        return validateReviewQueueItem(item).length === 0;
      });
    checks.push({ check: "review queue generation", pass: reviewPass });
    if (!reviewPass) {
      errors.push("review queue generation failed");
    }

    const tracePass = (uto.candidates || []).every(function (item) {
      return item.source_trace && item.source_trace.discovered_from;
    });
    checks.push({ check: "trace preserved", pass: tracePass });
    if (!tracePass) {
      errors.push("trace not preserved");
    }

    const autoRegisterPass =
      fixtureResult.review_queue.auto_register === false &&
      fixtureResult.review_queue.items.every(function (item) {
        return item.auto_register === false;
      });
    checks.push({ check: "auto_register disabled", pass: autoRegisterPass });
    if (!autoRegisterPass) {
      errors.push("auto_register must be false");
    }

    const runValidationErrors = validatePipelineRun(fixtureResult.run);
    checks.push({ check: "pipeline run validation", pass: runValidationErrors.length === 0 });
    if (runValidationErrors.length) {
      errors.push.apply(errors, runValidationErrors);
    }

    const sourcesAfter = fs.readFileSync(SOURCES_FILE, "utf8");
    checks.push({ check: "sources.json unchanged", pass: sourcesBefore === sourcesAfter });
    if (sourcesBefore !== sourcesAfter) {
      errors.push("sources.json was modified");
    }
  } else if (options.live) {
    await runLiveValidation(errors, checks);
  }

  const result = {
    PATROL_DISCOVERY_PIPELINE_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    mode: options.live ? "LIVE" : "FIXTURE",
    checks: checks,
    errors: errors
  };

  if (!options.live) {
    console.log("=== Patrol Discovery Pipeline Validation ===");
    console.log(JSON.stringify(result, null, 2));
  }

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
