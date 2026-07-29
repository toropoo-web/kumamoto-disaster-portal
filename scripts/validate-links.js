#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "public");

function readJson(filename) {
  return JSON.parse(fs.readFileSync(path.join(DATA_DIR, filename), "utf8"));
}

function fetchStatus(url, attempt, redirectCount) {
  if (redirectCount === undefined) {
    redirectCount = 0;
  }

  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.request(url, { method: "GET", timeout: 15000, headers: { "User-Agent": "kumamoto-disaster-portal-validator/1.0" } }, (res) => {
      const status = res.statusCode || 0;
      const location = res.headers.location;

      if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
        res.resume();
        const nextUrl = new URL(location, url).href;
        fetchStatus(nextUrl, attempt, redirectCount + 1).then(resolve);
        return;
      }

      res.resume();
      resolve({ url, status });
    });
    req.on("timeout", () => {
      req.destroy();
      resolve({ url, status: 0, error: "timeout" });
    });
    req.on("error", (err) => {
      resolve({ url, status: 0, error: err.message });
    });
    req.end();
  }).then(async (result) => {
    const retriable = result.status === 0 && attempt < 3;
    if (retriable) {
      await new Promise((r) => setTimeout(r, 1000));
      return fetchStatus(url, attempt + 1, redirectCount);
    }
    return result;
  });
}

async function checkUrl(url) {
  return fetchStatus(url, 1);
}

async function main() {
  const updates = readJson("phase1_updates.json");
  const comm = readJson("communication_status.json");

  const urls = new Set();
  updates.forEach((r) => {
    if (r.source_url) urls.add(r.source_url);
  });
  comm.providers.forEach((p) => {
    if (p.source_url) urls.add(p.source_url);
  });
  if (comm.services) {
    comm.services.forEach((s) => {
      if (s.source_url) urls.add(s.source_url);
    });
  }

  const results = [];
  for (const url of urls) {
    const result = await checkUrl(url);
    results.push(result);
  }

  const broken = results.filter((r) => r.status < 200 || r.status >= 400);
  const summary = {
    BROKEN_LINKS: broken.length,
    CHECKED_URL_COUNT: results.length,
    LINK_VALIDATION: broken.length === 0 ? "PASS" : "FAIL",
    broken,
    results
  };

  console.log("=== Phase3 Link Validation ===");
  console.log(JSON.stringify(summary, null, 2));

  if (broken.length > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
