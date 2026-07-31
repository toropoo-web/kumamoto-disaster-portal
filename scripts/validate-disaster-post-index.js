#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

const {
  PUBLIC_OUTPUT_FILE,
  buildAndWriteDisasterPostIndex,
  validateDisasterPostIndex,
  buildDisasterPostIndexPayload,
  dedupePostEntries,
  buildPostContentHash,
  previewPostsToRaw,
  POST_CATEGORY_LABELS
} = require(path.join(__dirname, "..", "monitor", "disaster-post-index-engine"));

const {
  buildAndWriteDisasterSearchIndex,
  searchDisasterIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-search-index-engine"));
const {
  buildAndWriteDisasterSocialIndex,
  searchDisasterSocialIndex
} = require(path.join(__dirname, "..", "monitor", "disaster-social-index-engine"));

const FIXTURE_POSTS_FILE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "x-municipality-fetch-relax",
  "posts-fixture.json"
);

async function main() {
  const errors = [];
  const checks = [];

  [
    "monitor/disaster-post-index-engine.js",
    "scripts/build-disaster-post-index.js",
    "data/public/x_feed_preview.json"
  ].forEach(function (file) {
    const exists = fs.existsSync(path.join(ROOT, file));
    checks.push({ check: file, pass: exists });
    if (!exists) {
      errors.push("Missing file: " + file);
    }
  });

  const payload = await buildAndWriteDisasterPostIndex();
  checks.push({
    check: "disaster post index generated",
    pass: payload.meta.item_count > 0
  });
  if (payload.meta.item_count <= 0) {
    errors.push("disaster post index must include at least one post");
  }

  errors.push.apply(errors, validateDisasterPostIndex(payload));
  checks.push({
    check: "post index schema valid",
    pass: validateDisasterPostIndex(payload).length === 0
  });

  const officialOnly = payload.posts.every(function (entry) {
    return entry.verification === "official" && entry.source_type === "official_x";
  });
  checks.push({ check: "official posts only", pass: officialOnly });
  if (!officialOnly) {
    errors.push("post index must contain official posts only");
  }

  const fixturePayload = buildDisasterPostIndexPayload(
    JSON.parse(fs.readFileSync(FIXTURE_POSTS_FILE, "utf8")),
    { source: FIXTURE_POSTS_FILE }
  );
  const fixturePersonal = fixturePayload.posts.some(function (entry) {
    return /個人|shinjirokoiz/i.test(entry.organization + entry.account);
  });
  checks.push({ check: "personal account excluded", pass: !fixturePersonal });
  if (fixturePersonal) {
    errors.push("personal account must be excluded from post index");
  }

  const duplicateEntries = [
    {
      post_id: "dup-1",
      source_type: "official_x",
      organization: "熊本市公式X",
      account: "kumamotocity_",
      prefecture: "熊本県",
      municipality: "熊本市",
      category: "WATER",
      subcategory: "WATER_SUPPLY",
      title: "給水",
      text: "同じ本文",
      url: "https://x.com/kumamotocity_/status/dup-1",
      published_at: "2026-07-31T10:00:00.000Z",
      updated_at: "2026-07-31T10:00:00.000Z",
      hash: buildPostContentHash("同じ本文"),
      verification: "official"
    },
    {
      post_id: "dup-2",
      source_type: "official_x",
      organization: "熊本市公式X",
      account: "kumamotocity_",
      prefecture: "熊本県",
      municipality: "熊本市",
      category: "WATER",
      subcategory: "WATER_SUPPLY",
      title: "給水",
      text: "同じ本文",
      url: "https://x.com/kumamotocity_/status/dup-2",
      published_at: "2026-07-31T11:00:00.000Z",
      updated_at: "2026-07-31T11:00:00.000Z",
      hash: buildPostContentHash("同じ本文"),
      verification: "official"
    }
  ];
  const deduped = dedupePostEntries(duplicateEntries);
  checks.push({ check: "hash dedupe", pass: deduped.length === 1 });
  if (deduped.length !== 1) {
    errors.push("hash dedupe must keep one entry for identical content");
  }

  if (!fs.existsSync(PUBLIC_OUTPUT_FILE)) {
    errors.push("Missing output: data/public/disaster_post_index.json");
  }

  const searchPayload = buildAndWriteDisasterSearchIndex();
  const officialPostCount = searchPayload.index.filter(function (entry) {
    return entry.category === "OFFICIAL_POST";
  }).length;
  checks.push({
    check: "official posts removed from disaster search index",
    pass: officialPostCount === 0,
    official_post_item_count: officialPostCount
  });
  if (officialPostCount > 0) {
    errors.push("disaster search index must not include OFFICIAL_POST entries");
  }

  const waterResults = searchDisasterIndex(searchPayload, "給水", { category: "WATER" });
  checks.push({
    check: "water search preserved",
    pass: waterResults.length > 0,
    water_result_count: waterResults.length
  });
  if (!waterResults.length) {
    errors.push("water search must continue to return results");
  }

  buildAndWriteDisasterSocialIndex();
  const socialResults = searchDisasterSocialIndex(
    JSON.parse(fs.readFileSync(path.join(ROOT, "data", "public", "disaster_social_index.json"), "utf8")),
    { categoryQuery: "給水" }
  );
  checks.push({
    check: "x cross search by keyword",
    pass: socialResults.length > 0,
    x_cross_result_count: socialResults.length
  });
  if (!socialResults.length) {
    errors.push("x cross search must return results for 給水");
  }

  const preview = JSON.parse(
    fs.readFileSync(path.join(ROOT, "data", "public", "x_feed_preview.json"), "utf8")
  );
  const previewCount = previewPostsToRaw(preview.posts).length;
  checks.push({
    check: "x feed preview source readable",
    pass: previewCount > 0,
    preview_post_count: previewCount
  });

  const categoryLabelsPresent = Object.keys(POST_CATEGORY_LABELS).length >= 9;
  checks.push({ check: "post category labels", pass: categoryLabelsPresent });
  if (!categoryLabelsPresent) {
    errors.push("post category labels must be defined");
  }

  console.log("=== Disaster Post Index Validation ===");
  console.log(JSON.stringify({ checks: checks, errors: errors }, null, 2));

  if (errors.length) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error("=== Disaster Post Index Validation ===");
  console.error(JSON.stringify({ STATUS: "FAIL", error: err.message }, null, 2));
  process.exit(1);
});
