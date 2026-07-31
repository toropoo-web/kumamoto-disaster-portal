#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  runMunicipalityExpansionFlow,
  validateExpansionInput,
  EXPANSION_DIR,
  RUNS_DIR
} = require("../monitor/municipality-expansion-flow");

function parseArgs(argv) {
  const options = {
    dryRun: false,
    inputPath: path.join(EXPANSION_DIR, "input.example.json")
  };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--input" && argv[i + 1]) {
      options.inputPath = path.resolve(argv[i + 1]);
      i += 1;
    } else if (arg === "--fixture") {
      options.fixturePath = path.join(
        __dirname,
        "..",
        "monitor",
        "fixtures",
        "municipality-expansion",
        "input-fixture.json"
      );
      options.inputPath = options.fixturePath;
    }
  }

  return options;
}

function loadFixtureInput(fixturePath) {
  const fixture = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  return {
    portal: fixture.portal,
    municipalities: fixture.municipalities,
    fixtureMap: fixture.fixture_map
  };
}

async function main() {
  const options = parseArgs(process.argv);
  let input;
  let fixtureMap;

  if (options.fixturePath) {
    const loaded = loadFixtureInput(options.fixturePath);
    input = { portal: loaded.portal, municipalities: loaded.municipalities };
    fixtureMap = loaded.fixtureMap;
  } else {
    input = JSON.parse(fs.readFileSync(options.inputPath, "utf8"));
  }

  const validation = validateExpansionInput(input);
  if (!validation.valid) {
    console.error(JSON.stringify({ validation: validation }, null, 2));
    process.exit(1);
  }

  const result = await runMunicipalityExpansionFlow(input, {
    dryRun: options.dryRun,
    fixtureMap: fixtureMap
  });

  console.log("=== Municipality Expansion Flow ===");
  console.log(
    JSON.stringify(
      {
        run_id: result.run_id,
        status: result.result.status,
        portal: result.result.portal,
        municipality_count: result.result.municipality_count,
        municipalities: result.result.municipalities,
        review_queue_items: result.result.review_queue.item_count,
        safety: result.result.safety,
        saved: result.saved,
        errors: result.errors
      },
      null,
      2
    )
  );

  console.log("");
  console.log("EXPANSION_DIR=" + EXPANSION_DIR);
  console.log("RUNS_DIR=" + RUNS_DIR);

  if (result.errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
