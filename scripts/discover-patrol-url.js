#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  discoverPatrolUrls,
  validateDiscoveryInput,
  MASTER_CANDIDATES_FILE
} = require("../monitor/patrol-url-discovery-engine");

const ROOT = path.join(__dirname, "..");

function parseArgs(argv) {
  const options = { dryRun: false, analyzeCandidates: true, input: null };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--input" && argv[i + 1]) {
      options.inputPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--prefecture" && argv[i + 1]) {
      options.prefecture = argv[i + 1];
      i += 1;
    } else if (arg === "--municipality" && argv[i + 1]) {
      options.municipality = argv[i + 1];
      i += 1;
    } else if (arg === "--official-domain" && argv[i + 1]) {
      options.official_domain = argv[i + 1];
      i += 1;
    } else if (arg === "--entry-url" && argv[i + 1]) {
      options.entryUrl = argv[i + 1];
      i += 1;
    } else if (arg === "--max-candidates" && argv[i + 1]) {
      options.maxCandidates = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--no-analyze") {
      options.analyzeCandidates = false;
    }
  }

  return options;
}

function loadInput(options) {
  if (options.inputPath) {
    return JSON.parse(fs.readFileSync(options.inputPath, "utf8"));
  }

  return {
    prefecture: options.prefecture,
    municipality: options.municipality,
    official_domain: options.official_domain
  };
}

async function main() {
  const options = parseArgs(process.argv);
  const input = loadInput(options);
  const inputErrors = validateDiscoveryInput(input);

  if (inputErrors.length) {
    console.error("Invalid input:");
    inputErrors.forEach(function (message) {
      console.error("- " + message);
    });
    console.error("");
    console.error("Example:");
    console.error(
      JSON.stringify(
        {
          prefecture: "熊本県",
          municipality: "宇土市",
          official_domain: "city.uto.lg.jp"
        },
        null,
        2
      )
    );
    console.error("");
    console.error("Usage:");
    console.error("  npm run discover:patrol-url -- --input data/patrol_discovery/input.json");
    console.error(
      '  npm run discover:patrol-url -- --prefecture 熊本県 --municipality 宇土市 --official-domain city.uto.lg.jp'
    );
    process.exit(1);
  }

  const result = await discoverPatrolUrls(input, options);

  if (result.reason && !result.candidates.length && result.saved !== true) {
    console.error(result.reason);
    process.exit(1);
  }

  console.log("=== Patrol URL Discovery ===");
  console.log(
    JSON.stringify(
      {
        saved: result.saved === true,
        dryRun: result.dryRun === true,
        input: result.input,
        entry_url: result.entry_url,
        entry_analysis: result.entry_analysis || null,
        linkCount: result.linkCount,
        candidateCount: result.candidateCount,
        discoveredCount: result.discoveredCount,
        alreadyRegisteredCount: result.alreadyRegisteredCount,
        masterOutputPath: result.masterOutputPath || MASTER_CANDIDATES_FILE,
        runOutputPath: result.runOutputPath || null,
        awaitingRegistrationReview: true,
        nextStep: "Review patrol_url_candidates.json and register approved URLs in monitor/sources.json manually",
        candidates: (result.candidates || []).map(function (item) {
          return {
            discovery_id: item.discovery_id,
            candidate_url: item.candidate_url,
            link_label: item.link_label,
            public_category_id: item.public_category_id,
            patrol_role: item.patrol_role,
            score: item.score,
            discovery_status: item.discovery_status,
            registration_status: item.registration_status,
            page_analysis_verdict: item.page_analysis ? item.page_analysis.verdict : null
          };
        }),
        errors: result.errors || []
      },
      null,
      2
    )
  );

  if (result.errors && result.errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
