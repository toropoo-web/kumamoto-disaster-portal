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

const MUNICIPALITY_CONTENT_FILTER = "RECENT_POSTS";
const STRICT_MUNICIPALITY_CONTENT_FILTER = "DISASTER_RELATED";

const DISASTER_CONTENT_KEYWORDS = [
  "地震",
  "災害",
  "避難",
  "津波",
  "熊本地震",
  "余震",
  "震度",
  "防災",
  "気象",
  "土砂",
  "豪雨",
  "大雨",
  "浸水",
  "警戒",
  "被災",
  "罹災"
];

const DISASTER_RELATED_CATEGORIES = new Set([
  "EARTHQUAKE_TSUNAMI",
  "DISASTER",
  "EVACUATION",
  "ALERT",
  "TSUNAMI"
]);

const SOURCE_REGISTRY = {
  "SRC-MUN-KM001": {
    municipality: "熊本市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: MUNICIPALITY_CONTENT_FILTER,
    account_handle: "kumamotocity_"
  },
  "SRC-MUN-KM005": {
    municipality: "八代市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: MUNICIPALITY_CONTENT_FILTER,
    account_handle: "yatsushiro0801"
  },
  "SRC-MUN-KM006": {
    municipality: "人吉市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: MUNICIPALITY_CONTENT_FILTER,
    account_handle: "hitoyoshishi"
  },
  "SRC-MUN-KM009": {
    municipality: "合志市",
    source_type: "LOCAL_GOVERNMENT",
    content_filter: MUNICIPALITY_CONTENT_FILTER,
    account_handle: "Koshi_city"
  }
};

function buildStrictMunicipalityRegistry() {
  const strict = {};
  Object.keys(SOURCE_REGISTRY).forEach(function (sourceId) {
    strict[sourceId] = Object.assign({}, SOURCE_REGISTRY[sourceId], {
      content_filter: STRICT_MUNICIPALITY_CONTENT_FILTER
    });
  });
  return strict;
}

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

function getSourceMeta(post, sourceRegistry) {
  const registry = sourceRegistry || SOURCE_REGISTRY;
  return registry[post.sourceId] || null;
}

function isOfficialMunicipalityPost(post, registryMeta) {
  return Boolean(registryMeta && registryMeta.source_type === "LOCAL_GOVERNMENT");
}

function matchesDisasterRelatedContent(post) {
  const text = getPostText(post);
  const haystack = [text, post.category, post.title, post.sourceName].filter(Boolean).join(" ");

  if (post.category && DISASTER_RELATED_CATEGORIES.has(post.category)) {
    return true;
  }

  return DISASTER_CONTENT_KEYWORDS.some(function (keyword) {
    return haystack.indexOf(keyword) !== -1;
  });
}

function passesContentFilter(post, registryMeta) {
  if (!registryMeta || !registryMeta.content_filter) {
    return true;
  }

  if (registryMeta.content_filter === MUNICIPALITY_CONTENT_FILTER) {
    return true;
  }

  if (registryMeta.content_filter === STRICT_MUNICIPALITY_CONTENT_FILTER) {
    return matchesDisasterRelatedContent(post);
  }

  return true;
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

function toPreviewPost(post, sourceRegistry) {
  const registryMeta = getSourceMeta(post, sourceRegistry);
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

function selectPosts(posts, options) {
  options = options || {};
  const sourceRegistry = options.sourceRegistry || SOURCE_REGISTRY;
  const seen = new Set();
  const selected = [];
  const localGovernmentBySource = new Map();

  const sorted = posts
    .filter(isActivePost)
    .filter((post) => !isExcludedPost(post))
    .slice()
    .sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));

  for (const post of sorted) {
    const registryMeta = getSourceMeta(post, sourceRegistry);
    if (!passesContentFilter(post, registryMeta)) {
      continue;
    }

    const preview = toPreviewPost(post, sourceRegistry);
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

    const registryMeta = getSourceMeta(post, sourceRegistry);
    if (!passesContentFilter(post, registryMeta)) {
      continue;
    }

    const dedupeKey = post.postUrl || post.postId;
    if (!dedupeKey || seen.has(dedupeKey)) {
      continue;
    }

    const preview = toPreviewPost(post, sourceRegistry);
    if (!isValidPreviewPost(preview)) {
      continue;
    }

    seen.add(dedupeKey);
    selected.push(preview);
  }

  return selected.slice(0, MAX_ITEMS);
}

function countSelectedMunicipalityPosts(posts, options) {
  return selectPosts(posts, options).filter(function (post) {
    return post.source_type === "LOCAL_GOVERNMENT";
  }).length;
}

function loadRawPosts(options) {
  const localFile = options.postsFile || process.env.X_FEED_POSTS_FILE;
  if (localFile && fs.existsSync(localFile)) {
    return Promise.resolve(JSON.parse(fs.readFileSync(localFile, "utf8")));
  }

  const url = options.postsUrl || X_FEED_POSTS_URL;
  return fetchJson(url);
}

function loadExistingPreview(outputPath) {
  if (!fs.existsSync(outputPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(outputPath, "utf8"));
  } catch {
    return null;
  }
}

function resolveFailOpen(options) {
  if (typeof options.failOpen === "boolean") {
    return options.failOpen;
  }
  return process.env.X_FEED_FAIL_OPEN !== "false";
}

function resolveSourceFeedUrl(options) {
  return options.postsFile || process.env.X_FEED_POSTS_FILE || options.postsUrl || X_FEED_POSTS_URL;
}

function previewContentEquals(existing, output) {
  if (!existing || !output) {
    return false;
  }
  return (
    existing.section_title === output.section_title &&
    existing.item_count === output.item_count &&
    JSON.stringify(existing.posts) === JSON.stringify(output.posts)
  );
}

