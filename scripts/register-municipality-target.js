#!/usr/bin/env node
"use strict";

const {
  listMunicipalityTargets,
  validateRegistry,
  loadRegistry,
  MUNICIPALITIES_FILE,
  DISCOVERY_TARGETS_FILE,
  PREFECTURES_FILE
} = require("../monitor/municipality-registry");

function parseArgs(argv) {
  const options = { list: false, prefecture: null, priority: null };

  for (let i = 2; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--list") {
      options.list = true;
    } else if (arg === "--prefecture" && argv[i + 1]) {
      options.prefecture = argv[i + 1];
      i += 1;
    } else if (arg === "--priority" && argv[i + 1]) {
      options.priority = argv[i + 1];
      i += 1;
    } else if (arg === "--validate") {
      options.validate = true;
    }
  }

  return options;
}

function main() {
  const options = parseArgs(process.argv);
  const validation = validateRegistry();

  if (options.validate) {
    console.log(
      JSON.stringify(
        {
          MUNICIPALITY_REGISTRY_VALIDATION: validation.valid ? "PASS" : "FAIL",
          municipality_count: validation.municipality_count,
          target_count: validation.target_count,
          active_target_count: validation.active_target_count,
          errors: validation.errors
        },
        null,
        2
      )
    );
    if (!validation.valid) {
      process.exit(1);
    }
    return;
  }

  if (options.list) {
    const rows = listMunicipalityTargets({
      prefecture: options.prefecture,
      priority: options.priority,
      activeOnly: true
    });
    console.log("=== Municipality Discovery Targets ===");
    console.log(
      JSON.stringify(
        {
          prefecture: options.prefecture || "ALL",
          count: rows.length,
          files: {
            prefectures: PREFECTURES_FILE,
            municipalities: MUNICIPALITIES_FILE,
            discovery_targets: DISCOVERY_TARGETS_FILE
          },
          targets: rows
        },
        null,
        2
      )
    );
    return;
  }

  const registry = loadRegistry();
  console.log("=== Municipality Registry ===");
  console.log(
    JSON.stringify(
      {
        prefectures: registry.prefectures.length,
        municipalities: registry.municipalities.length,
        discovery_targets: registry.discovery_targets.length,
        validation: validation.valid ? "PASS" : "FAIL"
      },
      null,
      2
    )
  );
  console.log("");
  console.log("Use --list to show discovery targets.");
}

main();
