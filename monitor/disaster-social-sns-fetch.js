"use strict";

const https = require("https");

const {
  loadEvacuationAlertScope,
  isInCommunityScope,
  isOnOrAfterSnsFetchSinceDate,
  resolveMunicipalityPrefecture,
  SNS_FETCH_SINCE_DATE,
  COMMUNITY_FETCH_CATEGORIES
} = require("./disaster-social-community-scope");
const {
  X_COMMUNITY_SOURCE_REGISTRY,
  DEFAULT_X_SOURCE_ID
} = require("./disaster-social-x-source-registry");
const { resolveCategoryFromKeyword } = require("./disaster-social-index-engine");
const { resolveSnsPostUrlFromFeedPost } = require("./disaster-social-url");
const { normalizeInboxItem } = require("./disaster-social-pipeline");

const DEFAULT_X_FEED_URL =
  "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts.json";

const EXCLUDED_SOURCE_IDS = new Set(["SRC-PER-001"]);
const EXCLUDED_ACCOUNT_HANDLES = new Set(["shinjirokoiz"]);

function fetchJson(url) {
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
          try {
            resolve(JSON.parse(data));
          } catch (err) {
            reject(new Error("Invalid JSON from " + url + ": " + err.message));
          }
        });
      })
      .on("error", reject);
  });
}

function normalizePostsPayload(payload) {
  if (Array.isArray(payload)) {
    return payload;
  }
  if (payload && Array.isArray(payload.posts)) {
    return payload.posts;
  }
  if (payload && Array.isArray(payload.items)) {
    return payload.items;
  }
  return [];
}

function getScopeMunicipalities(scopePayload) {
  return (scopePayload || loadEvacuationAlertScope()).municipalities.slice();
}

function getPostText(post) {
  return [post.title, post.summary, post.text, post.caption]
    .filter(function (value) {
      return typeof value === "string" && value.trim();
    })
    .join(" ")
    .trim();
}

function resolveMunicipalityFromPost(post, scopeMunicipalities) {
  const registryMeta = X_COMMUNITY_SOURCE_REGISTRY[post.sourceId];
  if (registryMeta && isInCommunityScope(registryMeta.municipality)) {
    return registryMeta.municipality;
  }
  if (post.municipality && isInCommunityScope(post.municipality)) {
    return post.municipality;
  }
  const text = getPostText(post);
  const regions = Array.isArray(post.regions) ? post.regions.join(" ") : "";
  const haystack = text + " " + regions;
  const sorted = scopeMunicipalities.slice().sort(function (a, b) {
    return b.length - a.length;
  });
  for (let i = 0; i < sorted.length; i += 1) {
    if (haystack.indexOf(sorted[i]) !== -1) {
      return sorted[i];
    }
  }
  return "";
}

function resolveCommunityCategory(post) {
  const text = getPostText(post);
  const resolved = resolveCategoryFromKeyword(text);
  if (COMMUNITY_FETCH_CATEGORIES.indexOf(resolved) !== -1) {
    return resolved;
  }
  return "OTHER";
}

function resolveXSourceId(post) {
  const registryMeta = X_COMMUNITY_SOURCE_REGISTRY[post.sourceId];
  if (registryMeta && registryMeta.source_id) {
    return registryMeta.source_id;
  }
  return DEFAULT_X_SOURCE_ID;
}

function buildTitle(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "SNS投稿";
  }
  const firstLine = normalized.split(/[\n。]/)[0].trim();
  if (firstLine.length <= 80) {
    return firstLine;
  }
  return firstLine.slice(0, 77) + "...";
}

function sanitizeInboxId(prefix, rawId) {
  const safe = String(rawId || "")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 48);
  return prefix + "-" + (safe || String(Date.now()));
}

function isActivePost(post) {
  return post && (!post.status || post.status === "ACTIVE");
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
  return false;
}

