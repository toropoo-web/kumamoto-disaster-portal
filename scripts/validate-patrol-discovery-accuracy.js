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
  classifyCandidateComparison,
  loadAccuracyTargets,
  getRegisteredSources,
  runAccuracyValidation,
  ACCURACY_REPORT_FILE,
  ACCURACY_SUMMARY_FILE
} = require("../monitor/patrol-discovery-accuracy");

const {
  loadSourcesRegistry,
  inferPageType,
  detectExclusion,
  scoreTier,
  normalizeUrl
} = require("../monitor/patrol-url-discovery-engine");

function parseArgs(argv) {
  const options = { fixtureOnly: false, live: false };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--live") {
      options.live = true;
    } else if (arg === "--fixture-only") {
      options.fixtureOnly = true;
    } else if (arg === "--max-candidates" && argv[i + 1]) {
      options.maxCandidates = Number(argv[i + 1]);
      i += 1;
    }
  }

  return options;
}

function runFixtureUnitTests(errors, checks) {
  const registry = loadSourcesRegistry();
  const registered = getRegisteredSources("宇土市", registry);
  const waterUrl = normalizeUrl("https://www.city.uto.lg.jp/article/view/1014/16317.html");

  const operationalCandidate = {
    candidate_url: waterUrl,
    score: 85,
    score_tier: "HIGH",
    page_type: "disaster_special",
    recommended_role: "secondary",
    exclusion: { excluded: false },
    detected_keywords: ["断水", "復旧"]
  };
  const operationalComparison = classifyCandidateComparison(operationalCandidate, registered);
  const matchPass = operationalComparison.comparison === "MATCH";
  checks.push({ check: "MATCH classification for registered URL", pass: matchPass });
  if (!matchPass) {
    errors.push("MATCH classification failed");
  }

  const betterCandidate = {
    candidate_url: "https://www.city.uto.lg.jp/article/view/1014/99999.html",
    score: 88,
    score_tier: "HIGH",
    page_type: "disaster_special",
    recommended_role: "secondary",
    exclusion: { excluded: false },
    detected_keywords: ["断水", "復旧", "災害"]
  };
  const betterComparison = classifyCandidateComparison(betterCandidate, registered);
  const betterPass = betterComparison.comparison === "BETTER_CANDIDATE";
  checks.push({ check: "BETTER_CANDIDATE classification", pass: betterPass });
  if (!betterPass) {
    errors.push("BETTER_CANDIDATE classification failed");
  }

  const falsePositiveCandidate = {
    candidate_url: "https://www.city.uto.lg.jp/bousai/hazardmap.html",
    score: 30,
    score_tier: "LOW",
    page_type: "hazard_map",
    recommended_role: "skip",
    exclusion: { excluded: true, exclusion_type: "hazard_map", exclusion_reason: "matched" },
    detected_keywords: ["防災"]
  };
  const falseComparison = classifyCandidateComparison(falsePositiveCandidate, registered);
  const falsePass = falseComparison.comparison === "FALSE_POSITIVE";
  checks.push({ check: "FALSE_POSITIVE classification", pass: falsePass });
  if (!falsePass) {
    errors.push("FALSE_POSITIVE classification failed");
  }

  const exclusion = detectExclusion(
    { label: "地域防災計画PDF", url: "https://www.city.uto.lg.jp/bousai/plan.pdf", matched_hints: [] },
    { title: "地域防災計画", keywords: [] }
  );
  const planPdfPass = exclusion.excluded && exclusion.exclusion_type === "pdf";
  checks.push({ check: "pdf exclusion detection", pass: planPdfPass });
  if (!planPdfPass) {
    errors.push("pdf exclusion failed");
  }

  const archiveExclusion = detectExclusion(
    { label: "2016年熊本地震アーカイブ", url: "https://www.city.uto.lg.jp/archive/2016.html", matched_hints: [] },
    { title: "過去の災害", keywords: [] }
  );
  checks.push({ check: "ARCHIVE exclusion detection", pass: archiveExclusion.excluded });
  if (!archiveExclusion.excluded) {
    errors.push("ARCHIVE exclusion failed");
  }

  const pageType = inferPageType(
    { label: "防災情報一覧", url: "https://www.city.uto.lg.jp/article/list/1014.html", matched_hints: ["防災"] },
    { title: "緊急情報一覧", keywords: ["災害"] }
  );
  checks.push({ check: "emergency_list page_type inference", pass: pageType === "emergency_list" });
  if (pageType !== "emergency_list") {
    errors.push("emergency_list page_type inference failed");
  }

  const tierPass = scoreTier(85) === "HIGH" && scoreTier(65) === "MEDIUM" && scoreTier(20) === "LOW";
  checks.push({ check: "score tier bands", pass: tierPass });
  if (!tierPass) {
    errors.push("score tier bands failed");
  }

  const targets = loadAccuracyTargets();
  checks.push({ check: "accuracy targets loaded", pass: targets.length === 12 });
  if (targets.length !== 12) {
    errors.push("expected 12 accuracy targets");
  }
}

async function main() {
  const options = parseArgs(process.argv);
  const errors = [];
  const checks = [];

  runFixtureUnitTests(errors, checks);

  if (options.fixtureOnly) {
    const fixtureResult = await runAccuracyValidation({
      dryRunOutput: true,
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
      targetsPath: path.join(ROOT, "data", "patrol_discovery", "accuracy-targets.json")
    });

    const utoResult = fixtureResult.report.municipalities.find(function (item) {
      return item.municipality === "宇土市";
    });
    const fixturePass = utoResult && utoResult.candidate_count >= 3 && (utoResult.comparison_summary.MATCH || 0) >= 1;
    checks.push({ check: "fixture municipality accuracy run", pass: fixturePass });
    if (!fixturePass) {
      errors.push("fixture municipality accuracy run failed");
    }
  } else if (options.live) {
    const liveResult = await runAccuracyValidation({
      live: true,
      maxCandidates: options.maxCandidates || 15
    });
    checks.push({
      check: "live accuracy validation completed",
      pass: liveResult.summary.municipality_count === 12
    });
    if (liveResult.summary.municipality_count !== 12) {
      errors.push("live accuracy validation did not complete 12 municipalities");
    }
    if (liveResult.summary.errors && liveResult.summary.errors.length) {
      errors.push.apply(errors, liveResult.summary.errors);
    }

    console.log("=== Patrol Discovery Accuracy (Live) ===");
    console.log(JSON.stringify(liveResult.summary, null, 2));
    console.log("");
    console.log("ACCURACY_REPORT=" + ACCURACY_REPORT_FILE);
    console.log("ACCURACY_SUMMARY=" + ACCURACY_SUMMARY_FILE);
  }

  const result = {
    PATROL_DISCOVERY_ACCURACY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    mode: options.live ? "LIVE" : options.fixtureOnly ? "FIXTURE" : "UNIT",
    checks: checks,
    errors: errors
  };

  if (!options.live) {
    console.log("=== Patrol Discovery Accuracy Validation ===");
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
