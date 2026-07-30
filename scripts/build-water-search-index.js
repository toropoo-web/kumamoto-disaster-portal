#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  buildAndWriteWaterSearchIndex
} = require(path.join(__dirname, "..", "monitor", "water-search-index-engine"));

function main() {
  const payload = buildAndWriteWaterSearchIndex();

  console.log("=== Water Search Index Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE27_WATER_SEARCH_INDEX_V2",
        VERSION: payload.version,
        ITEM_COUNT: payload.item_count,
        LOCATION_ITEM_COUNT: payload.location_item_count,
        REGISTRY_ITEM_COUNT: payload.registry_item_count,
        REGIONS: payload.regions,
        LAST_UPDATED: payload.last_updated
      },
      null,
      2
    )
  );
}

main();
