"use strict";

const crypto = require("crypto");
const https = require("https");
const http = require("http");
const { USER_AGENT, FETCH_TIMEOUT_MS } = require("../constants");

const FEED_PATH_CANDIDATES = [
  "/rss.xml",
  "/feed",
  "/feed.xml",
  "/atom.xml",
  "/index.xml",
  "/sitemap.xml"
];

function fetchUrl(url) {
  return new Promise(function (resolve) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (err) {
      resolve({ ok: false, body: "", error: "invalid_url" });
      return;
    }

    const client = parsed.protocol === "https:" ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          "User-Agent": USER_AGENT,
          Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*"
        }
      },
      function (res) {
        const chunks = [];
        res.on("data", function (chunk) {
          chunks.push(chunk);
        });
        res.on("end", function () {
          const body = Buffer.concat(chunks).toString("utf8");
          resolve({
            ok: res.statusCode >= 200 && res.statusCode < 400,
            status: res.statusCode,
            body: body
          });
        });
      }
    );

    req.on("timeout", function () {
      req.destroy();
      resolve({ ok: false, body: "", error: "timeout" });
    });

    req.on("error", function (err) {
      resolve({ ok: false, body: "", error: err.message });
    });

    req.end();
  });
}

function discoverFeedUrls(pageUrl, html) {
  const discovered = new Set();
  const base = pageUrl;

  if (html) {
    const linkRegex =
      /<link[^>]+(?:type=["']application\/(?:rss|atom)\+xml["']|rel=["']alternate["'])[^>]+href=["']([^"']+)["']/gi;
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      try {
        discovered.add(new URL(match[1], base).toString());
      } catch (err) {
        /* skip invalid */
      }
    }
  }

  try {
    const origin = new URL(base).origin;
    FEED_PATH_CANDIDATES.forEach(function (path) {
      discovered.add(origin + path);
    });
  } catch (err) {
    /* skip */
  }

  return Array.from(discovered).slice(0, 6);
}

function parseFeedEntries(xml) {
  const entries = [];
  if (!xml) {
    return entries;
  }

  const itemRegex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/gi;
  let block;
  while ((block = itemRegex.exec(xml)) !== null) {
    const chunk = block[1];
    const titleMatch = chunk.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const linkMatch =
      chunk.match(/<link[^>]+href=["']([^"']+)["']/i) ||
      chunk.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    const updatedMatch =
      chunk.match(/<updated[^>]*>([\s\S]*?)<\/updated>/i) ||
      chunk.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i);

    const title = titleMatch ? titleMatch[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
    const link = linkMatch ? linkMatch[1].trim() : "";
    const updated = updatedMatch ? updatedMatch[1].trim() : "";

    if (title || link) {
      entries.push({ title: title, link: link, updated: updated });
    }
  }

  return entries.slice(0, 30);
}

function buildFeedFingerprint(entries) {
  const normalized = entries
    .map(function (entry) {
      return [entry.title, entry.link, entry.updated].join("|");
    })
    .join("\n");
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

async function probeFeeds(pageUrl, html) {
  const candidates = discoverFeedUrls(pageUrl, html);
  const results = [];

  for (let i = 0; i < candidates.length; i += 1) {
    const feedUrl = candidates[i];
    const response = await fetchUrl(feedUrl);
    if (!response.ok || !response.body) {
      continue;
    }

    const isXml =
      /<(rss|feed|rdf:RDF|urlset)/i.test(response.body) ||
      /application\/(rss|atom)\+xml/i.test(response.body);

    if (!isXml) {
      continue;
    }

    const entries = parseFeedEntries(response.body);
    if (!entries.length && !/<urlset/i.test(response.body)) {
      continue;
    }

    results.push({
      feedUrl: feedUrl,
      entryCount: entries.length,
      fingerprint: buildFeedFingerprint(entries),
      latestTitle: entries[0] ? entries[0].title : "",
      latestUpdated: entries[0] ? entries[0].updated : ""
    });

    if (results.length >= 2) {
      break;
    }
  }

  return results;
}

module.exports = {
  discoverFeedUrls,
  parseFeedEntries,
  buildFeedFingerprint,
  probeFeeds,
  fetchUrl
};