function buildPreviewOutput(posts, meta) {
  const output = {
    section_title: "公式X速報",
    synced_at: meta.attemptedAt,
    source_feed_url: meta.sourceFeedUrl,
    item_count: posts.length,
    posts
  };

  if (meta.syncStatus) {
    output.sync_status = meta.syncStatus;
  }
  if (meta.syncError) {
    output.sync_error = meta.syncError;
  }
  if (meta.lastSuccessfulSyncAt) {
    output.last_successful_sync_at = meta.lastSuccessfulSyncAt;
  }

  return output;
}

function writePreviewOutput(outputPath, output) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(output, null, 2) + "\n", "utf8");
}

function buildResult(status, fields) {
  return Object.assign({ X_FEED_SYNC: status }, fields);
}

function writeGithubOutput(result) {
  const githubOutput = process.env.GITHUB_OUTPUT;
  if (!githubOutput) {
    return;
  }

  const lines = [
    "sync_status=" + result.X_FEED_SYNC,
    "has_preview=" + (result.selectedCount > 0 ? "true" : "false")
  ];
  fs.appendFileSync(githubOutput, lines.join("\n") + "\n", "utf8");
}

function retainStalePreview(outputPath, sourceFeedUrl, errorMessage) {
  const existing = loadExistingPreview(outputPath);
  if (!existing || !Array.isArray(existing.posts) || existing.posts.length === 0) {
    return null;
  }

  const attemptedAt = new Date().toISOString();
  const lastSuccessfulSyncAt = existing.last_successful_sync_at || existing.synced_at;

  const output = buildPreviewOutput(existing.posts, {
    attemptedAt,
    sourceFeedUrl: existing.source_feed_url || sourceFeedUrl,
    syncStatus: "STALE",
    syncError: errorMessage,
    lastSuccessfulSyncAt
  });

  writePreviewOutput(outputPath, output);

  return buildResult("FAIL_OPEN", {
    source: sourceFeedUrl,
    error: errorMessage,
    rawCount: 0,
    selectedCount: existing.posts.length,
    retainedFrom: path.relative(ROOT, outputPath),
    sync_status: "STALE",
    last_successful_sync_at: lastSuccessfulSyncAt,
    output: path.relative(ROOT, outputPath)
  });
}

async function syncXFeed(options) {
  options = options || {};
  const outputPath = options.outputPath || OUTPUT_PATH;
  const failOpen = resolveFailOpen(options);
  const sourceFeedUrl = resolveSourceFeedUrl(options);
  const attemptedAt = new Date().toISOString();

  let rawPosts;
  try {
    rawPosts = await loadRawPosts(options);
  } catch (err) {
    if (failOpen) {
      const stale = retainStalePreview(outputPath, sourceFeedUrl, err.message);
      if (stale) {
        return stale;
      }
    }
    throw err;
  }

  if (!Array.isArray(rawPosts)) {
    const message = "x-feed posts.json must be an array";
    if (failOpen) {
      const stale = retainStalePreview(outputPath, sourceFeedUrl, message);
      if (stale) {
        return stale;
      }
    }
    throw new Error(message);
  }

  const posts = selectPosts(rawPosts);

  if (posts.length < MIN_ITEMS) {
    console.warn(
      "Warning: only " + posts.length + " posts selected (minimum recommended: " + MIN_ITEMS + ")"
    );
  }

  if (posts.length === 0) {
    if (failOpen) {
      const stale = retainStalePreview(outputPath, sourceFeedUrl, "no posts selected from upstream feed");
      if (stale) {
        return stale;
      }
    }
    throw new Error("no posts selected from upstream feed");
  }

  const output = buildPreviewOutput(posts, {
    attemptedAt,
    sourceFeedUrl,
    syncStatus: "FRESH"
  });

  const existing = loadExistingPreview(outputPath);
  if (existing && previewContentEquals(existing, output)) {
    return buildResult("NO_CHANGES", {
      source: sourceFeedUrl,
      rawCount: rawPosts.length,
      selectedCount: existing.posts.length,
      sync_status: existing.sync_status || "UNCHANGED",
      output: path.relative(ROOT, outputPath)
    });
  }

  writePreviewOutput(outputPath, output);

  return buildResult("PASS", {
    source: sourceFeedUrl,
    rawCount: rawPosts.length,
    selectedCount: posts.length,
    excludedSourceIds: Array.from(EXCLUDED_SOURCE_IDS),
    localGovernmentCount: posts.filter((post) => post.source_type === "LOCAL_GOVERNMENT").length,
    personalSourceCount: posts.filter((post) => post.source_id === "SRC-PER-001").length,
    sync_status: "FRESH",
    output: path.relative(ROOT, outputPath)
  });
}

async function main() {
  const result = await syncXFeed();
  console.log("=== X Feed Sync ===");
  console.log(JSON.stringify(result, null, 2));
  writeGithubOutput(result);

  if (result.X_FEED_SYNC === "FAIL") {
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("=== X Feed Sync ===");
    console.error(JSON.stringify({ X_FEED_SYNC: "FAIL", error: err.message }, null, 2));
    process.exit(1);
  });
}

module.exports = {
  syncXFeed,
  selectPosts,
  countSelectedMunicipalityPosts,
  loadExistingPreview,
  retainStalePreview,
  previewContentEquals,
  passesContentFilter,
  matchesDisasterRelatedContent,
  isOfficialMunicipalityPost,
  buildStrictMunicipalityRegistry,
  SOURCE_REGISTRY,
  MUNICIPALITY_CONTENT_FILTER,
  STRICT_MUNICIPALITY_CONTENT_FILTER,
  OUTPUT_PATH,
  X_FEED_POSTS_URL
};
