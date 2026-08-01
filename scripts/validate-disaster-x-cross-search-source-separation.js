#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");

const ROOT = path.join(__dirname, "..");
const X_FEED_PREVIEW = path.join(ROOT, "data", "public", "x_feed_preview.json");
const SOCIAL_INBOX = path.join(ROOT, "data", "community", "disaster_social_inbox.json");
const SOCIAL_INDEX = path.join(ROOT, "data", "public", "disaster_social_index.json");

const {
  DEFAULT_OFFICIAL_X_FEED_URL,
  DEFAULT_X_CROSS_SEARCH_FEED_URL
} = require(path.join(ROOT, "monitor", "disaster-social-sns-fetch"));

const OFFICIAL_SOURCE_ID_PATTERN = /^SRC-(NAT|KUM|MUN|PER)-/;

function fetchText(url) {
  return new Promise(function (resolve, reject) {
    https
      .get(url, function (response) {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode + " for " + url));
          response.resume();
          return;
        }
        let data = "";
        response.on("data", function (chunk) {
          data += chunk;
        });
        response.on("end", function () {
          resolve(data);
        });
      })
      .on("error", reject);
  });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function main() {
  const errors = [];
  const checks = [];

  const preview = readJson(X_FEED_PREVIEW);
  checks.push({
    check: "layer3 official x feed preview uses posts.json",
    pass: preview.source_feed_url === DEFAULT_OFFICIAL_X_FEED_URL
  });
  if (preview.source_feed_url !== DEFAULT_OFFICIAL_X_FEED_URL) {
    errors.push("x_feed_preview.json must keep official posts.json feed URL");
  }

  let inbox = { fetch_summary: { platforms: { X: {} } }, items: [] };
  if (fs.existsSync(SOCIAL_INBOX)) {
    inbox = readJson(SOCIAL_INBOX);
  }
  const feedUrl =
    inbox.fetch_summary &&
    inbox.fetch_summary.platforms &&
    inbox.fetch_summary.platforms.X &&
    inbox.fetch_summary.platforms.X.feed_url;
  const usesCrossSearchFeed =
    feedUrl === DEFAULT_X_CROSS_SEARCH_FEED_URL ||
    /posts-cross-search\.json$/i.test(String(feedUrl || ""));
  checks.push({
    check: "layer2 x cross search uses posts-cross-search.json",
    pass: usesCrossSearchFeed,
    feed_url: feedUrl,
    expected_feed_url: DEFAULT_X_CROSS_SEARCH_FEED_URL
  });
  if (!usesCrossSearchFeed) {
    errors.push("disaster_social_inbox.json must use posts-cross-search.json feed");
  }

  checks.push({
    check: "layer2 feed url is not official posts.json",
    pass: feedUrl !== DEFAULT_OFFICIAL_X_FEED_URL
  });
  if (feedUrl === DEFAULT_OFFICIAL_X_FEED_URL) {
    errors.push("layer2 must not read official posts.json");
  }

  try {
    const crossSearchRaw = await fetchText(DEFAULT_X_CROSS_SEARCH_FEED_URL);
    const crossSearchPosts = JSON.parse(crossSearchRaw);
    const posts = Array.isArray(crossSearchPosts) ? crossSearchPosts : [];
    const withSourceId = posts.filter(function (post) {
      return Boolean(post && post.sourceId);
    });
    checks.push({
      check: "upstream cross-search feed has no sourceId",
      pass: withSourceId.length === 0,
      post_count: posts.length,
      source_id_count: withSourceId.length
    });
    if (withSourceId.length > 0) {
      errors.push("posts-cross-search.json must not include sourceId");
    }
  } catch (err) {
    const {
      LOCAL_CROSS_SEARCH_FEED_FALLBACK
    } = require(path.join(ROOT, "monitor", "disaster-social-sns-fetch"));
    if (fs.existsSync(LOCAL_CROSS_SEARCH_FEED_FALLBACK)) {
      const posts = readJson(LOCAL_CROSS_SEARCH_FEED_FALLBACK);
      const withSourceId = posts.filter(function (post) {
        return Boolean(post && post.sourceId);
      });
      checks.push({
        check: "upstream cross-search feed has no sourceId",
        pass: withSourceId.length === 0,
        post_count: posts.length,
        source_id_count: withSourceId.length,
        source: "local_fallback"
      });
      if (withSourceId.length > 0) {
        errors.push("posts-cross-search.json must not include sourceId");
      }
    } else {
      checks.push({
        check: "upstream cross-search feed reachable",
        pass: false,
        error: err.message
      });
      errors.push("unable to fetch posts-cross-search.json: " + err.message);
    }
  }

  const inboxItems = inbox.items || [];
  const officialSourceIdItems = inboxItems.filter(function (item) {
    const sourcePostId = item.sns_fetch && item.sns_fetch.source_post_id;
    return (
      (item.sns_fetch && item.sns_fetch.source_id) ||
      (sourcePostId && /^POST-SRC-/.test(sourcePostId))
    );
  });
  checks.push({
    check: "layer2 inbox has no official sourceId dependency",
    pass: officialSourceIdItems.length === 0,
    official_source_id_items: officialSourceIdItems.length
  });
  if (officialSourceIdItems.length > 0) {
    errors.push("layer2 inbox still contains official sourceId-linked items");
  }

  if (fs.existsSync(SOCIAL_INDEX)) {
    const index = readJson(SOCIAL_INDEX);
    const entries = index.entries || [];
    const officialIndexIds = entries.filter(function (entry) {
      return /SRC-(NAT|KUM|MUN|PER)-/.test(entry.id || "");
    });
    checks.push({
      check: "layer2 index ids are not official SRC-based ids",
      pass: officialIndexIds.length === 0,
      official_index_id_count: officialIndexIds.length,
      index_count: entries.length
    });
    if (officialIndexIds.length > 0) {
      errors.push("disaster_social_index still contains official SRC-based ids");
    }
  }

  const snsFetchJs = fs.readFileSync(
    path.join(ROOT, "monitor", "disaster-social-sns-fetch.js"),
    "utf8"
  );
  checks.push({
    check: "fetch module references cross-search feed constant",
    pass:
      snsFetchJs.indexOf("DEFAULT_X_CROSS_SEARCH_FEED_URL") !== -1 &&
      snsFetchJs.indexOf("posts-cross-search.json") !== -1
  });
  checks.push({
    check: "fetch module does not import official source registry",
    pass: snsFetchJs.indexOf("disaster-social-x-source-registry") === -1
  });
  if (snsFetchJs.indexOf("disaster-social-x-source-registry") !== -1) {
    errors.push("disaster-social-sns-fetch.js must not depend on official source registry");
  }

  console.log(
    JSON.stringify(
      {
        DISASTER_X_CROSS_SEARCH_SOURCE_SEPARATION: errors.length === 0 ? "PASS" : "FAIL",
        layer_mapping: {
          official_public_info: "unchanged",
          x_cross_search: "posts-cross-search.json",
          official_x_feed: "posts.json via x_feed_preview.json",
          municipality_summary: "unchanged"
        },
        checks: checks,
        errors: errors
      },
      null,
      2
    )
  );

  if (errors.length > 0) {
    process.exit(1);
  }
}

main().catch(function (err) {
  console.error(err);
  process.exit(1);
});
