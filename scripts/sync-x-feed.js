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
const EXCLUDED_SOURCE_IDS = new Set(["SRC-PER-001"]);
const EXCLUDED_ACCOUNT_HANDLES = new Set(["shinjirokoiz"]);

const SOURCE_REGISTRY = {
  "SRC-MUN-KM001": {
    municipality: "熊本市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: "DISASTER_RELATED",
    account_handle: "kumamotocity_"
  },
  "SRC-MUN-KM005": {
    municipality: "八代市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: "DISASTER_RELATED",
    account_handle: "yatsushiro0801"
  },
  "SRC-MUN-KM006": {
    municipality: "人吉市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: "DISASTER_RELATED",
    account_handle: "hitoyoshishi"
  }
};

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
  if (!post) {
    return true;
  }

  if (EXCLUDED_SOURCE_IDS.has(post.sourceId)) {
    return true;
  }

  if (post.accountHandle && EXCLUDED_ACCOUNT_HANDLES.has(post.accountHandle)) {
    return true;
  }

  const fields = [post.sourceId, post.postId, post.sourceName, post.accountHandle, post.category];
  const haystack = fields.filter(Boolean).join(" ");
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(haystack));
}

function getSourceMeta(post) {
  return SOURCE_REGISTRY[post.sourceId] || null;
}

function resolveSourceType(post, registryMeta) {
  if (registryMeta && registryMeta.source_type) {
    return registryMeta.source_type;
  }

  if (typeof post.sourceId === "string") {
    if (post.sourceId.startsWith("SRC-NAT-")) {
      return "GOVERNMENT";
    }
    if (post.sourceId.startsWith("SRC-KUM-")) {
      return "PREFECTURE";
    }
  }

  return null;
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
  const registryMeta = getSourceMeta(post);
  const accountHandle = post.accountHandle || (registryMeta && registryMeta.account_handle) || null;
  const preview = {
    source_id: post.sourceId,
    account_name: post.sourceName,
    account_handle: accountHandle,
    post_time: post.postedAt,
    text: getPostText(post),
    url: post.postUrl
  };

  const sourceType = resolveSourceType(post, registryMeta);
  if (sourceType) {
    preview.source_type = sourceType;
  }
  if (registryMeta && registryMeta.municipality) {
    preview.municipality = registryMeta.municipality;
  }
  if (registryMeta && registryMeta.content_filter) {
    preview.content_filter = registryMeta.content_filter;
  }

  return preview;
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
  const localGovernmentBySource = new Map();

  const sorted = posts
    .filter(isActivePost)
    .filter((post) => !isExcludedPost(post))
    .slice()
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  for (const post of sorted) {
    const preview = toPreviewPost(post);
    if (!isValidPreviewPost(preview)) {
      continue;
    }

    if (preview.source_type === "LOCAL_GOVERNMENT" && !localGovernmentBySource.has(preview.source_id)) {
      localGovernmentBySource.set(preview.source_id, preview);
    }
  }

  for (const preview of localGovernmentBySource.values()) {
    if (seen.has(preview.url)) {
      continue;
    }
    seen.add(preview.url);
    selected.push(preview);
  }

  for (const post of sorted) {
    if (selected.length >= MAX_ITEMS) {
      break;
    }

    const dedupeKey = post.postUrl || post.postId;
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    const preview = toPreviewPost(post);
    if (!isValidPreviewPost(preview)) {
      continue;
    }

    seen.add(dedupeKey);
    selected.push(preview);
  }

  return selected.slice(0, MAX_ITEMS);
}

function loadRawPosts() {
  const localFile = process.env.X_FEED_POSTS_FILE;
  if (localFile && fs.existsSync(localFile)) {
    return Promise.resolve(JSON.parse(fs.readFileSync(localFile, "utf8")));
  }

  return fetchJson(X_FEED_POSTS_URL);
}

async function main() {
  const rawPosts = await loadRawPosts();
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
    source_feed_url: process.env.X_FEED_POSTS_FILE || X_FEED_POSTS_URL,
    item_count: posts.length,
    posts
  };

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + "\n", "utf8");

  const result = {
    X_FEED_SYNC: "PASS",
    source: process.env.X_FEED_POSTS_FILE || X_FEED_POSTS_URL,
    rawCount: rawPosts.length,
    selectedCount: posts.length,
    excludedSourceIds: Array.from(EXCLUDED_SOURCE_IDS),
    localGovernmentCount: posts.filter((post) => post.source_type === "LOCAL_GOVERNMENT").length,
    personalSourceCount: posts.filter((post) => post.source_id === "SRC-PER-001").length,
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
