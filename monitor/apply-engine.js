"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const APPROVED_DIR = path.join(ROOT, "data", "approved");
const PUBLIC_UPDATES = path.join(ROOT, "data", "public", "phase1_updates.json");
const PUBLIC_COMM = path.join(ROOT, "data", "public", "communication_status.json");

const CONTAMINATION_PATTERNS = [/2016/, /平成28/, /H28/, /平成２８/];
const INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";

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
        headers: { "User-Agent": "kumamoto-disaster-portal-apply/1.0" }
      },
      (res) => {
        const status = res.statusCode || 0;
        const location = res.headers.location;

        if (
          [301, 302, 303, 307, 308].includes(status) &&
          location &&
          redirectCount < 5
        ) {
          res.resume();
          resolve(fetchStatus(new URL(location, url).href, redirectCount + 1));
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

function loadApprovedFiles() {
  if (!fs.existsSync(APPROVED_DIR)) {
    return [];
  }

  return fs
    .readdirSync(APPROVED_DIR)
    .filter((name) => name.endsWith(".json") && !name.startsWith("_"))
    .map((name) => JSON.parse(fs.readFileSync(path.join(APPROVED_DIR, name), "utf8")));
}

function validateApprovedCandidate(candidate) {
  const errors = [];

  if (candidate.reviewStatus !== "APPROVED") {
    errors.push(candidate.id + ": reviewStatus must be APPROVED");
  }

  if (!candidate.url) {
    errors.push(candidate.id + ": url missing");
  }

  if (candidate.incidentScope && candidate.incidentScope !== INCIDENT_SCOPE) {
    errors.push(candidate.id + ": incident scope mismatch");
  }

  const text = JSON.stringify(candidate);
  if (CONTAMINATION_PATTERNS.some((pattern) => pattern.test(text))) {
    errors.push(candidate.id + ": possible 2016 contamination");
  }

  if (!candidate.publicUpdate || !candidate.publicUpdate.target) {
    errors.push(candidate.id + ": publicUpdate.target missing");
  }

  return errors;
}

async function runSafetyChecks(candidate) {
  const errors = [];
  const status = await fetchStatus(candidate.url);

  if (status < 200 || status >= 400) {
    errors.push(candidate.id + ": URL not HTTP 200 (" + status + ")");
  }

  return errors;
}

function findUpdateRecord(updates, candidate) {
  return updates.find((record) => record.source_url === candidate.url);
}

function findCommunicationTarget(comm, candidate) {
  const providers = comm.providers || [];
  const services = comm.services || [];
  const provider = providers.find((item) => item.source_url === candidate.url);
  const service = services.find((item) => item.source_url === candidate.url);
  return { provider, service };
}

function buildPreview(approvedFiles) {
  const previews = [];

  approvedFiles.forEach((file) => {
    (file.candidates || []).forEach((candidate) => {
      previews.push({
        id: candidate.id,
        municipality: candidate.municipality,
        url: candidate.url,
        target: candidate.publicUpdate.target,
        action: candidate.publicUpdate.action || "update"
      });
    });
  });

  return previews;
}

async function applyApproved(options) {
  const approvedFiles = loadApprovedFiles();
  const apply = options && options.apply === true;
  const validationErrors = [];
  const safetyErrors = [];
  const previews = [];

  if (!approvedFiles.length) {
    return {
      applied: false,
      approvedCount: 0,
      previewCount: 0,
      message: "No approved files found in data/approved/"
    };
  }

  const updates = JSON.parse(fs.readFileSync(PUBLIC_UPDATES, "utf8"));
  const comm = JSON.parse(fs.readFileSync(PUBLIC_COMM, "utf8"));
  const urlSet = new Set(updates.map((record) => record.source_url));

  for (const file of approvedFiles) {
    for (const candidate of file.candidates || []) {
      validationErrors.push(...validateApprovedCandidate(candidate));
      safetyErrors.push(...(await runSafetyChecks(candidate)));

      const preview = {
        id: candidate.id,
        municipality: candidate.municipality,
        url: candidate.url,
        target: candidate.publicUpdate.target,
        action: candidate.publicUpdate.action || "update"
      };
      previews.push(preview);

      if (!apply) {
        continue;
      }

      if (candidate.publicUpdate.target === "phase1_updates") {
        const record = findUpdateRecord(updates, candidate);
        if (!record) {
          validationErrors.push(candidate.id + ": no matching public record for URL");
          continue;
        }

        if (candidate.areaId && record.area_id !== candidate.areaId) {
          validationErrors.push(candidate.id + ": area_id mismatch");
          continue;
        }

        if (candidate.publicUpdate.fields) {
          Object.keys(candidate.publicUpdate.fields).forEach((key) => {
            record[key] = candidate.publicUpdate.fields[key];
          });
        }

        if (candidate.after && candidate.after.title) {
          record.headline = candidate.after.title;
        }

        record.collected_at = new Date().toISOString();
      }

      if (candidate.publicUpdate.target === "communication_status") {
        const match = findCommunicationTarget(comm, candidate);
        const item = match.provider || match.service;
        if (!item) {
          validationErrors.push(candidate.id + ": no matching communication record for URL");
          continue;
        }

        if (candidate.publicUpdate.fields) {
          Object.keys(candidate.publicUpdate.fields).forEach((key) => {
            item[key] = candidate.publicUpdate.fields[key];
          });
        }

        comm.confirmed_at = new Date().toISOString();
      }
    }
  }

  previews.forEach((preview) => {
    if (preview.action === "add" && urlSet.has(preview.url)) {
      validationErrors.push(preview.id + ": duplicate URL on add action");
    }
  });

  const allErrors = validationErrors.concat(safetyErrors);
  if (allErrors.length) {
    return {
      applied: false,
      approvedCount: previews.length,
      previewCount: previews.length,
      errors: allErrors,
      previews
    };
  }

  if (!apply) {
    return {
      applied: false,
      approvedCount: previews.length,
      previewCount: previews.length,
      dryRun: true,
      previews
    };
  }

  fs.writeFileSync(PUBLIC_UPDATES, JSON.stringify(updates, null, 2) + "\n", "utf8");
  fs.writeFileSync(PUBLIC_COMM, JSON.stringify(comm, null, 2) + "\n", "utf8");

  return {
    applied: true,
    approvedCount: previews.length,
    previewCount: previews.length,
    previews
  };
}

module.exports = {
  APPROVED_DIR,
  loadApprovedFiles,
  validateApprovedCandidate,
  applyApproved,
  buildPreview
};
