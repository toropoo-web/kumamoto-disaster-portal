"use strict";

const fs = require("fs");
const path = require("path");

const {
  loadXFeedDiscoveryPosts,
  normalizeXFeedPost
} = require("./support-service-source-discovery");

const ROOT = path.join(__dirname, "..");
const DEFAULT_PATROL_FIXTURE_FILE = path.join(
  ROOT,
  "monitor",
  "fixtures",
  "support-service-patrol",
  "source-posts-fixture.json"
);
const DEFAULT_X_FEED_FILE = path.join(ROOT, "data", "public", "x_feed_preview.json");

function normalizeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function parseAreaParts(area) {
  const normalized = normalizeText(area);
  const prefectureMatch = normalized.match(/^(熊本県|鹿児島県)/);
  const prefecture = prefectureMatch ? prefectureMatch[1] : null;
  const municipality = prefecture ? normalized.replace(prefecture, "") || null : normalized || null;
  return {
    prefecture: prefecture,
    municipality: municipality
  };
}

function buildPostFromSource(source, content) {
  const areaParts = parseAreaParts(source.area);
  const text =
    content.text ||
    content.content ||
    (content.title ? String(content.title) : "") ||
    "UNKNOWN";
  return {
    source_type: source.platform === "WEB" ? "WEB" : "X",
    source_url: content.source_url || source.url || "",
    source_name: source.source_name || "",
    account: content.account || source.account || "",
    text: text,
    title: content.title || source.source_name || "UNKNOWN",
    content: content.content || content.text || "UNKNOWN",
    published_at: content.published_at || "UNKNOWN",
    prefecture: content.prefecture || areaParts.prefecture || "UNKNOWN",
    municipality: content.municipality || areaParts.municipality || "UNKNOWN",
    area: source.area || "UNKNOWN",
    categories: Array.isArray(source.categories) ? source.categories.slice() : [],
    registry_source_id: source.source_id
  };
}

function loadPatrolFixture(options) {
  options = options || {};
  const fixturePath = options.fixturePath || DEFAULT_PATROL_FIXTURE_FILE;
  if (!fs.existsSync(fixturePath)) {
    return {
      referenceDate: null,
      web_posts: {},
      x_feed_path: null
    };
  }
  return JSON.parse(fs.readFileSync(fixturePath, "utf8"));
}

function collectXPostsForSource(source, xFeedPosts) {
  const account = normalizeText(source.account);
  if (!account) {
    return [];
  }

  return (xFeedPosts || [])
    .filter(function (post) {
      return normalizeText(post.account) === account;
    })
    .map(function (post) {
      return buildPostFromSource(source, {
        source_url: post.source_url || post.url || source.url,
        account: post.account,
        text: post.text,
        published_at: post.published_at,
        municipality: post.municipality,
        prefecture: post.prefecture
      });
    });
}

function collectWebPostsForSource(source, fixtureMap) {
  const entries = (fixtureMap && fixtureMap[source.source_id]) || [];
  return entries.map(function (entry) {
    return buildPostFromSource(source, entry);
  });
}

function collectPatrolPostsFromRegistry(registry, options) {
  options = options || {};
  const sources = (registry && registry.sources) || [];
  const fixture = options.fixture
    ? loadPatrolFixture({
        fixturePath: options.fixturePath || DEFAULT_PATROL_FIXTURE_FILE
      })
    : { web_posts: {} };
  const xFeedPath = options.xFeedPath || fixture.x_feed_path || DEFAULT_X_FEED_FILE;
  const resolvedXFeedPath = path.isAbsolute(xFeedPath)
    ? xFeedPath
    : path.join(ROOT, xFeedPath);
  const xFeedPosts = loadXFeedDiscoveryPosts({ feedPath: resolvedXFeedPath });
  const posts = [];
  const sourceResults = [];

  sources.forEach(function (source) {
    let sourcePosts = [];
    let status = "NO_CONTENT";

    if (source.platform === "X") {
      sourcePosts = collectXPostsForSource(source, xFeedPosts);
      status = sourcePosts.length ? "SUCCESS" : "NO_CONTENT";
    } else if (source.platform === "WEB") {
      if (options.fixture) {
        sourcePosts = collectWebPostsForSource(source, fixture.web_posts || {});
        status = sourcePosts.length ? "SUCCESS" : "NO_CONTENT";
      } else {
        status = "NO_CONTENT";
      }
    } else {
      status = "FAILED";
    }

    posts.push.apply(posts, sourcePosts);
    sourceResults.push({
      source_id: source.source_id,
      source_name: source.source_name,
      platform: source.platform,
      post_count: sourcePosts.length,
      status: status
    });
  });

  return {
    posts: posts,
    source_count: sources.length,
    discovered_count: posts.length,
    referenceDate:
      options.referenceDate ||
      fixture.referenceDate ||
      new Date().toISOString().slice(0, 10),
    source_results: sourceResults,
    x_feed_path: path.relative(ROOT, resolvedXFeedPath).split(path.sep).join("/")
  };
}

module.exports = {
  DEFAULT_PATROL_FIXTURE_FILE,
  DEFAULT_X_FEED_FILE,
  buildPostFromSource,
  loadPatrolFixture,
  collectXPostsForSource,
  collectWebPostsForSource,
  collectPatrolPostsFromRegistry
};
