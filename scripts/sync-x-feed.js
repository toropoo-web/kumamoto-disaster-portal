#!/usr/bin/env node
"use strict";

const fs = require("fs");
const https = require("https");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUTPUT_PATH = path.join(ROOT, "data", "public", "x_feed_preview.json");

const X_FEED_POSTS_URL =
  "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts.json";

const MIN_ITEMS = 5;
const MAX_ITEMS = 8;

const EXCLUDED_PATTERNS = [/DEMO/i, /SEED/i, /デモ/];

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`HTTP ${response.statusCode} for ${url}`));
          response.resume();
          return;
        }

        let data = "";
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error(`Invalid JSON from ${url}: ${err.message}`));
          }
        });
      })
      .on("error", reject);
  });
}

function isExcludedPost(post) {
  const fields = [post.sourceId, post.postId, post.sourceName, post.accountHandle, post.category];
  const haystack = fields.filter(Boolean).join(" ");
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(haystack));
}

function isActivePost(post) {
  return post && post.status === "ACTIVE";
}

function getPostText(post) {
  if (typeof post.summary === "string" && post.summary.trim() !== "") {
    return post.summary.trim();
  }
  if (typeof post.title === "string" && post.title.trim() !== "") {
    return post.title.trim();
  }
  return "";
}

function toPreviewPost(post) {
  return {
    source_id: post.sourceId,
    account_name: post.sourceName,
    post_time: post.postedAt,
    text: getPostText(post),
    url: post.postUrl
  };
}

function isValidPreviewPost(post) {
  return (
    post.source_id &&
    post.account_name &&
    post.post_time &&
    post.text &&
    post.url &&
    (post.url.startsWith("https://") || post.url.startsWith("http://"))
  );
}

function selectPosts(posts) {
  const seen = new Set();
  const selected = [];

  const sorted = posts
    .filter(isActivePost)
    .filter((post) => !isExcludedPost(post))
    .slice()
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  for (const post of sorted) {
    const dedupeKey = post.postUrl || post.postId;
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }
    seen.add(dedupeKey);

    const preview = toPreviewPost(post);
    if (!isValidPreviewPost(preview)) {
      continue;
    }

    selected.push(preview);
    if (selected.length >= MAX_ITEMS) {
      break;
    }
  }

  return selected;
}

async function main() {
  const rawPosts = await fetchJson(X_FEED_POSTS_URL);
  if (!Array.isArray(rawPosts)) {
    throw new Error("x-feed posts.json must be an array");
  }

  const posts = selectPosts(rawPosts);

  if (posts.length < MIN_ITEMS) {
    console.warn(
      `Warning: only ${posts.length} posts selected (minimum recommended: ${MIN_ITEMS})`
    );
  }

  const output = {
    section_title: "公式X速報",
    synced_at: new Date().toISOString(),
    source_feed_url: X_FEED_POSTS_URL,
    item_count: posts.length,
    posts
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  const result = {
    X_FEED_SYNC: "PASS",
    source: X_FEED_POSTS_URL,
    rawCount: rawPosts.length,
    selectedCount: posts.length,
    output: path.relative(ROOT, OUTPUT_PATH)
  };

  console.log("=== X Feed Sync ===");
  console.log(JSON.stringify(result, null, 2));

  if (posts.length === 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("=== X Feed Sync ===");
  console.error(JSON.stringify({ X_FEED_SYNC: "FAIL", error: err.message }, null, 2));
  process.exit(1);
});
