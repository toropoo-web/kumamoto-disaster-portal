#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const UPDATES = path.join(ROOT, "site", "data", "public", "phase1_updates.json");

const OFFICIAL_ORDER = ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"];

function loadJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function main() {
  const records = loadJson(UPDATES);
  const byCategory = {};
  const labels = {};

  records.forEach((record, index) => {
    const id = record.public_category_id;
    byCategory[id] = (byCategory[id] || 0) + 1;
    labels[id] = record.public_category_label;
  });

  const categories = Object.keys(byCategory).sort();
  const expectedLabels = {
    EMERGENCY: "地震・緊急情報",
    SHELTER: "避難所",
    WATER: "断水・給水",
    SUPPORT: "被災者支援"
  };

  const errors = [];

  if (records.length !== 8) {
    errors.push(`card count ${records.length}, expected 8`);
  }

  if (categories.length !== 4) {
    errors.push(`category count ${categories.length}, expected 4`);
  }

  OFFICIAL_ORDER.forEach((id) => {
    if (!byCategory[id]) {
      errors.push(`missing category ${id}`);
    }
    if (labels[id] !== expectedLabels[id]) {
      errors.push(`label mismatch ${id}: ${labels[id]} !== ${expectedLabels[id]}`);
    }
  });

  if (byCategory.IMPACT) {
    errors.push("IMPACT category should not be in published data");
  }

  const cards = records.map((record, index) => ({
    index: index + 1,
    area_id: record.area_id,
    area_name: record.area_name,
    public_category_id: record.public_category_id,
    public_category_label: record.public_category_label,
    headline: record.headline
  }));

  const result = {
    pass: errors.length === 0,
    errors,
    officialCategories: OFFICIAL_ORDER.map((id) => ({
      public_category_id: id,
      public_category_label: expectedLabels[id],
      cardCount: byCategory[id] || 0
    })),
    cards,
    releaseMatchesSite: fs.readFileSync(UPDATES, "utf8") === fs.readFileSync(
      path.join(ROOT, "release", "data", "public", "phase1_updates.json"),
      "utf8"
    ),
    publicationMatchesSite: fs.readFileSync(UPDATES, "utf8") === fs.readFileSync(
      path.join(ROOT, "publication", "data", "public", "phase1_updates.json"),
      "utf8"
    )
  };

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.pass ? 0 : 1);
}

main();