function xPostToInboxItem(post, index, scopeMunicipalities) {
  const municipality = resolveMunicipalityFromPost(post, scopeMunicipalities);
  if (!municipality) {
    return null;
  }
  const postDate = String(post.postedAt || post.post_time || post.published_at || "").slice(0, 10);
  if (!isOnOrAfterSnsFetchSinceDate(postDate)) {
    return null;
  }
  const text = getPostText(post);
  const url = resolveSnsPostUrlFromFeedPost(post, "X");
  const publishedAt = post.postedAt || post.post_time || post.published_at || "";
  const sourceAccount = post.accountHandle || post.account || post.username || "";
  const item = normalizeInboxItem(
    {
      inbox_id: sanitizeInboxId("SNS-X", post.postId || post.id || index + 1),
      import_format: "SNS",
      source_type: "X",
      captured_at: post.fetchedAt || publishedAt || new Date().toISOString(),
      published_at: publishedAt,
      source_account: sourceAccount,
      source: resolveXSourceId(post),
      category: resolveCommunityCategory(post),
      prefecture: resolveMunicipalityPrefecture(municipality),
      municipality: municipality,
      district: "",
      date: postDate,
      title: buildTitle(text),
      content: text,
      url: url,
      post_url: url,
      keywords: [],
      sns_fetch: {
        platform: "X",
        source_post_id: post.postId || post.id || "",
        source_id: post.sourceId || "",
        source_account: sourceAccount,
        post_url: url,
        fetched_at: new Date().toISOString()
      }
    },
    index
  );
  return item;
}

function dedupeInboxItems(items) {
  const seen = new Set();
  const deduped = [];
  items.forEach(function (item) {
    if (!item || !item.dedupe_key || seen.has(item.dedupe_key)) {
      return;
    }
    seen.add(item.dedupe_key);
    deduped.push(item);
  });
  return deduped;
}

async function fetchXInboxItems(options) {
  options = options || {};
  const scopeMunicipalities = getScopeMunicipalities(options.scopePayload);
  const feedUrl = options.xFeedUrl || DEFAULT_X_FEED_URL;
  const payload = await fetchJson(feedUrl);
  const posts = normalizePostsPayload(payload)
    .filter(isActivePost)
    .filter(function (post) {
      return !isExcludedPost(post);
    });
  const items = [];
  posts.forEach(function (post, index) {
    const item = xPostToInboxItem(post, index, scopeMunicipalities);
    if (item) {
      items.push(item);
    }
  });
  return {
    platform: "X",
    feed_url: feedUrl,
    source_post_count: posts.length,
    inbox_item_count: items.length,
    items: items
  };
}

async function fetchDisasterSocialSnsInbox(options) {
  options = options || {};
  const xResult = await fetchXInboxItems(options);
  const items = dedupeInboxItems(xResult.items.slice());
  const municipalitySummary = {};
  items.forEach(function (item) {
    const key = item.municipality || "UNKNOWN";
    municipalitySummary[key] = (municipalitySummary[key] || 0) + 1;
  });
  const categorySummary = {};
  items.forEach(function (item) {
    const key = item.category || "OTHER";
    categorySummary[key] = (categorySummary[key] || 0) + 1;
  });
  return {
    phase: "DISASTER_CROSS_SEARCH_COMMUNITY_DATA_REBUILD",
    acquisition_mode: "SNS_AUTO_FETCH",
    since_date: SNS_FETCH_SINCE_DATE,
    fetch_categories: COMMUNITY_FETCH_CATEGORIES.slice(),
    ai_judgment: false,
    fetched_at: new Date().toISOString(),
    platforms: {
      X: {
        feed_url: xResult.feed_url,
        source_post_count: xResult.source_post_count,
        inbox_item_count: xResult.inbox_item_count
      }
    },
    inbox_item_count: items.length,
    municipality_summary: municipalitySummary,
    category_summary: categorySummary,
    items: items
  };
}

module.exports = {
  DEFAULT_X_FEED_URL,
  fetchXInboxItems,
  fetchDisasterSocialSnsInbox,
  xPostToInboxItem,
  dedupeInboxItems,
  resolveMunicipalityFromPost,
  resolveCommunityCategory
};
