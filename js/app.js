(function () {
  "use strict";

  var DATA_BASE = "./data/public/";
  var VERIFIED_STATUS = "VERIFIED";
  var INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
  var MAX_LATEST = 4;
  var LOAD_ERROR_MESSAGE = "情報を読み込めませんでした。自治体公式サイトの情報をご確認ください。";

  var CATEGORY_ORDER = [
    { id: "EMERGENCY", anchor: "cat-emergency" },
    { id: "SHELTER", anchor: "cat-shelter" },
    { id: "WATER", anchor: "cat-water" },
    { id: "SUPPORT", anchor: "cat-support" }
  ];

  var AREA_DISPLAY_RULES = {
    KM000: {
      allowed: ["EMERGENCY", "IMPACT", "ROAD", "LIFELINE", "SUPPORT"],
      blocked: ["SHELTER", "WATER", "CERTIFICATE"]
    },
    KM001: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "LIFELINE", "CERTIFICATE", "SUPPORT"],
      blocked: ["ROAD"]
    },
    KM002: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "CERTIFICATE", "IMPACT"],
      blocked: ["ROAD", "LIFELINE"],
      blockedHeadlines: ["宇土市の被害状況"]
    },
    KM003: {
      allowed: ["EMERGENCY", "SHELTER", "WATER"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "SUPPORT"]
    },
    KM004: {
      allowed: [],
      requireDirectVerification: true
    }
  };

  var EXCLUDED_STATUSES = [
    "REQUIRES_MANUAL_REVIEW",
    "NOT_FOUND",
    "NOT_APPLICABLE",
    "ARCHIVED",
    "SUPERSEDED",
    "ACCESS_ERROR",
    "VERIFIED_NO_CURRENT_INFORMATION"
  ];

  function loadJson(filename) {
    return fetch(DATA_BASE + filename).then(function (response) {
      if (!response.ok) {
        throw new Error("Failed to load " + filename);
      }
      return response.json();
    });
  }

  function isPublicRecord(record) {
    if (!record || record.verification_status !== VERIFIED_STATUS) {
      return false;
    }
    if (record.incident_scope !== INCIDENT_SCOPE) {
      return false;
    }
    if (!record.source_url || !record.headline) {
      return false;
    }
    if (EXCLUDED_STATUSES.indexOf(record.verification_status) !== -1) {
      return false;
    }
    return true;
  }

  function isAllowedForArea(record) {
    var rules = AREA_DISPLAY_RULES[record.area_id];
    if (!rules) {
      return false;
    }
    if (rules.blockedHeadlines && rules.blockedHeadlines.indexOf(record.headline) !== -1) {
      return false;
    }
    if (rules.requireDirectVerification) {
      return false;
    }
    if (rules.allowed.length === 0) {
      return false;
    }
    if (rules.blocked.indexOf(record.public_category_id) !== -1) {
      return false;
    }
    return rules.allowed.indexOf(record.public_category_id) !== -1;
  }

  function parseDate(value) {
    if (!value) {
      return null;
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function formatDateTime(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return y + "年" + m + "月" + d + "日 " + h + ":" + min;
  }

  function getLatestCollectedAt(records) {
    var latestValue = "";
    var latestDate = null;
    records.forEach(function (record) {
      var date = parseDate(record.collected_at);
      if (date && (!latestDate || date > latestDate)) {
        latestDate = date;
        latestValue = record.collected_at;
      }
    });
    return formatDateTime(latestValue);
  }

  function extractDomain(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return url;
    }
  }

  function compareByDateDesc(a, b) {
    var dateA = parseDate(a.displayed_updated_at);
    var dateB = parseDate(b.displayed_updated_at);
    if (dateA && dateB) {
      return dateB - dateA;
    }
    if (dateA) {
      return -1;
    }
    if (dateB) {
      return 1;
    }
    return (a.display_priority || 0) - (b.display_priority || 0);
  }

  function getCategoryOrderIndex(categoryId) {
    for (var i = 0; i < CATEGORY_ORDER.length; i++) {
      if (CATEGORY_ORDER[i].id === categoryId) {
        return i;
      }
    }
    return 999;
  }

  function compareByCategoryThenDate(a, b) {
    var catA = getCategoryOrderIndex(a.public_category_id);
    var catB = getCategoryOrderIndex(b.public_category_id);
    if (catA !== catB) {
      return catA - catB;
    }
    return compareByDateDesc(a, b);
  }

  function getActiveCategories(records) {
    var seen = {};
    records.forEach(function (record) {
      seen[record.public_category_id] = record.public_category_label;
    });
    return CATEGORY_ORDER.filter(function (cat) {
      return seen[cat.id];
    }).map(function (cat) {
      return { id: cat.id, anchor: cat.anchor, label: seen[cat.id] };
    });
  }

  function createElement(tag, className, text) {
    var el = document.createElement(tag);
    if (className) {
      el.className = className;
    }
    if (text !== undefined) {
      el.textContent = text;
    }
    return el;
  }

  function renderEmergencyNotice(container) {
    var section = createElement("section", "emergency-notice");
    section.setAttribute("role", "alert");
    section.setAttribute("aria-label", "緊急時の注意");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("p", "emergency-notice__text", "緊急時は、自治体・警察・消防などの指示を優先してください。"));
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderPageHeader(container, areas, lastVerified) {
    var header = createElement("header", "page-header");
    var inner = createElement("div", "container");

    var title = createElement("h1", "page-header__title");
    title.innerHTML = "令和8年熊本地震<br>自治体公式情報まとめ";
    inner.appendChild(title);

    inner.appendChild(createElement("p", "page-header__subtitle", "熊本県・熊本市・宇土市・宇城市・美里町の公式情報へリンクします。"));

    if (lastVerified) {
      var verified = createElement("p", "page-header__verified");
      verified.appendChild(createElement("span", "page-header__verified-label", "最終確認："));
      verified.appendChild(document.createTextNode(lastVerified));
      inner.appendChild(verified);
    }

    header.appendChild(inner);
    container.appendChild(header);
  }

  function renderPageNavigation(container, navigation, records) {
    var wrap = createElement("div", "page-nav");

    var muniNav = createElement("nav", "municipality-nav");
    muniNav.setAttribute("aria-label", "自治体から探す");

    var muniInner = createElement("div", "container");
    muniInner.appendChild(createElement("p", "page-nav__label", "自治体から探す"));

    var muniScroll = createElement("div", "municipality-nav__scroll");
    var muniList = createElement("ul", "municipality-nav__list");

    navigation.forEach(function (item, index) {
      if (index > 0) {
        var sep = createElement("li", "municipality-nav__separator");
        sep.setAttribute("aria-hidden", "true");
        sep.textContent = "｜";
        muniList.appendChild(sep);
      }

      var li = createElement("li", "municipality-nav__item");
      var link = createElement("a", "municipality-nav__link", item.name);
      link.href = "#" + item.anchor;
      link.setAttribute("aria-label", item.name + "の情報へ移動");
      li.appendChild(link);
      muniList.appendChild(li);
    });

    muniScroll.appendChild(muniList);
    muniInner.appendChild(muniScroll);
    muniNav.appendChild(muniInner);
    wrap.appendChild(muniNav);

    var categories = getActiveCategories(records);
    if (categories.length > 0) {
      var catNav = createElement("nav", "category-nav");
      catNav.setAttribute("aria-label", "情報の種類から探す");

      var catInner = createElement("div", "container");
      catInner.appendChild(createElement("p", "page-nav__label", "情報の種類から探す"));

      var catScroll = createElement("div", "category-nav__scroll");
      var catList = createElement("ul", "category-nav__list");

      categories.forEach(function (cat, index) {
        if (index > 0) {
          var catSep = createElement("li", "category-nav__separator");
          catSep.setAttribute("aria-hidden", "true");
          catSep.textContent = "｜";
          catList.appendChild(catSep);
        }

        var catLi = createElement("li", "category-nav__item");
        var catLink = createElement("a", "category-nav__link", cat.label);
        catLink.href = "#" + cat.anchor;
        catLink.setAttribute("aria-label", cat.label + "の情報へ移動");
        catLi.appendChild(catLink);
        catList.appendChild(catLi);
      });

      catScroll.appendChild(catList);
      catInner.appendChild(catScroll);
      catNav.appendChild(catInner);
      wrap.appendChild(catNav);
    }

    container.appendChild(wrap);
  }

  function renderLatestUpdates(container, records) {
    var section = createElement("section", "latest-updates");
    section.setAttribute("aria-labelledby", "latest-updates-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title latest-updates__title", "直近の更新"));
    inner.querySelector(".latest-updates__title").id = "latest-updates-title";
    inner.appendChild(createElement("p", "latest-updates__lead", "直近の更新4件です。上の自治体別・カテゴリ別一覧とあわせてご確認ください。"));

    var sorted = records.slice().sort(compareByDateDesc).slice(0, MAX_LATEST);
    var list = createElement("ul", "latest-updates__list");

    sorted.forEach(function (record) {
      var li = createElement("li", "latest-updates__item");
      var meta = createElement("div", "latest-updates__meta");

      var datetime = formatDateTime(record.displayed_updated_at);
      if (datetime) {
        meta.appendChild(createElement("time", "latest-updates__datetime", datetime));
      }
      meta.appendChild(createElement("span", "latest-updates__area", record.area_name));
      meta.appendChild(createElement("span", "latest-updates__category", record.public_category_label));

      li.appendChild(meta);
      li.appendChild(createElement("p", "latest-updates__headline", record.headline));

      var link = createElement("a", "latest-updates__link", "発表元の公式ページへ");
      link.href = record.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", record.headline + "の発表元公式ページへ（外部リンク）");
      li.appendChild(link);

      list.appendChild(li);
    });

    inner.appendChild(list);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderOfficialInfoCard(record) {
    var card = createElement("article", "official-info-card");
    card.appendChild(createElement("p", "official-info-card__category", record.public_category_label));
    card.appendChild(createElement("h3", "official-info-card__headline", record.headline));

    if (record.summary) {
      card.appendChild(createElement("p", "official-info-card__summary", record.summary));
    }

    var meta = createElement("dl", "official-info-card__meta");
    var updated = formatDateTime(record.displayed_updated_at);
    if (updated) {
      meta.appendChild(createElement("dt", null, "更新："));
      meta.appendChild(createElement("dd", null, updated));
    }

    var sourceLabel = record.department || record.source_name || record.area_name;
    if (sourceLabel) {
      meta.appendChild(createElement("dt", null, "発表："));
      meta.appendChild(createElement("dd", null, sourceLabel));
    }
    card.appendChild(meta);

    var actions = createElement("div", "official-info-card__actions");
    var link = createElement("a", "official-info-card__link", "発表元の公式ページへ");
    link.href = record.source_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", record.headline + "の発表元公式ページへ（外部リンク）");
    actions.appendChild(link);
    actions.appendChild(createElement("span", "official-info-card__domain", extractDomain(record.source_url)));
    card.appendChild(actions);

    return card;
  }

  function groupRecordsByCategory(records) {
    var groups = {};
    records.forEach(function (record) {
      var id = record.public_category_id;
      if (!groups[id]) {
        groups[id] = [];
      }
      groups[id].push(record);
    });
    return groups;
  }

  function renderAreaSection(container, area, records, categoryAnchorsPlaced) {
    var section = createElement("section", "area-section");
    section.id = area.anchor;
    section.setAttribute("aria-labelledby", area.anchor + "-title");

    var inner = createElement("div", "container");
    var headerWrap = createElement("div", "area-section__header");
    var title = createElement("h2", "area-section__title", area.name);
    title.id = area.anchor + "-title";
    headerWrap.appendChild(title);
    inner.appendChild(headerWrap);

    var areaRecords = records
      .filter(function (r) { return r.area_id === area.area_id; })
      .sort(compareByCategoryThenDate);

    if (area.area_id === "KM004" && areaRecords.length === 0) {
      var empty = createElement("div", "area-section__placeholder");
      empty.appendChild(createElement("p", "area-section__placeholder-text", "現在、公開可能な公式情報を確認中です。"));
      inner.appendChild(empty);
    } else if (areaRecords.length === 0) {
      section.remove();
      return;
    } else {
      var groups = groupRecordsByCategory(areaRecords);
      var cards = createElement("div", "area-section__cards");

      CATEGORY_ORDER.forEach(function (cat) {
        var groupRecords = groups[cat.id];
        if (!groupRecords) {
          return;
        }

        groupRecords.sort(compareByDateDesc);

        var group = createElement("div", "area-section__category-group");
        var heading = createElement("h3", "area-section__category-title", groupRecords[0].public_category_label);

        if (!categoryAnchorsPlaced[cat.id]) {
          heading.id = cat.anchor;
          categoryAnchorsPlaced[cat.id] = true;
        }

        group.appendChild(heading);
        groupRecords.forEach(function (record) {
          group.appendChild(renderOfficialInfoCard(record));
        });
        cards.appendChild(group);
      });

      inner.appendChild(cards);
    }

    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderAboutSection(container) {
    var section = createElement("section", "about-section");
    section.setAttribute("aria-labelledby", "about-section-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title about-section__title", "このページの情報について"));
    inner.querySelector(".about-section__title").id = "about-section-title";

    var body = createElement("div", "about-section__body");
    body.appendChild(createElement("p", null, "このページでは、自治体および公的機関が公表した情報のみを掲載しています。"));
    body.appendChild(createElement("p", null, "各情報の詳細と最新状況は、「発表元の公式ページへ」から確認してください。"));
    inner.appendChild(body);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderCautionSection(container) {
    var section = createElement("section", "caution-section");
    section.setAttribute("aria-labelledby", "caution-section-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "section-title caution-section__title", "公式情報確認の注意"));
    inner.querySelector(".caution-section__title").id = "caution-section-title";

    var body = createElement("div", "caution-section__body");
    body.appendChild(createElement("p", null, "掲載情報は確認時点の内容です。避難、給水、道路規制などの最新状況は、必ずリンク先の公式発表をご確認ください。"));
    inner.appendChild(body);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderPageFooter(container) {
    var footer = createElement("footer", "page-footer");
    var inner = createElement("div", "container");
    inner.appendChild(createElement("p", "page-footer__copy", "令和8年熊本地震 自治体公式情報まとめ"));
    footer.appendChild(inner);
    container.appendChild(footer);
  }

  function renderLoadError(page) {
    page.innerHTML = "";
    renderEmergencyNotice(page);
    var wrap = createElement("div", "container load-error");
    wrap.setAttribute("role", "alert");
    wrap.appendChild(createElement("p", "load-error__message", LOAD_ERROR_MESSAGE));
    page.appendChild(wrap);
  }

  function init() {
    var page = document.getElementById("disaster-portal-page");
    if (!page) {
      return;
    }

    Promise.all([
      loadJson("phase1_areas.json"),
      loadJson("phase1_navigation.json"),
      loadJson("phase1_updates.json")
    ])
      .then(function (results) {
        var areas = results[0];
        var navigation = results[1];
        var updates = results[2];

        var publicRecords = updates
          .filter(isPublicRecord)
          .filter(isAllowedForArea);

        var lastVerified = getLatestCollectedAt(publicRecords);

        page.innerHTML = "";

        renderEmergencyNotice(page);
        renderPageHeader(page, areas, lastVerified);
        renderPageNavigation(page, navigation, publicRecords);

        var categoryAnchorsPlaced = {};
        areas.forEach(function (area) {
          renderAreaSection(page, area, publicRecords, categoryAnchorsPlaced);
        });

        if (publicRecords.length > 0) {
          renderLatestUpdates(page, publicRecords);
        }

        renderAboutSection(page);
        renderCautionSection(page);
        renderPageFooter(page);
      })
      .catch(function () {
        renderLoadError(page);
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
