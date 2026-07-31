"use strict";

const BLOCKED_HOST_SUFFIXES = ["example.local", "localhost"];
const BLOCKED_HOST_INCLUDES = ["dummy", "test"];

function parseExternalUrl(value) {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) {
    return null;
  }
  try {
    return new URL(raw);
  } catch (err) {
    return null;
  }
}

function isBlockedExternalHostname(hostname) {
  const host = String(hostname || "").toLowerCase();
  if (!host) {
    return true;
  }
  for (let i = 0; i < BLOCKED_HOST_SUFFIXES.length; i += 1) {
    const suffix = BLOCKED_HOST_SUFFIXES[i];
    if (host === suffix || host.endsWith("." + suffix)) {
      return true;
    }
  }
  for (let j = 0; j < BLOCKED_HOST_INCLUDES.length; j += 1) {
    const token = BLOCKED_HOST_INCLUDES[j];
    if (
      host === token ||
      host.indexOf("." + token + ".") !== -1 ||
      host.startsWith(token + ".") ||
      host.endsWith("." + token)
    ) {
      return true;
    }
  }
  return false;
}

function isBlockedExternalUrl(value) {
  const parsed = parseExternalUrl(value);
  if (!parsed) {
    return true;
  }
  if (isBlockedExternalHostname(parsed.hostname)) {
    return true;
  }
  if (parsed.hostname === "x.com" && /^\/example(\/|$)/i.test(parsed.pathname)) {
    return true;
  }
  return false;
}

function resolveExternalUrl(value) {
  const parsed = parseExternalUrl(value);
  if (!parsed || isBlockedExternalUrl(parsed.href)) {
    return "";
  }
  return parsed.href;
}

function resolveSocialEntryUrl(item) {
  if (!item) {
    return "";
  }
  return (
    resolveExternalUrl(item.url) ||
    resolveExternalUrl(item.post_url) ||
    resolveExternalUrl(item.source_url) ||
    resolveExternalUrl(item.link)
  );
}

function isXPostUrl(value) {
  const resolved = resolveExternalUrl(value);
  if (!resolved) {
    return false;
  }
  try {
    const parsed = new URL(resolved);
    const host = parsed.hostname.toLowerCase();
    return (host === "x.com" || host === "www.x.com" || host === "twitter.com" || host === "www.twitter.com") &&
      /\/status\/\d+/i.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

function isInstagramPostUrl(value) {
  const resolved = resolveExternalUrl(value);
  if (!resolved) {
    return false;
  }
  try {
    const parsed = new URL(resolved);
    const host = parsed.hostname.toLowerCase();
    if (host !== "instagram.com" && host !== "www.instagram.com") {
      return false;
    }
    return /^\/(p|reel|reels|tv)\//i.test(parsed.pathname);
  } catch (err) {
    return false;
  }
}

function resolveSnsPostUrlFromFeedPost(post, platform) {
  const normalizedPlatform = String(platform || "").trim();
  const candidates = [];
  if (normalizedPlatform === "Instagram") {
    candidates.push(post.postUrl, post.permalink, post.reel_url, post.reelUrl, post.url);
  } else if (normalizedPlatform === "X") {
    candidates.push(post.postUrl);
  } else {
    candidates.push(post.postUrl, post.url, post.permalink);
  }
  for (let i = 0; i < candidates.length; i += 1) {
    const candidate = candidates[i];
    if (!candidate) {
      continue;
    }
    if (normalizedPlatform === "X" && isXPostUrl(candidate)) {
      return resolveExternalUrl(candidate);
    }
    if (normalizedPlatform === "Instagram" && isInstagramPostUrl(candidate)) {
      return resolveExternalUrl(candidate);
    }
    if (!normalizedPlatform) {
      const resolved = resolveExternalUrl(candidate);
      if (resolved) {
        return resolved;
      }
    }
  }
  return "";
}

function sanitizeExternalUrl(value) {
  return resolveExternalUrl(value);
}

function sanitizeUrlField(record) {
  if (!record || typeof record !== "object") {
    return record;
  }
  ["url", "source_url", "link"].forEach(function (field) {
    if (typeof record[field] === "string") {
      record[field] = sanitizeExternalUrl(record[field]);
    }
  });
  return record;
}

function sanitizeSocialJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sanitizeSocialJsonValue);
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && /^https?:\/\//i.test(value)) {
      return sanitizeExternalUrl(value);
    }
    return value;
  }

  const next = {};
  Object.keys(value).forEach(function (key) {
    let child = value[key];
    if (key === "dedupe_key" && typeof child === "string" && child.indexOf("url:") === 0) {
      const raw = child.slice(4);
      const sanitized = sanitizeExternalUrl(raw);
      next[key] = sanitized ? "url:" + sanitized : "url:";
      return;
    }
    next[key] = sanitizeSocialJsonValue(child);
  });
  sanitizeUrlField(next);
  return next;
}

