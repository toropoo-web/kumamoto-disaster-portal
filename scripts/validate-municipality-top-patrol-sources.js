#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  TOP_PAGE_SOURCES_FILE,
  TOP_PAGE_SECTIONS,
  getMunicipalityTopPatrolSources,
  loadMunicipalityTopPageRegistry
} = require(path.join(ROOT, "monitor", "municipality-top-patrol-sources"));

const EXPECTED_MUNICIPALITY_COUNT = 23;
const EXPECTED_SECTION_COUNT = TOP_PAGE_SECTIONS.length;
const EXPECTED_SOURCE_COUNT = EXPECTED_MUNICIPALITY_COUNT * EXPECTED_SECTION_COUNT;

function main() {
  const errors = [];

  if (!fs.existsSync(TOP_PAGE_SOURCES_FILE)) {
    errors.push("Missing registry: data/municipality_patrol/municipality_top_page_sources.json");
  }
  if (!fs.existsSync(path.join(ROOT, "monitor", "municipality-top-patrol-sources.js"))) {
    errors.push("Missing loader: monitor/municipality-top-patrol-sources.js");
  }

  const registry = loadMunicipalityTopPageRegistry();
  const municipalities = registry.municipalities || [];
  const sources = getMunicipalityTopPatrolSources();

  if (municipalities.length !== EXPECTED_MUNICIPALITY_COUNT) {
    errors.push(
      "Municipality top page registry count: " +
        municipalities.length +
        " (expected " +
        EXPECTED_MUNICIPALITY_COUNT +
        ")"
    );
  }

  if (sources.length !== EXPECTED_SOURCE_COUNT) {
    errors.push(
      "Expanded top page patrol source count: " +
        sources.length +
        " (expected " +
        EXPECTED_SOURCE_COUNT +
        ")"
    );
  }

  const areaIds = new Set(municipalities.map(function (entry) {
    return entry.area_id;
  }));
  if (areaIds.size !== EXPECTED_MUNICIPALITY_COUNT) {
    errors.push("Unique area_id count in registry: " + areaIds.size + " (expected 23)");
  }

  municipalities.forEach(function (entry) {
    if (!entry.area_id || !entry.municipality || !entry.top_page_url) {
      errors.push("Invalid municipality entry: " + JSON.stringify(entry));
      return;
    }
    if (!/^https?:\/\//.test(entry.top_page_url)) {
      errors.push("Invalid top_page_url for " + entry.municipality + ": " + entry.top_page_url);
    }
  });

  const sourceIds = new Set();
  sources.forEach(function (source) {
    if (sourceIds.has(source.id)) {
      errors.push("Duplicate patrol source id: " + source.id);
    }
    sourceIds.add(source.id);

    if (source.patrol_target !== "MUNICIPALITY_TOP") {
      errors.push("Invalid patrol_target for " + source.id);
    }
    if (!source.top_page_section || !source.top_page_section_id) {
      errors.push("Missing top page section metadata for " + source.id);
    }
    if (source.public_category_id !== "EMERGENCY") {
      errors.push("Unexpected public_category_id for " + source.id);
    }
  });

  TOP_PAGE_SECTIONS.forEach(function (section) {
    const sectionSources = sources.filter(function (source) {
      return source.top_page_section_id === section.section_id;
    });
    if (sectionSources.length !== EXPECTED_MUNICIPALITY_COUNT) {
      errors.push(
        "Section source count for " +
          section.section_label +
          ": " +
          sectionSources.length +
          " (expected " +
          EXPECTED_MUNICIPALITY_COUNT +
          ")"
      );
    }
  });

  const runMonitor = fs.readFileSync(path.join(ROOT, "scripts", "run-monitor.js"), "utf8");
  if (!/getMunicipalityTopPatrolSources|getMunicipalityPatrolSources/.test(runMonitor)) {
    errors.push("run-monitor.js does not load municipality patrol sources");
  }

  const output = {
    MUNICIPALITY_TOP_PATROL_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    MUNICIPALITY_COUNT: municipalities.length,
    SECTION_COUNT: EXPECTED_SECTION_COUNT,
    TOP_PAGE_PATROL_SOURCE_COUNT: sources.length,
    errors: errors
  };

  console.log("=== Municipality Top Page Patrol Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length) {
    process.exit(1);
  }

  console.log("PHASE28_MUNICIPALITY_TOP_EMERGENCY_SOURCE_UPDATE_COMPLETE");
}

main();
