#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FIXTURE_PATH = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "x-municipality-fetch-relax",
  "posts-fixture.json"
);

const {
  selectPosts,
  countSelectedMunicipalityPosts,
  buildStrictMunicipalityRegistry,
  SOURCE_REGISTRY,
  MUNICIPALITY_CONTENT_FILTER,
  passesContentFilter,
  matchesDisasterRelatedContent
} = require("./sync-x-feed");

function assert(condition, message, errors) {
  if (!condition) {
    errors.push(message);
  }
}

function loadFixturePosts() {
  return JSON.parse(fs.readFileSync(FIXTURE_PATH, "utf8"));
}

function findSelectedPost(selected, sourceId) {
  return selected.find(function (post) {
    return post.source_id === sourceId;
  });
}

function main() {
  const errors = [];
  const checks = [];
  const fixturePosts = loadFixturePosts();
  const strictRegistry = buildStrictMunicipalityRegistry();

  const relaxedSelected = selectPosts(fixturePosts, { sourceRegistry: SOURCE_REGISTRY });
  const strictSelected = selectPosts(fixturePosts, { sourceRegistry: strictRegistry });

  const relaxedMunicipalityCount = countSelectedMunicipalityPosts(fixturePosts, {
    sourceRegistry: SOURCE_REGISTRY
  });
  const strictMunicipalityCount = countSelectedMunicipalityPosts(fixturePosts, {
    sourceRegistry: strictRegistry
  });

  checks.push({
    check: "fixture exists",
    pass: fs.existsSync(FIXTURE_PATH)
  });

  checks.push({
    check: "municipality registry uses RECENT_POSTS",
    pass: Object.keys(SOURCE_REGISTRY).every(function (sourceId) {
      return SOURCE_REGISTRY[sourceId].content_filter === MUNICIPALITY_CONTENT_FILTER;
    })
  });

  checks.push({
    check: "relaxed municipality count >= strict municipality count",
    pass: relaxedMunicipalityCount >= strictMunicipalityCount,
    relaxedMunicipalityCount: relaxedMunicipalityCount,
    strictMunicipalityCount: strictMunicipalityCount
  });

  if (relaxedMunicipalityCount < strictMunicipalityCount) {
    errors.push(
      "relaxed municipality count " +
        relaxedMunicipalityCount +
        " is less than strict count " +
        strictMunicipalityCount
    );
  }

  const km001Relaxed = findSelectedPost(relaxedSelected, "SRC-MUN-KM001");
  const km001Strict = findSelectedPost(strictSelected, "SRC-MUN-KM001");
  const lifeRecoveryPost = fixturePosts.find(function (post) {
    return post.postId === "FIXTURE-KM001-LIFE-001";
  });

  checks.push({
    check: "relaxed KM001 selects latest life/recovery post",
    pass: km001Relaxed && km001Relaxed.url === lifeRecoveryPost.postUrl
  });
  if (!km001Relaxed || km001Relaxed.url !== lifeRecoveryPost.postUrl) {
    errors.push("relaxed KM001 must select latest life/recovery post");
  }

  checks.push({
    check: "strict KM001 skips non-disaster life/recovery post",
    pass: !km001Strict || km001Strict.url !== lifeRecoveryPost.postUrl
  });
  if (km001Strict && km001Strict.url === lifeRecoveryPost.postUrl) {
    errors.push("strict KM001 must not select non-disaster life/recovery post");
  }

  checks.push({
    check: "life/recovery fixture is not disaster-keyword classified",
    pass: !matchesDisasterRelatedContent(lifeRecoveryPost)
  });
  if (matchesDisasterRelatedContent(lifeRecoveryPost)) {
    errors.push("life/recovery fixture should not match disaster-only filter");
  }

  checks.push({
    check: "personal source excluded from relaxed selection",
    pass: !relaxedSelected.some(function (post) {
      return post.source_id === "SRC-PER-001";
    })
  });
  if (
    relaxedSelected.some(function (post) {
      return post.source_id === "SRC-PER-001";
    })
  ) {
    errors.push("personal source must not appear in relaxed selection");
  }

  checks.push({
    check: "official municipality posts bypass keyword filter with RECENT_POSTS",
    pass: passesContentFilter(lifeRecoveryPost, SOURCE_REGISTRY["SRC-MUN-KM001"])
  });

  const syncSource = fs.readFileSync(path.join(ROOT, "scripts", "sync-x-feed.js"), "utf8");
  checks.push({
    check: "fail-open preserved in sync-x-feed",
    pass: /FAIL_OPEN/.test(syncSource) && /retainStalePreview/.test(syncSource)
  });
  if (!/FAIL_OPEN/.test(syncSource) || !/retainStalePreview/.test(syncSource)) {
    errors.push("fail-open behavior missing from sync-x-feed.js");
  }

  const appJs = fs.readFileSync(path.join(ROOT, "js", "app.js"), "utf8");
  checks.push({
    check: "display label unchanged",
    pass:
      appJs.indexOf('var X_FEED_ACCOUNT_LABEL = "公式X情報";') !== -1 &&
      appJs.indexOf("公式X速報") !== -1
  });
  if (appJs.indexOf('var X_FEED_ACCOUNT_LABEL = "公式X情報";') === -1) {
    errors.push("X feed display label changed in app.js");
  }

  const output = {
    PHASE39D_X_MUNICIPALITY_FETCH_RELAX: errors.length === 0 ? "PASS" : "FAIL",
    relaxedMunicipalityCount: relaxedMunicipalityCount,
    strictMunicipalityCount: strictMunicipalityCount,
    relaxedSelectedCount: relaxedSelected.length,
    strictSelectedCount: strictSelected.length,
    checks: checks,
    errors: errors
  };

  console.log("=== X Municipality Fetch Relax Validation ===");
  console.log(JSON.stringify(output, null, 2));

  if (errors.length > 0) {
    process.exit(1);
  }

  console.log("PHASE39D_X_MUNICIPALITY_FETCH_RELAX_COMPLETE");
}

main();
