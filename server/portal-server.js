"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { recordUsageEvent, isAllowedUsageEvent, buildUserUsageCounter } = require("../monitor/user-usage-counter");

const ROOT = path.join(__dirname, "..");
const PORT = Number(process.env.PORT || 3000);

const CACHE_CONTROL_PATHS = {
  "/index.html": "no-cache, no-store, must-revalidate",
  "/data/public/phase1_updates.json": "no-cache, no-store, must-revalidate",
  "/data/public/communication_status.json": "no-cache, no-store, must-revalidate",
  "/data/public/status.json": "no-cache, no-store, must-revalidate",
  "/data/public/x_feed_preview.json": "no-cache, no-store, must-revalidate",
  "/data/public/disaster_locations.json": "no-cache, no-store, must-revalidate",
  "/data/public/water_cross_view.json": "no-cache, no-store, must-revalidate",
  "/data/public/water_search_index.json": "no-cache, no-store, must-revalidate",
  "/data/public/disaster_search_index.json": "no-cache, no-store, must-revalidate"
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function readRequestBody(req) {
  return new Promise(function (resolve, reject) {
    let data = "";
    req.on("data", function (chunk) {
      data += chunk;
      if (data.length > 1024) {
        reject(new Error("payload too large"));
        req.destroy();
      }
    });
    req.on("end", function () {
      resolve(data);
    });
    req.on("error", reject);
  });
}

function resolveFilePath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split("?")[0]);
  if (decoded === "/" || decoded === "") {
    return path.join(ROOT, "index.html");
  }
  const candidate = path.normalize(path.join(ROOT, decoded.replace(/^\//, "")));
  if (!candidate.startsWith(ROOT)) {
    return null;
  }
  return candidate;
}

function serveStatic(req, res) {
  const filePath = resolveFilePath(req.url);
  if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const headers = {
    "Content-Type": MIME_TYPES[ext] || "application/octet-stream"
  };
  const urlPath = req.url.split("?")[0];
  const cacheControl = CACHE_CONTROL_PATHS[urlPath];
  if (cacheControl) {
    headers["Cache-Control"] = cacheControl;
  } else if (urlPath.indexOf("/data/operation_monitor/") === 0) {
    headers["Cache-Control"] = "no-cache, no-store, must-revalidate";
  }

  res.writeHead(200, headers);
  fs.createReadStream(filePath).pipe(res);
}

async function handleUsageEvent(req, res) {
  try {
    const raw = await readRequestBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const eventName = payload && payload.event;

    if (!isAllowedUsageEvent(eventName)) {
      sendJson(res, 400, { ok: false, error: "invalid event" });
      return;
    }

    const result = recordUsageEvent(eventName);
    if (!result.ok) {
      sendJson(res, 500, { ok: false, error: result.error || "record failed" });
      return;
    }
    sendJson(res, 200, { ok: true, event: result.event, recorded_at: result.recorded_at });
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[usage-event] request failed:", err);
    }
    sendJson(res, 400, { ok: false, error: "invalid request" });
  }
}

function handleUsageCounter(req, res) {
  try {
    const report = buildUserUsageCounter();
    sendJson(res, 200, report);
  } catch (err) {
    if (process.env.NODE_ENV !== "production") {
      console.error("[usage-counter] read failed:", err);
    }
    sendJson(res, 500, { ok: false, error: "counter read failed" });
  }
}

function createPortalServer() {
  return http.createServer(function (req, res) {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, "http://localhost");
    if (req.method === "POST" && url.pathname === "/api/usage-event") {
      handleUsageEvent(req, res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/usage-counter") {
      handleUsageCounter(req, res);
      return;
    }

    if (req.method === "GET" || req.method === "HEAD") {
      serveStatic(req, res);
      return;
    }

    res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method Not Allowed");
  });
}

function startPortalServer(options) {
  options = options || {};
  const server = createPortalServer();
  const port = options.port || PORT;
  return new Promise(function (resolve) {
    server.listen(port, function () {
      resolve({ server: server, port: port });
    });
  });
}

if (require.main === module) {
  startPortalServer().then(function (info) {
    console.log("Portal server listening on port " + info.port);
  });
}

module.exports = {
  createPortalServer,
  startPortalServer,
  ROOT,
  PORT
};
