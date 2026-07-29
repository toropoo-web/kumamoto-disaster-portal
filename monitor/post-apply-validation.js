"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data", "public");

const EXPECTED_AREA_COUNT = 14;
const EXPECTED_PUBLIC_CARD_COUNT = 19;
const EXPECTED_COMMUNICATION_COUNT = 7;
const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
const CONTAMINATION_PATTERNS = [/2016/, /平成28/, /H28/, /平成２８/];

function readJson(filename) {
  const full = path.join(DATA_DIR, filename);
  return JSON.parse(fs.readFileSync(full, "utf8"));
}

function isValidUrlFormat(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch (err) {
    return false;
  }
}

function fetchStatus(url, redirectCount) {
  if (redirectCount === undefined) {
    redirectCount = 0;
  }

  return new Promise((resolve) => {
    const client = url.startsWith("https") ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: 15000,
        headers: { "User-Agent": "kumamoto-disaster-portal-post-apply/1.0" }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if ([301, 302, 303, 307, 308].includes(status) && location && redirectCount < 5) {
          res.resume();
          fetchStatus(new URL(location, url).href, redirectCount + 1).then(resolve);
          return;
        }

        res.resume();
        resolve(status);
      }
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(0);
    });
    req.on("error", () => resolve(0));
    req.end();
  });
}

function validateJsonParse() {
  const files = [
    "phase1_areas.json",
    "phase1_navigation.json",
    "phase1_updates.json",
    "communication_status.json",
    "status.json"
  ];
  const errors = [];

  files.forEach((file) => {
    try {
      readJson(file);
    } catch (err) {
      errors.push("JSON parse failed: " + file + " (" + err.message + ")");
    }
  });

  return {
    check: "JSON_PARSE",
    pass: errors.length === 0,
    errors
  };
}

function validateCounts() {
  const errors = [];
  const areas = readJson("phase1_areas.json");
  const updates = readJson("phase1_updates.json");
  const comm = readJson("communication_status.json");

  if (areas.length !== EXPECTED_AREA_COUNT) {
    errors.push("Area count: " + areas.length + " (expected " + EXPECTED_AREA_COUNT + ")");
  }

  const publicCards = updates.filter(
    (record) =>
      record.verification_status === "VERIFIED" &&
      record.incident_scope === INCIDENT_SCOPE &&
      record.source_url &&
      record.headline
  );

  if (publicCards.length !== EXPECTED_PUBLIC_CARD_COUNT) {
    errors.push("Public card count: " + publicCards.length + " (expected " + EXPECTED_PUBLIC_CARD_COUNT + ")");
  }

  const providerCount = (comm.providers || []).length;
  const serviceCount = (comm.services || []).length;
  const commCount = providerCount + serviceCount;

  if (commCount !== EXPECTED_COMMUNICATION_COUNT) {
    errors.push("Communication count: " + commCount + " (expected " + EXPECTED_COMMUNICATION_COUNT + ")");
  }

  if (!comm.section_title) {
    errors.push("Communication section_title missing");
  }

  return {
    check: "COUNTS",
    pass: errors.length === 0,
    areaCount: areas.length,
    publicCardCount: publicCards.length,
    communicationCount: commCount,
    errors
  };
}

function validateIdDuplicates() {
  const errors = [];
  const areas = readJson("phase1_areas.json");
  const updates = readJson("phase1_updates.json");
  const areaIds = new Set();
  const recordKeys = new Set();

  areas.forEach((area) => {
    if (areaIds.has(area.area_id)) {
      errors.push("Duplicate area_id: " + area.area_id);
    }
    areaIds.add(area.area_id);
  });

  updates.forEach((record, index) => {
    const key = record.area_id + "|" + record.headline + "|" + record.source_url;
    if (recordKeys.has(key)) {
      errors.push("Duplicate update record at index " + index);
    }
    recordKeys.add(key);
  });

  return {
    check: "ID_DUPLICATES",
    pass: errors.length === 0,
    errors
  };
}

function validateUrlFormats() {
  const errors = [];
  const updates = readJson("phase1_updates.json");
  const comm = readJson("communication_status.json");

  updates.forEach((record) => {
    if (record.source_url && !isValidUrlFormat(record.source_url)) {
      errors.push("Invalid URL format: " + record.source_url);
    }
  });

  (comm.providers || []).forEach((provider) => {
    if (provider.source_url && !isValidUrlFormat(provider.source_url)) {
      errors.push("Invalid provider URL: " + provider.source_url);
    }
  });

  (comm.services || []).forEach((service) => {
    if (service.source_url && !isValidUrlFormat(service.source_url)) {
      errors.push("Invalid service URL: " + service.source_url);
    }
  });

  return {
    check: "URL_FORMAT",
    pass: errors.length === 0,
    errors
  };
}

function validateContamination() {
  const errors = [];
  const files = ["phase1_updates.json", "communication_status.json"];

  files.forEach((file) => {
    const text = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
    if (CONTAMINATION_PATTERNS.some((pattern) => pattern.test(text))) {
      errors.push("2016 contamination pattern found in " + file);
    }
  });

  return {
    check: "CONTAMINATION_2016",
    pass: errors.length === 0,
    errors
  };
}

function validateBuild() {
  const errors = [];
  const staticFiles = [
    "index.html",
    "css/styles.css",
    "js/app.js",
    "data/public/phase1_areas.json",
    "data/public/phase1_navigation.json",
    "data/public/phase1_updates.json",
    "data/public/communication_status.json",
    "data/public/status.json"
  ];

  staticFiles.forEach((file) => {
    const full = path.join(ROOT, file);
    if (!fs.existsSync(full)) {
      errors.push("Missing static file: " + file);
    }
  });

  return {
    check: "BUILD_FILES",
    pass: errors.length === 0,
    errors
  };
}

async function validateAppliedUrls(appliedUrls) {
  const errors = [];
  const results = [];

  for (const url of appliedUrls || []) {
    const status = await fetchStatus(url);
    results.push({ url, status });
    if (status < 200 || status >= 400) {
      errors.push("Applied URL not reachable: " + url + " (HTTP " + status + ")");
    }
  }

  return {
    check: "APPLIED_URL_REACHABILITY",
    pass: errors.length === 0,
    results,
    errors
  };
}

async function runPostApplyValidation(options) {
  const appliedUrls = (options && options.appliedUrls) || [];
  const checks = [
    validateJsonParse(),
    validateCounts(),
    validateIdDuplicates(),
    validateUrlFormats(),
    validateContamination(),
    validateBuild()
  ];

  if (appliedUrls.length) {
    checks.push(await validateAppliedUrls(appliedUrls));
  }

  const errors = [];
  checks.forEach((check) => {
    if (!check.pass) {
      errors.push.apply(errors, check.errors);
    }
  });

  return {
    validatedAt: new Date().toISOString(),
    POST_APPLY_VALIDATION: errors.length === 0 ? "PASS" : "FAIL",
    AUTO_PUBLICATION: false,
    checks,
    errors
  };
}

module.exports = {
  EXPECTED_AREA_COUNT,
  EXPECTED_PUBLIC_CARD_COUNT,
  EXPECTED_COMMUNICATION_COUNT,
  runPostApplyValidation,
  validateJsonParse,
  validateCounts,
  validateIdDuplicates,
  validateUrlFormats,
  validateContamination,
  validateBuild,
  validateAppliedUrls
};