function auditSocialUrlFields(indexPayload, sourcesPayload) {
  const entries = (indexPayload && indexPayload.entries) || [];
  const sources = (sourcesPayload && sourcesPayload.sources) || [];
  const entryAudit = {
    total: entries.length,
    url_empty: 0,
    url_publishable: 0,
    url_blocked: 0,
    source_url_present: 0,
    link_present: 0,
    resolved_link_count: 0,
    blocked_samples: [],
    publishable_samples: []
  };

  entries.forEach(function (entry) {
    const rawUrl = String(entry.url || "").trim();
    if (!rawUrl) {
      entryAudit.url_empty += 1;
    } else if (resolveExternalUrl(rawUrl)) {
      entryAudit.url_publishable += 1;
      if (entryAudit.publishable_samples.length < 5) {
        entryAudit.publishable_samples.push({
          id: entry.id,
          title: entry.title,
          url: rawUrl
        });
      }
    } else {
      entryAudit.url_blocked += 1;
      if (entryAudit.blocked_samples.length < 5) {
        entryAudit.blocked_samples.push({
          id: entry.id,
          title: entry.title,
          url: rawUrl
        });
      }
    }
    if (entry.source_url) {
      entryAudit.source_url_present += 1;
    }
    if (entry.link) {
      entryAudit.link_present += 1;
    }
    if (resolveSocialEntryUrl(entry)) {
      entryAudit.resolved_link_count += 1;
    }
  });

  const sourceAudit = {
    total: sources.length,
    url_empty: 0,
    url_publishable: 0,
    url_blocked: 0,
    samples: sources.slice(0, 5).map(function (source) {
      return {
        source_id: source.source_id,
        name: source.name,
        url: source.url || ""
      };
    })
  };

  sources.forEach(function (source) {
    const rawUrl = String(source.url || "").trim();
    if (!rawUrl) {
      sourceAudit.url_empty += 1;
    } else if (resolveExternalUrl(rawUrl)) {
      sourceAudit.url_publishable += 1;
    } else {
      sourceAudit.url_blocked += 1;
    }
  });

  return {
    index_entries: entryAudit,
    sources: sourceAudit
  };
}

function containsBlockedPublicUrl(value) {
  if (typeof value === "string") {
    if (/example\.local/i.test(value)) {
      return true;
    }
    if (/^https?:\/\//i.test(value)) {
      return isBlockedExternalUrl(value);
    }
    return false;
  }
  if (Array.isArray(value)) {
    return value.some(containsBlockedPublicUrl);
  }
  if (value && typeof value === "object") {
    return Object.keys(value).some(function (key) {
      return containsBlockedPublicUrl(value[key]);
    });
  }
  return false;
}

module.exports = {
  BLOCKED_HOST_SUFFIXES,
  BLOCKED_HOST_INCLUDES,
  parseExternalUrl,
  isBlockedExternalHostname,
  isBlockedExternalUrl,
  resolveExternalUrl,
  resolveSocialEntryUrl,
  isXPostUrl,
  isInstagramPostUrl,
  resolveSnsPostUrlFromFeedPost,
  sanitizeExternalUrl,
  sanitizeUrlField,
  sanitizeSocialJsonValue,
  auditSocialUrlFields,
  containsBlockedPublicUrl
};
