"use strict";

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const APPROVED_DIR = path.join(ROOT, "data", "approved");
const PUBLIC_UPDATES = path.join(ROOT, "data", "public", "phase1_updates.json");
const PUBLIC_COMM = path.join(ROOT, "data", "public", "communication_status.json");
const PUBLIC_LOCATIONS = path.join(ROOT, "data", "public", "disaster_locations.json");
const PUBLIC_INFRASTRUCTURE = path.join(ROOT, "data", "public", "infrastructure_status.json");

const ALLOWED_LOCATION_UPDATE_FIELDS = new Set([
  "status",
  "status_label",
  "operation_date",
  "last_checked_at",
  "verified_at",
  "expires_at",
  "ended_at",
  "notes",
  "name",
  "address",
  "category_label",
  "related_card_url",
  "source_url"
]);

const ALLOWED_INFRASTRUCTURE_UPDATE_FIELDS = new Set([
  "title",
  "description",
  "status",
  "type",
  "original_text",
  "source_updated_at",
  "last_checked_at",
  "provider",
  "area_id",
  "category",
  "source_id"
]);

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

function findLocationRecord(locationsData, locationId) {
  return (locationsData.locations || []).find((location) => location.location_id === locationId);
}

function applyLocationFields(location, fields) {
  if (!fields) {
    return;
  }

  Object.keys(fields).forEach((key) => {
    if (!ALLOWED_LOCATION_UPDATE_FIELDS.has(key)) {
      throw new Error("disallowed field: " + key);
    }
    location[key] = fields[key];
  });
}

function findInfrastructureItem(infrastructureData, statusId) {
  return (infrastructureData.items || []).find((item) => item.status_id === statusId);
}

