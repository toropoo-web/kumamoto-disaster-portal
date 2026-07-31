"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const PUBLIC_UPDATE_QUEUE_DIR = path.join(ROOT, "data", "public_update_queue");
const PUBLIC_UPDATE_QUEUE_FILE = path.join(
  PUBLIC_UPDATE_QUEUE_DIR,
  "patrol_public_update_queue.json"
);
const GATE_OUTPUT_DIR = path.join(ROOT, "data", "public_update_gate");
const MASTER_GATE_FILE = path.join(GATE_OUTPUT_DIR, "patrol_public_update_gate.json");

const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
const GATE_STATUSES = ["PASS", "FAIL", "BLOCKED"];
const CONTAMINATION_PATTERNS = [/2016/, /平成28/, /H28/, /平成２８/];

const {
  DISASTER_CATEGORIES,
  CATEGORY_TARGET_LAYERS,
  validatePublicCandidate,
  buildDuplicateKey
} = require("./review-approved-converter");

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return fallback;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function toRepoRelative(filePath) {
  if (!filePath) {
    return null;
  }
  return path.relative(ROOT, filePath).split(path.sep).join("/");
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

  return new Promise(function (resolve) {
    const client = url.startsWith("https") ? https : http;
    const req = client.request(
      url,
      {
        method: "GET",
        timeout: 15000,
        headers: { "User-Agent": "kumamoto-disaster-portal-public-update-gate/1.0" }
      },
      function (res) {
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
    req.on("timeout", function () {
      req.destroy();
      resolve(0);
    });
    req.on("error", function () {
      resolve(0);
    });
    req.end();
  });
}

function summarizeByCategory(items) {
  const summary = {};
  DISASTER_CATEGORIES.forEach(function (category) {
    summary[category] = 0;
  });
  (items || []).forEach(function (item) {
    summary[item.category] = (summary[item.category] || 0) + 1;
  });
  return summary;
}

function summarizeGateResults(results) {
  const summary = {
    total: results.length,
    passed: 0,
    failed: 0,
    blocked: 0
  };

  results.forEach(function (result) {
    if (result.gate_status === "PASS") {
      summary.passed += 1;
    } else if (result.gate_status === "BLOCKED") {
      summary.blocked += 1;
    } else {
      summary.failed += 1;
    }
  });

  return summary;
}

function collectContaminationErrors(candidate) {
  const errors = [];
  const fields = [
    candidate.title,
    candidate.source_trace && candidate.source_trace.changed_text,
    JSON.stringify(candidate.detected_keywords || [])
  ];

  fields.forEach(function (value, index) {
    const text = String(value || "");
    CONTAMINATION_PATTERNS.forEach(function (pattern) {
      if (pattern.test(text)) {
        errors.push("possible 2016 contamination in field index " + index);
      }
    });
  });

  return errors;
}

function validateGateResultShape(result) {
  const errors = [];
  const required = ["update_id", "gate_status", "validated_at", "checks", "errors", "candidate"];

  required.forEach(function (key) {
    if (!Object.prototype.hasOwnProperty.call(result, key)) {
      errors.push("missing gate result field: " + key);
    }
  });

  if (result.gate_status && GATE_STATUSES.indexOf(result.gate_status) < 0) {
    errors.push("invalid gate_status: " + result.gate_status);
  }

  if (!Array.isArray(result.checks)) {
    errors.push("checks must be an array");
  }

  if (!Array.isArray(result.errors)) {
    errors.push("errors must be an array");
  }

  return errors;
}

function validateGateBatch(batch) {
  const errors = [];

  if (!batch || typeof batch !== "object") {
    return ["gate batch missing"];
  }

  if (batch.autoPublish !== false) {
    errors.push("autoPublish must be false");
  }

  if (batch.incidentScope !== INCIDENT_SCOPE) {
    errors.push("incidentScope must be " + INCIDENT_SCOPE);
  }

  if (!Array.isArray(batch.results)) {
    errors.push("results array missing");
    return errors;
  }

  const seenUpdateIds = new Set();
  const seenDuplicateKeys = new Set();

  batch.results.forEach(function (result, index) {
    const shapeErrors = validateGateResultShape(result);
    shapeErrors.forEach(function (message) {
      errors.push("results[" + index + "]: " + message);
    });

    if (seenUpdateIds.has(result.update_id)) {
      errors.push("results[" + index + "]: duplicate update_id " + result.update_id);
    }
    seenUpdateIds.add(result.update_id);

    const duplicateKey = buildDuplicateKey(result.candidate || {});
    if (seenDuplicateKeys.has(duplicateKey)) {
      errors.push("results[" + index + "]: duplicate trace key " + duplicateKey);
    }
    seenDuplicateKeys.add(duplicateKey);
  });

  const passedIds = new Set((batch.passedUpdates || []).map(function (item) {
    return item.update_id;
  }));
  const failedIds = new Set((batch.failedUpdates || []).map(function (item) {
    return item.update_id;
  }));

  batch.results.forEach(function (result) {
    if (result.gate_status === "PASS") {
      if (!passedIds.has(result.update_id)) {
        errors.push("PASS result missing from passedUpdates: " + result.update_id);
      }
      if (failedIds.has(result.update_id)) {
        errors.push("PASS result also listed in failedUpdates: " + result.update_id);
      }
    } else if (failedIds.has(result.update_id) === false && result.gate_status !== "BLOCKED") {
      errors.push("non-PASS result missing from failedUpdates: " + result.update_id);
    }
  });

  return errors;
}

async function runCandidateGateChecks(candidate, options) {
  options = options || {};
  const checks = [];
  const errors = [];
  const validatedAt = options.validatedAt || new Date().toISOString();

  const schemaErrors = validatePublicCandidate(candidate);
  const schemaPass = schemaErrors.length === 0;
  checks.push({ name: "schema", pass: schemaPass });
  if (!schemaPass) {
    errors.push.apply(errors, schemaErrors);
  }

  const urlFormatPass = isValidUrlFormat(candidate.source_url);
  checks.push({ name: "source_url_format", pass: urlFormatPass });
  if (!urlFormatPass) {
    errors.push("source_url must be a valid http/https URL");
  }

  const trace = candidate.source_trace || {};
  const tracePass = Boolean(trace.queue_id && trace.classification_id && trace.change_log);
  checks.push({ name: "source_trace", pass: tracePass });
  if (!tracePass) {
    errors.push("source_trace.queue_id, classification_id, and change_log are required");
  }

  const contaminationErrors = collectContaminationErrors(candidate);
  const contaminationPass = contaminationErrors.length === 0;
  checks.push({ name: "incident_contamination", pass: contaminationPass });
  if (!contaminationPass) {
    errors.push.apply(errors, contaminationErrors);
  }

  const autoPublishPass = candidate.auto_publish === false;
  checks.push({ name: "auto_publish_disabled", pass: autoPublishPass });
  if (!autoPublishPass) {
    errors.push("auto_publish must be false");
  }

  const mappingPass = CATEGORY_TARGET_LAYERS[candidate.category] === candidate.target_layer;
  checks.push({ name: "target_layer_mapping", pass: mappingPass });
  if (!mappingPass) {
    errors.push("target_layer does not match category mapping");
  }

  if (!options.skipUrlCheck && urlFormatPass) {
    const status = await fetchStatus(candidate.source_url);
    const urlLivePass = status >= 200 && status < 400;
    checks.push({ name: "source_url_live", pass: urlLivePass, httpStatus: status });
    if (!urlLivePass) {
      errors.push("source_url not HTTP 200 (" + status + ")");
    }
  }

  const gateStatus = errors.length ? "FAIL" : "PASS";

  return {
    update_id: candidate.update_id,
    gate_status: gateStatus,
    validated_at: validatedAt,
    checks: checks,
    errors: errors,
    candidate: candidate
  };
}

function buildGateBatch(results, options) {
  options = options || {};
  const passedUpdates = [];
  const failedUpdates = [];

  (results || []).forEach(function (result) {
    if (result.gate_status === "PASS") {
      passedUpdates.push(result.candidate);
    } else {
      failedUpdates.push({
        update_id: result.update_id,
        gate_status: result.gate_status,
        errors: result.errors,
        candidate: result.candidate
      });
    }
  });

  return {
    version: 1,
    generatedAt: options.generatedAt || new Date().toISOString(),
    incidentScope: INCIDENT_SCOPE,
    autoPublish: false,
    sourcePublicUpdateQueueFile:
      options.sourcePublicUpdateQueueFile || toRepoRelative(PUBLIC_UPDATE_QUEUE_FILE),
    gateSummary: summarizeGateResults(results || []),
    categorySummary: summarizeByCategory(passedUpdates),
    results: results || [],
    passedUpdates: passedUpdates,
    failedUpdates: failedUpdates
  };
}

function writeGateBatch(batch, options) {
  options = options || {};
  ensureDir(GATE_OUTPUT_DIR);

  const errors = validateGateBatch(batch);
  if (errors.length) {
    return { saved: false, errors: errors, batch: batch };
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputPath = path.join(
    GATE_OUTPUT_DIR,
    options.fileName || "public-update-gate-" + stamp + ".json"
  );

  fs.writeFileSync(outputPath, JSON.stringify(batch, null, 2) + "\n", "utf8");
  return {
    saved: true,
    outputPath: outputPath,
    batch: batch,
    errors: []
  };
}

async function runPublicUpdateValidationGate(options) {
  options = options || {};
  const inputPath = options.inputPath || PUBLIC_UPDATE_QUEUE_FILE;

  if (!fs.existsSync(inputPath)) {
    return {
      saved: false,
      reason: "public update queue not found",
      results: [],
      passedUpdates: [],
      failedUpdates: []
    };
  }

  const queueBatch = readJson(inputPath, { updates: [] });
  const batchErrors = [];

  if (queueBatch.autoPublish !== false) {
    batchErrors.push("input autoPublish must be false");
  }

  if (queueBatch.incidentScope && queueBatch.incidentScope !== INCIDENT_SCOPE) {
    batchErrors.push("input incidentScope must be " + INCIDENT_SCOPE);
  }

  if (batchErrors.length) {
    return {
      saved: false,
      inputPath: inputPath,
      errors: batchErrors,
      results: [],
      passedUpdates: [],
      failedUpdates: []
    };
  }

  const validatedAt = options.validatedAt || new Date().toISOString();
  const updates = queueBatch.updates || [];
  const results = [];

  for (let i = 0; i < updates.length; i += 1) {
    const result = await runCandidateGateChecks(updates[i], {
      validatedAt: validatedAt,
      skipUrlCheck: options.skipUrlCheck === true
    });
    results.push(result);
  }

  const gateBatch = buildGateBatch(results, {
    generatedAt: validatedAt,
    sourcePublicUpdateQueueFile: toRepoRelative(inputPath)
  });

  const gateErrors = validateGateBatch(gateBatch);
  if (gateErrors.length) {
    return {
      saved: false,
      inputPath: inputPath,
      errors: gateErrors,
      results: results,
      passedUpdates: gateBatch.passedUpdates,
      failedUpdates: gateBatch.failedUpdates
    };
  }

  if (!options.dryRun) {
    ensureDir(GATE_OUTPUT_DIR);
    fs.writeFileSync(MASTER_GATE_FILE, JSON.stringify(gateBatch, null, 2) + "\n", "utf8");

    const runWrite = writeGateBatch(gateBatch, {
      fileName: options.fileName
    });

    return {
      saved: true,
      dryRun: false,
      inputPath: inputPath,
      masterOutputPath: MASTER_GATE_FILE,
      runOutputPath: runWrite.outputPath,
      updateCount: updates.length,
      gateSummary: gateBatch.gateSummary,
      categorySummary: gateBatch.categorySummary,
      passedUpdates: gateBatch.passedUpdates,
      failedUpdates: gateBatch.failedUpdates,
      results: results,
      errors: []
    };
  }

  return {
    saved: false,
    dryRun: true,
    inputPath: inputPath,
    updateCount: updates.length,
    gateSummary: gateBatch.gateSummary,
    categorySummary: gateBatch.categorySummary,
    passedUpdates: gateBatch.passedUpdates,
    failedUpdates: gateBatch.failedUpdates,
    results: results,
    errors: []
  };
}

module.exports = {
  INCIDENT_SCOPE,
  GATE_STATUSES,
  PUBLIC_UPDATE_QUEUE_FILE,
  GATE_OUTPUT_DIR,
  MASTER_GATE_FILE,
  isValidUrlFormat,
  collectContaminationErrors,
  validateGateResultShape,
  validateGateBatch,
  runCandidateGateChecks,
  buildGateBatch,
  writeGateBatch,
  runPublicUpdateValidationGate
};
