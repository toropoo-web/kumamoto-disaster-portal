#!/usr/bin/env node
"use strict";

const path = require("path");

const {
  buildAndWriteDisasterSearchIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));

function main() {
  const payload = buildAndWriteDisasterSearchIndex();

  console.log("=== Disaster Search Index Build ===");
  console.log(
    JSON.stringify(
      {
        PHASE: "PHASE27_DISASTER_SEARCH_INDEX_IMPLEMENTATION",
        VERSION: payload.version,
        REGION: payload.region,
        ITEM_COUNT: payload.meta.item_count,
        LOCATION_ITEM_COUNT: payload.meta.location_item_count,
        REGISTRY_ITEM_COUNT: payload.meta.registry_item_count,
        SNAPSHOT_ITEM_COUNT: payload.meta.snapshot_item_count,
        LAST_UPDATED: payload.meta.last_updated
      },
      null,
      2
    )
  );
}

main();
