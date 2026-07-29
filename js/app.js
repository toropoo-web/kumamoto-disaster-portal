(function () {
  "use strict";

  var DATA_BASE = "./data/public/";
  var VERIFIED_STATUS = "VERIFIED";
  var INCIDENT_SCOPE = "2026_KUMAMOTO_EARTHQUAKE";
  var MAX_LATEST = 4;
  var LOAD_ERROR_MESSAGE = "情報を読み込めませんでした。自治体公式サイトの情報をご確認ください。";
  var X_FEED_STATUS_AVAILABLE = "AVAILABLE";
  var X_FEED_STATUS_UNAVAILABLE = "UNAVAILABLE";
  var AREA_DISASTER_NAV_ID = "area-disaster-nav";
  var GOOGLE_MAPS_SEARCH_BASE = "https://www.google.com/maps/search/?api=1&query=";

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
    },
    KM005: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM006: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM007: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM008: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM009: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM010: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM011: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM012: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    },
    KM013: {
      allowed: ["EMERGENCY", "SHELTER", "WATER", "SUPPORT"],
      blocked: ["ROAD", "CERTIFICATE", "IMPACT", "LIFELINE"]
    }
  };

  var COMMUNICATION_STATUS_LABELS = {
    PARTIAL_OUTAGE: "一部地域",
    RESTORED: "復旧済み",
    NO_REPORTED_IMPACT: "影響情報なし",
    CHECK_OFFICIAL: "公式情報を確認"
  };

  var MAX_COMMUNICATION_AREAS = 4;

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

  function isValidXFeedUrl(url) {
    return typeof url === "string" && (url.indexOf("https://") === 0 || url.indexOf("http://") === 0);
  }

  function validateXFeedPreview(data) {
    if (!data || !Array.isArray(data.posts) || data.posts.length === 0) {
      return null;
    }

    var requiredFields = ["source_id", "account_name", "post_time", "text", "url"];
    var validPosts = [];
    var seenUrls = {};

    data.posts.forEach(function (post) {
      if (!post) {
        return;
      }

      var hasAllFields = requiredFields.every(function (field) {
        return post[field] && String(post[field]).trim() !== "";
      });

      if (!hasAllFields || !isValidXFeedUrl(post.url)) {
        return;
      }

      if (seenUrls[post.url]) {
        return;
      }
      seenUrls[post.url] = true;
      validPosts.push(post);
    });

    if (validPosts.length === 0) {
      return null;
    }

    return validPosts;
  }

  function loadXFeedPreview() {
    return fetch(DATA_BASE + "x_feed_preview.json")
      .then(function (response) {
        if (!response.ok) {
          return { status: X_FEED_STATUS_UNAVAILABLE };
        }
        return response.json()
          .then(function (data) {
            var posts = validateXFeedPreview(data);
            if (!posts) {
              return { status: X_FEED_STATUS_UNAVAILABLE };
            }
            return {
              status: X_FEED_STATUS_AVAILABLE,
              section_title: data.section_title,
              synced_at: data.synced_at,
              posts: posts
            };
          })
          .catch(function () {
            return { status: X_FEED_STATUS_UNAVAILABLE };
          });
      })
      .catch(function () {
        return { status: X_FEED_STATUS_UNAVAILABLE };
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

  function formatConfirmedAtShort(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var m = date.getMonth() + 1;
    var d = date.getDate();
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return m + "月" + d + "日 " + h + ":" + min + "確認";
  }

  function formatSyncedAt(value) {
    var date = parseDate(value);
    if (!date) {
      return "";
    }
    var y = date.getFullYear();
    var m = String(date.getMonth() + 1).padStart(2, "0");
    var d = String(date.getDate()).padStart(2, "0");
    var h = String(date.getHours()).padStart(2, "0");
    var min = String(date.getMinutes()).padStart(2, "0");
    return y + "/" + m + "/" + d + " " + h + ":" + min;
  }

  function formatCommunicationAreas(areas) {
    if (!areas || areas.length === 0) {
      return "";
    }
    if (areas.length <= MAX_COMMUNICATION_AREAS) {
      return "（" + areas.join("・") + "）";
    }
    return "（" + areas.slice(0, MAX_COMMUNICATION_AREAS).join("・") + "ほか）";
  }

  function getCommunicationStatusText(provider) {
    var label = provider.status_label || COMMUNICATION_STATUS_LABELS[provider.status] || COMMUNICATION_STATUS_LABELS.CHECK_OFFICIAL;
    if (provider.status === "PARTIAL_OUTAGE") {
      return label + formatCommunicationAreas(provider.areas);
    }
    return label;
  }

  function getServiceStatusText(service) {
    return service.status_label || COMMUNICATION_STATUS_LABELS[service.status] || COMMUNICATION_STATUS_LABELS.CHECK_OFFICIAL;
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

  function buildGoogleMapsSearchUrl(query) {
    return GOOGLE_MAPS_SEARCH_BASE + encodeURIComponent(query);
  }

  function scrollToAreaDisasterNav() {
    var target = document.getElementById(AREA_DISASTER_NAV_ID);
    if (!target) {
      return;
    }
    var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "start"
    });
    var select = target.querySelector(".area-disaster-nav__select");
    if (select) {
      select.focus();
    }
  }

  function renderAreaNavPromo(container) {
    var section = createElement("section", "area-nav-promo");
    section.setAttribute("aria-labelledby", "area-nav-promo-title");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("h2", "area-nav-promo__title", "地域の災害情報を地図で確認"));
    inner.querySelector(".area-nav-promo__title").id = "area-nav-promo-title";
    inner.appendChild(createElement(
      "p",
      "area-nav-promo__lead",
      "市町村を選択すると、地域に関連する災害情報や地図を確認できます。"
    ));

    var button = createElement("button", "area-nav-promo__button", "地域を選択して見る");
    button.type = "button";
    button.setAttribute("aria-label", "地域災害ナビへ移動");
    button.addEventListener("click", scrollToAreaDisasterNav);
    inner.appendChild(button);

    section.appendChild(inner);
    container.appendChild(section);
  }

  function createAreaNavExternalLink(className, label, href, ariaLabel) {
    var link = createElement("a", className, label);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.setAttribute("aria-label", ariaLabel);
    return link;
  }

  function renderAreaDisasterNavLinks(panel, areaEntry) {
    panel.innerHTML = "";
    if (!areaEntry || !areaEntry.navigation) {
      panel.hidden = true;
      return;
    }

    var nav = areaEntry.navigation;
    panel.hidden = false;
    panel.appendChild(createElement("h3", "area-disaster-nav__selected-name", areaEntry.name));

    var list = createElement("ul", "area-disaster-nav__links");

    var items = [
      {
        icon: "💧",
        label: "給水・断水",
        href: buildGoogleMapsSearchUrl(nav.water),
        ariaLabel: areaEntry.name + "の給水・断水情報をGoogleマップで検索（外部リンク）"
      },
      {
        icon: "🏠",
        label: "避難所",
        href: buildGoogleMapsSearchUrl(nav.shelter),
        ariaLabel: areaEntry.name + "の避難所をGoogleマップで検索（外部リンク）"
      },
      {
        icon: "🚧",
        label: "道路・通行情報",
        href: buildGoogleMapsSearchUrl(nav.road),
        ariaLabel: areaEntry.name + "の道路・通行情報をGoogleマップで検索（外部リンク）"
      },
      {
        icon: "📡",
        label: "通信情報",
        href: "#communication-status-title",
        ariaLabel: "携帯電話・通信情報へ移動",
        internal: true
      },
      {
        icon: "🗺",
        label: "防災マップ",
        href: nav.disaster_map,
        ariaLabel: areaEntry.name + "の公式防災マップへ（外部リンク）"
      }
    ];

    items.forEach(function (item) {
      var li = createElement("li", "area-disaster-nav__item");
      var link = createAreaNavExternalLink("area-disaster-nav__link", item.icon + " " + item.label, item.href, item.ariaLabel);
      if (item.internal) {
        link.removeAttribute("target");
        link.removeAttribute("rel");
      }
      li.appendChild(link);
      list.appendChild(li);
    });

    panel.appendChild(list);
  }

  function renderAreaDisasterNav(container, areaNavigation) {
    if (!areaNavigation || !areaNavigation.areas || areaNavigation.areas.length === 0) {
      return;
    }

    var section = createElement("section", "area-disaster-nav");
    section.id = AREA_DISASTER_NAV_ID;
    section.setAttribute("aria-labelledby", "area-disaster-nav-title");

    var inner = createElement("div", "container");
    var title = areaNavigation.section_title || "地域災害ナビ";
    inner.appendChild(createElement("h2", "section-title area-disaster-nav__title", title));
    inner.querySelector(".area-disaster-nav__title").id = "area-disaster-nav-title";
    inner.appendChild(createElement(
      "p",
      "area-disaster-nav__lead",
      "お住まいの地域を選ぶと、給水・避難所・道路情報などへのリンクを表示します。"
    ));

    var selectId = "area-disaster-nav-select";
    var label = createElement("label", "area-disaster-nav__label", "自治体を選択");
    label.htmlFor = selectId;

    var select = createElement("select", "area-disaster-nav__select");
    select.id = selectId;
    select.setAttribute("aria-label", "自治体を選択");

    var placeholder = createElement("option", null, "自治体を選択してください");
    placeholder.value = "";
    placeholder.disabled = true;
    placeholder.selected = true;
    select.appendChild(placeholder);

    var areaMap = {};
    areaNavigation.areas.forEach(function (area) {
      areaMap[area.area_id] = area;
      var option = createElement("option", null, area.name);
      option.value = area.area_id;
      select.appendChild(option);
    });

    var panel = createElement("div", "area-disaster-nav__panel");
    panel.hidden = true;
    panel.setAttribute("aria-live", "polite");

    select.addEventListener("change", function () {
      renderAreaDisasterNavLinks(panel, areaMap[select.value] || null);
    });

    inner.appendChild(label);
    inner.appendChild(select);
    inner.appendChild(panel);
    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderEmergencyNotice(container) {
    var section = createElement("section", "emergency-notice");
    section.id = "page-hero";
    section.setAttribute("role", "alert");
    section.setAttribute("aria-label", "緊急時の注意");

    var inner = createElement("div", "container");
    inner.appendChild(createElement("p", "emergency-notice__text", "緊急時は、自治体・警察・消防などの指示を優先してください。"));
    section.appendChild(inner);
    container.appendChild(section);
  }

  function buildMunicipalitySubtitle(navigation) {
    if (!navigation || navigation.length === 0) {
      return "各自治体の公式情報へリンクします。";
    }
    var names = navigation.map(function (item) {
      return item.name;
    });
    return names.join("・") + "の公式情報へリンクします。";
  }

  function renderPageHeader(container, navigation, lastVerified) {
    var header = createElement("header", "page-header");
    var inner = createElement("div", "container");

    var title = createElement("h1", "page-header__title");
    title.innerHTML = "令和8年熊本地震<br>自治体公式情報まとめ";
    inner.appendChild(title);

    inner.appendChild(createElement("p", "page-header__subtitle", buildMunicipalitySubtitle(navigation)));

    if (lastVerified) {
      var verified = createElement("p", "page-header__verified");
      verified.appendChild(createElement("span", "page-header__verified-label", "最終確認："));
      verified.appendChild(document.createTextNode(lastVerified));
      inner.appendChild(verified);
    }

    header.appendChild(inner);
    container.appendChild(header);
  }

  function renderCommunicationStatus(container, communicationStatus) {
    if (!communicationStatus || !communicationStatus.providers || communicationStatus.providers.length === 0) {
      return;
    }

    var section = createElement("section", "communication-status");
    section.setAttribute("aria-labelledby", "communication-status-title");

    var inner = createElement("div", "container");
    var sectionTitle = communicationStatus.section_title || "携帯電話・通信";
    var titleEl = createElement("h2", "communication-status__title", sectionTitle);
    titleEl.id = "communication-status-title";
    inner.appendChild(titleEl);

    var list = createElement("ul", "communication-status__list");

    communicationStatus.providers.forEach(function (provider) {
      var li = createElement("li", "communication-status__item");
      var link = createElement("a", "communication-status__link");
      link.href = provider.source_url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", provider.provider_name + "の公式障害情報へ（外部リンク）");

      link.appendChild(createElement("span", "communication-status__provider", provider.provider_name));
      link.appendChild(createElement("span", "communication-status__text", getCommunicationStatusText(provider)));
      li.appendChild(link);
      list.appendChild(li);
    });

    if (communicationStatus.services && communicationStatus.services.length > 0) {
      communicationStatus.services.forEach(function (service) {
        var li = createElement("li", "communication-status__item communication-status__item--service");
        var displayName = service.display_name || service.service_name;
        var link = createElement("a", "communication-status__link");
        link.href = service.source_url;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.setAttribute("aria-label", displayName + "の公式情報へ（外部リンク）");

        link.appendChild(createElement("span", "communication-status__provider", service.service_name));
        link.appendChild(createElement("span", "communication-status__text", getServiceStatusText(service)));
        li.appendChild(link);

        if (service.summary) {
          li.appendChild(createElement("p", "communication-status__summary", service.summary));
        }

        if (service.caution) {
          li.appendChild(createElement("p", "communication-status__caution", service.caution));
        }

        list.appendChild(li);
      });
    }

    inner.appendChild(list);

    var confirmedAt = formatConfirmedAtShort(communicationStatus.confirmed_at);
    if (confirmedAt) {
      inner.appendChild(createElement("p", "communication-status__confirmed", confirmedAt));
    }

    section.appendChild(inner);
    container.appendChild(section);
  }

  function renderPageNavigation(container, navigation, records) {
    var wrap = createElement("div", "page-nav");

    var muniNav = createElement("nav", "municipality-nav");
    muniNav.setAttribute("aria-label", "自治体から探す");

    var muniInner = createElement("div", "container");
    muniInner.appendChild(createElement("p", "page-nav__label", "自治体から探す"));

    var muniScroll = createElement("div", "municipality-nav__scroll");
    var muniList = createElement("ul", "municipality-nav__list");

    navigation.forEach(function (item) {
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

  function renderXFeedSection(container, xFeedState) {
    if (!xFeedState || xFeedState.status !== X_FEED_STATUS_AVAILABLE || !xFeedState.posts || xFeedState.posts.length === 0) {
      return;
    }

    var section = createElement("section", "x-feed");
    section.setAttribute("aria-labelledby", "x-feed-title");

    var inner = createElement("div", "container");
    var titleEl = createElement("h2", "section-title x-feed__title", xFeedState.section_title || "公式X速報");
    titleEl.id = "x-feed-title";
    inner.appendChild(titleEl);

    var syncedAt = formatSyncedAt(xFeedState.synced_at);
    if (syncedAt) {
      inner.appendChild(createElement("p", "x-feed__synced", "最終取得：" + syncedAt));
    }

    inner.appendChild(createElement("p", "x-feed__lead", "公的機関・自治体等の公式X投稿です。最新状況はリンク先でご確認ください。"));

    var list = createElement("ul", "x-feed__list");

    xFeedState.posts.forEach(function (post) {
      var li = createElement("li", "x-feed__item");
      var meta = createElement("div", "x-feed__meta");

      var datetime = formatDateTime(post.post_time);
      if (datetime) {
        meta.appendChild(createElement("time", "x-feed__datetime", datetime));
      }
      if (post.account_name) {
        meta.appendChild(createElement("span", "x-feed__account", post.account_name));
      }

      li.appendChild(meta);

      if (post.text) {
        li.appendChild(createElement("p", "x-feed__text", post.text));
      }

      var link = createElement("a", "x-feed__link", "公式X投稿へ");
      link.href = post.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", (post.account_name || "公式") + "のX投稿へ（外部リンク）");
      li.appendChild(link);

      list.appendChild(li);
    });

    inner.appendChild(list);
    section.appendChild(inner);
    container.appendChild(section);
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

  var BACK_TO_TOP_THRESHOLD = 400;

  function initBackToTop(heroTarget) {
    var button = createElement("button", "back-to-top");
    button.type = "button";
    button.textContent = "↑ ページ上部へ戻る";
    button.setAttribute("aria-label", "ページ上部へ戻る");
    button.setAttribute("aria-hidden", "true");
    button.tabIndex = -1;

    function updateVisibility() {
      var show = window.scrollY > BACK_TO_TOP_THRESHOLD;
      button.classList.toggle("back-to-top--visible", show);
      button.setAttribute("aria-hidden", show ? "false" : "true");
      button.tabIndex = show ? 0 : -1;
    }

    button.addEventListener("click", function () {
      var prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      var behavior = prefersReducedMotion ? "auto" : "smooth";

      if (heroTarget) {
        heroTarget.scrollIntoView({ behavior: behavior, block: "start" });
      } else {
        window.scrollTo({ top: 0, behavior: behavior });
      }
    });

    window.addEventListener("scroll", updateVisibility, { passive: true });
    updateVisibility();
    document.body.appendChild(button);
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
      loadJson("phase1_updates.json"),
      loadJson("communication_status.json"),
      loadJson("status.json"),
      loadJson("area_navigation.json"),
      loadXFeedPreview()
    ])
      .then(function (results) {
        var areas = results[0];
        var navigation = results[1];
        var updates = results[2];
        var communicationStatus = results[3];
        var publicStatus = results[4];
        var areaNavigation = results[5];
        var xFeedState = results[6];

        var publicRecords = updates
          .filter(isPublicRecord)
          .filter(isAllowedForArea);

        var lastVerified = publicStatus && publicStatus.last_patrol_at
          ? formatDateTime(publicStatus.last_patrol_at)
          : "";

        page.innerHTML = "";

        renderEmergencyNotice(page);
        renderPageHeader(page, navigation, lastVerified);
        renderAreaNavPromo(page);
        renderCommunicationStatus(page, communicationStatus);
        renderPageNavigation(page, navigation, publicRecords);
        renderXFeedSection(page, xFeedState);

        var categoryAnchorsPlaced = {};
        areas.forEach(function (area) {
          renderAreaSection(page, area, publicRecords, categoryAnchorsPlaced);
        });

        if (publicRecords.length > 0) {
          renderLatestUpdates(page, publicRecords);
        }

        renderAreaDisasterNav(page, areaNavigation);
        renderAboutSection(page);
        renderCautionSection(page);
        renderPageFooter(page);
        initBackToTop(document.getElementById("page-hero"));
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
