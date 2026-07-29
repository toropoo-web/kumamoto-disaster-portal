"use strict";

const https = require("https");
const { fetchSource } = require("./crawler");
const { parsePage, hashContent, normalizeContent } = require("./parser");

const X_FEED_POSTS_URL =
  "https://raw.githubusercontent.com/toropoo-web/kumamoto-disaster-x-feed/main/data/posts.json";

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error("HTTP " + response.statusCode + " for " + url));
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
            reject(new Error("Invalid JSON from " + url + ": " + err.message));
          }
        });
      })
      .on("error", reject);
  });
}

async function loadXFeedPosts(options) {
  if (options && options.fixturePosts) {
    return options.fixturePosts.slice();
  }

  const data = await fetchJson(X_FEED_POSTS_URL);
  return Array.isArray(data) ? data : data.posts || data.items || [];
}

function getPostText(post) {
  if (typeof post.summary === "string" && post.summary.trim() !== "") {
    return post.summary.trim();
  }
  if (typeof post.title === "string" && post.title.trim() !== "") {
    return post.title.trim();
  }
  if (typeof post.text === "string" && post.text.trim() !== "") {
    return post.text.trim();
  }
  return "";
}

function mergeFixturePosts(posts, fixturePosts) {
  if (!fixturePosts || !fixturePosts.length) {
    return posts;
  }
  return posts.concat(fixturePosts);
}

function pickLatestPost(posts, feedSourceId) {
  const active = posts.filter((post) => {
    if (post.sourceId !== feedSourceId) {
      return false;
    }
    if (Object.prototype.hasOwnProperty.call(post, "status")) {
      return post.status === "ACTIVE";
    }
    return true;
  });

  if (!active.length) {
    return null;
  }

  return active.sort((a, b) => {
    const aTime = a.postedAt || a.post_time || "";
    const bTime = b.postedAt || b.post_time || "";
    return aTime < bTime ? 1 : -1;
  })[0];
}

async function fetchXEmergencySource(source, options) {
  const feedSourceId = source.x_feed_source_id;
  if (!feedSourceId) {
    return {
      url: source.url,
      reachable: false,
      title: "",
      originalText: "",
      pageUpdatedAt: "",
      keywords: [],
      contaminationRisk: false,
      contentHash: hashContent(""),
      checkedAt: new Date().toISOString()
    };
  }

  let posts;
  try {
    posts = await loadXFeedPosts(options);
    posts = mergeFixturePosts(posts, options && options.fixturePosts);
  } catch (err) {
    return {
      url: source.url,
      reachable: false,
      title: "",
      originalText: "",
      pageUpdatedAt: "",
      keywords: [],
      contaminationRisk: false,
      contentHash: hashContent(""),
      fetchError: err.message,
      checkedAt: new Date().toISOString()
    };
  }

  const latest = pickLatestPost(posts, feedSourceId);
  if (!latest) {
    return {
      url: source.url,
      reachable: false,
      title: "",
      originalText: "",
      pageUpdatedAt: "",
      keywords: [],
      contaminationRisk: false,
      contentHash: hashContent(""),
      checkedAt: new Date().toISOString()
    };
  }

  const originalText = getPostText(latest);
  const publishedAt = latest.postedAt || latest.post_time || "";
  const postUrl = latest.postUrl || latest.url || source.url;

  return {
    url: postUrl,
    reachable: originalText.length > 0,
    title: originalText.slice(0, 80),
    originalText,
    pageUpdatedAt: publishedAt,
    publishedAt,
    keywords: [],
    contaminationRisk: false,
    contentHash: hashContent(originalText),
    postId: latest.postId || null,
    checkedAt: new Date().toISOString()
  };
}

function extractPageOriginalText(html) {
  const content = normalizeContent(html || "");
  return content.text.slice(0, 4000).trim();
}

async function fetchWebEmergencySource(source) {
  const fetched = await fetchSource(source.url);
  const parsed = parsePage(fetched);
  const originalText = extractPageOriginalText(fetched.body || "");

  return Object.assign({}, parsed, {
    originalText,
    publishedAt: parsed.pageUpdatedAt || ""
  });
}

async function fetchEmergencySource(source, options) {
  if (source.source_type === "MUNICIPAL_X") {
    return fetchXEmergencySource(source, options);
  }
  return fetchWebEmergencySource(source);
}

module.exports = {
  X_FEED_POSTS_URL,
  loadXFeedPosts,
  fetchEmergencySource,
  fetchXEmergencySource,
  fetchWebEmergencySource,
  getPostText,
  pickLatestPost
};