function applyInfrastructureFields(item, fields) {
  if (!fields) {
    return;
  }

  Object.keys(fields).forEach((key) => {
    if (!ALLOWED_INFRASTRUCTURE_UPDATE_FIELDS.has(key)) {
      throw new Error("disallowed field: " + key);
    }
    item[key] = fields[key];
  });
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
  const locationsData = JSON.parse(fs.readFileSync(PUBLIC_LOCATIONS, "utf8"));
  const infrastructureData = JSON.parse(fs.readFileSync(PUBLIC_INFRASTRUCTURE, "utf8"));
  const urlSet = new Set(updates.map((record) => record.source_url));
  let locationsModified = false;
  let infrastructureModified = false;

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
        const action = candidate.publicUpdate.action || "update";

        if (action === "delete") {
          validationErrors.push(candidate.id + ": phase1_updates delete is not allowed");
          continue;
        }

        if (action === "create") {
          const fields = candidate.publicUpdate.fields || {};
          if (!fields.original_text) {
            validationErrors.push(candidate.id + ": original_text required for emergency create");
            continue;
          }

          const newRecord = {
            area_id: candidate.areaId,
            area_name: candidate.municipality,
            public_category_id: fields.public_category_id || candidate.publicCategoryId || "EMERGENCY",
            public_category_label: fields.public_category_label || "地震・緊急情報",
            headline: fields.headline || fields.original_text.slice(0, 80),
            summary: fields.summary || fields.original_text,
            original_text: fields.original_text,
            published_at: fields.published_at || null,
            displayed_updated_at:
              fields.displayed_updated_at || fields.published_at || new Date().toISOString(),
            source_name: fields.source_name || candidate.municipality,
            source_url: candidate.url,
            department: fields.department || fields.source_name || candidate.municipality,
            verification_status: "VERIFIED",
            incident_scope: INCIDENT_SCOPE,
            collected_at: fields.collected_at || new Date().toISOString(),
            update_type: "EMERGENCY_INFO",
            emergency_source_id: fields.emergency_source_id || candidate.emergency_source_id || null,
            display_priority: fields.display_priority || 1
          };

          updates.push(newRecord);
          urlSet.add(candidate.url);
          continue;
        }

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

      if (candidate.publicUpdate.target === "disaster_locations") {
        const action = candidate.publicUpdate.action || "update";
        const locationId = candidate.publicUpdate.location_id;

        if (!locationId) {
          validationErrors.push(candidate.id + ": location_id missing for disaster_locations");
          continue;
        }

        const location = findLocationRecord(locationsData, locationId);
        if (!location && action !== "create") {
          validationErrors.push(candidate.id + ": no matching disaster location for " + locationId);
          continue;
        }

        try {
          if (action === "update") {
            applyLocationFields(location, candidate.publicUpdate.fields);
            location.last_checked_at = location.last_checked_at || new Date().toISOString();
          } else if (action === "end") {
            applyLocationFields(location, candidate.publicUpdate.fields);
            location.status = "ENDED";
            if (!location.ended_at) {
              location.ended_at = new Date().toISOString();
            }
            location.last_checked_at = location.last_checked_at || location.ended_at;
          } else if (action === "create") {
            validationErrors.push(candidate.id + ": disaster_locations create is not enabled in Phase24D");
            continue;
          } else {
            validationErrors.push(candidate.id + ": unsupported disaster_locations action " + action);
            continue;
          }
        } catch (err) {
          validationErrors.push(candidate.id + ": " + err.message);
          continue;
        }

        locationsData.confirmed_at = new Date().toISOString();
        locationsModified = true;
      }

      if (candidate.publicUpdate.target === "infrastructure_status") {
        const action = candidate.publicUpdate.action || "update";
        const statusId = candidate.publicUpdate.status_id;
        const applyAt = new Date().toISOString();

        if (action === "delete") {
          validationErrors.push(candidate.id + ": infrastructure_status delete is not allowed");
          continue;
        }

        if (action === "create") {
          const fields = candidate.publicUpdate.fields || {};
          if (!fields.title || !fields.status || !fields.category) {
            validationErrors.push(candidate.id + ": infrastructure create requires title, status, category");
            continue;
          }

          const newStatusId = candidate.publicUpdate.status_id || fields.status_id;
          if (!newStatusId) {
            validationErrors.push(candidate.id + ": status_id missing for infrastructure create");
            continue;
          }

          if (findInfrastructureItem(infrastructureData, newStatusId)) {
            validationErrors.push(candidate.id + ": duplicate infrastructure status_id " + newStatusId);
            continue;
          }

          const newItem = {
            status_id: newStatusId,
            area_id: fields.area_id || candidate.areaId,
            category: fields.category,
            type: fields.type || "STATUS",
            title: fields.title,
            description: fields.description || "",
            status: fields.status,
            source_id: fields.source_id || candidate.infrastructure_source_id || candidate.source,
            original_text: fields.original_text || null,
            last_checked_at: fields.last_checked_at || applyAt,
            source_updated_at: fields.source_updated_at || null
          };

          if (fields.provider) {
            newItem.provider = fields.provider;
          }

          infrastructureData.items.push(newItem);
          infrastructureModified = true;
          continue;
        }

        if (!statusId) {
          validationErrors.push(candidate.id + ": status_id missing for infrastructure_status");
          continue;
        }

        const item = findInfrastructureItem(infrastructureData, statusId);
        if (!item) {
          validationErrors.push(candidate.id + ": no matching infrastructure status for " + statusId);
          continue;
        }

        if (candidate.areaId && item.area_id !== candidate.areaId) {
          validationErrors.push(candidate.id + ": infrastructure area_id mismatch");
          continue;
        }

        try {
          if (action === "update") {
            applyInfrastructureFields(item, candidate.publicUpdate.fields);
            item.last_checked_at = applyAt;
            if (candidate.publicUpdate.fields && candidate.publicUpdate.fields.source_updated_at) {
              item.source_updated_at = candidate.publicUpdate.fields.source_updated_at;
            }
          } else if (action === "end") {
            applyInfrastructureFields(item, candidate.publicUpdate.fields);
            if (candidate.publicUpdate.fields && candidate.publicUpdate.fields.status) {
              item.status = candidate.publicUpdate.fields.status;
            }
            item.last_checked_at = applyAt;
            if (candidate.publicUpdate.fields && candidate.publicUpdate.fields.source_updated_at) {
              item.source_updated_at = candidate.publicUpdate.fields.source_updated_at;
            }
          } else {
            validationErrors.push(candidate.id + ": unsupported infrastructure_status action " + action);
            continue;
          }
        } catch (err) {
          validationErrors.push(candidate.id + ": " + err.message);
          continue;
        }

        infrastructureData.confirmed_at = applyAt;
        infrastructureModified = true;
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
  if (locationsModified) {
    fs.writeFileSync(PUBLIC_LOCATIONS, JSON.stringify(locationsData, null, 2) + "\n", "utf8");
  }
  if (infrastructureModified) {
    fs.writeFileSync(PUBLIC_INFRASTRUCTURE, JSON.stringify(infrastructureData, null, 2) + "\n", "utf8");
  }

  return {
    applied: true,
    approvedCount: previews.length,
    previewCount: previews.length,
    previews
  };
}

module.exports = {
  APPROVED_DIR,
  PUBLIC_LOCATIONS,
  PUBLIC_INFRASTRUCTURE,
  loadApprovedFiles,
  validateApprovedCandidate,
  applyApproved,
  buildPreview,
  findLocationRecord,
  applyLocationFields,
  findInfrastructureItem,
  applyInfrastructureFields
};
