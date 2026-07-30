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
        PHASE: "PHASE27_WATER_SEARCH_IMPLEMENTATION",
        ITEM_COUNT: payload.item_count,
        REGIONS: payload.regions,
        LAST_UPDATED: payload.last_updated,
        MUNICIPALITIES: Array.from(
          payload.items.reduce(function (set, item) {
            set.add(item.municipality);
            return set;
          }, new Set())
        )
      },
      null,
      2
    )
  );
}

main();
