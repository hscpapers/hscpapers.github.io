(function () {
  "use strict";

  // Hosted PDFs are too large for GitHub Pages. jsDelivr serves them from the repo as application/pdf
  // (raw.githubusercontent forces a download); every file is under its 20 MB limit.
  var FILE_BASE = "https://cdn.jsdelivr.net/gh/UBGHyper/thgilciffart@main/";
  var MARKS_KEY = "hscpapers-marks";

  var FACULTIES = [
    ["Mathematics", ["Mathematics Standard", "Mathematics Advanced", "Mathematics Extension 1", "Mathematics Extension 2"]],
    ["Science", ["Biology", "Chemistry", "Physics", "Earth and Environmental Science", "Senior Science"]],
    ["English", ["English"]],
    ["HSIE", ["Ancient History", "Modern History", "History Extension", "Business Studies", "Economics", "Legal Studies", "Geography", "Studies of Religion I", "Studies of Religion II"]],
    ["TAS", ["Agriculture", "Engineering Studies", "Information Processes and Technology", "Software Design and Development"]],
    ["PDHPE and CAFS", ["PDHPE", "Community and Family Studies"]],
    ["Other", ["Miscellaneous"]]
  ];

  var app = document.getElementById("app");
  var crumbs = document.getElementById("crumbs");
  var search = document.getElementById("search");
  var themeBtn = document.getElementById("theme-toggle");

  var subjects = [];
  var cache = {};

  function theme() { return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"; }
  function syncThemeBtn() { themeBtn.textContent = theme() === "dark" ? "light" : "dark"; }
  themeBtn.addEventListener("click", function () {
    var t = theme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", t);
    try { localStorage.setItem("papersdb-theme", t); } catch (e) {}
    syncThemeBtn();
  });
  syncThemeBtn();

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) el.setAttribute(k, attrs[k]);
    (kids || []).forEach(function (c) {
      if (c != null) el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return el;
  }

  function size(s) {
    var kb = typeof s === "number" ? s / 1024 : parseFloat(s);
    if (!kb) return "";
    return kb >= 1024 ? (kb / 1024).toFixed(1) + " MB" : Math.max(1, Math.round(kb)) + " KB";
  }

  function href(url) {
    if (/^https?:/.test(url)) return url;
    return FILE_BASE + url.split("/").map(function (s) { return encodeURIComponent(decodeURIComponent(s)); }).join("/");
  }

  // ---------- marks (kept in this browser only) ----------
  var marks = {};
  try { marks = JSON.parse(localStorage.getItem(MARKS_KEY)) || {}; } catch (e) {}
  function saveMarks() { try { localStorage.setItem(MARKS_KEY, JSON.stringify(marks)); } catch (e) {} }
  function defaultTotal(subject) { return subject === "Mathematics Extension 1" ? "70" : "100"; }

  function markCell(p, subject) {
    var rec = marks[p.url] || {};
    function input(field, placeholder) {
      var i = h("input", { type: "text", inputmode: "decimal", class: "mark-" + field, placeholder: placeholder, "aria-label": field === "m" ? "Your mark" : "Total marks" });
      i.value = rec[field] || "";
      i.addEventListener("input", function () {
        var r = marks[p.url] || {};
        if (i.value.trim()) r[field] = i.value.trim(); else delete r[field];
        if (Object.keys(r).length) marks[p.url] = r; else delete marks[p.url];
        saveMarks();
      });
      return i;
    }
    return h("td", { class: "r mark" }, [input("m", "mark"), h("span", { class: "slash" }, ["/"]), input("t", defaultTotal(subject))]);
  }

  function route() {
    var p = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
    return { slug: p[0] || "", year: p[1] || "", section: p[2] || "" };
  }
  function link(parts) { return "#/" + parts.filter(Boolean).map(encodeURIComponent).join("/"); }

  function table(headers, rows) {
    return h("div", { class: "box" }, [
      h("table", {}, [h("thead", {}, [h("tr", {}, headers)]), h("tbody", {}, rows)])
    ]);
  }

  function setCrumbs(name) {
    crumbs.innerHTML = "";
    if (name) crumbs.appendChild(h("span", {}, [h("span", { class: "sep" }, ["/"]), name]));
  }

  // ---------- home ----------
  function grouped(list) {
    var byName = {}, used = {};
    list.forEach(function (s) { byName[s.name] = s; });
    var out = FACULTIES.map(function (f) {
      return [f[0], f[1].map(function (n) { used[n] = 1; return byName[n]; }).filter(Boolean)];
    });
    var rest = list.filter(function (s) { return !used[s.name]; });
    if (rest.length) out.push(["Other subjects", rest]);
    return out.filter(function (g) { return g[1].length; });
  }

  function renderHome() {
    setCrumbs(null);
    app.innerHTML = "";
    var q = search.value.trim().toLowerCase();
    var groups = grouped(subjects.filter(function (s) { return !q || s.name.toLowerCase().indexOf(q) !== -1; }));
    if (!groups.length) { app.appendChild(h("p", { class: "empty" }, ["No matches."])); return; }
    groups.forEach(function (g) {
      app.appendChild(h("div", { class: "gtitle" }, [g[0]]));
      app.appendChild(table(
        [h("th", {}, ["Name"]), h("th", { class: "r num-col" }, ["Papers"]), h("th", { class: "r num-col hide-sm" }, ["Schools"])],
        g[1].map(function (s) {
          return h("tr", {}, [
            h("td", {}, [h("a", { href: link([s.slug]) }, [s.name])]),
            h("td", { class: "r num" }, [String(s.paperCount)]),
            h("td", { class: "r num hide-sm" }, [String(s.schoolCount)])
          ]);
        })
      ));
    });
  }

  // ---------- subject ----------
  function tabs(items, activeKey, hrefFor, cls) {
    if (items.length < 2) return null;
    return h("nav", { class: "tabs " + cls }, items.map(function (it) {
      return h("a", { href: hrefFor(it), class: it.key === activeKey ? "on" : "" }, [it.name]);
    }));
  }

  function paperTable(papers, subject) {
    return table(
      [h("th", {}, ["Name"]), h("th", { class: "r mark-col" }, ["Mark"]), h("th", { class: "r num-col hide-sm" }, ["Size"])],
      papers.map(function (p) {
        return h("tr", {}, [
          h("td", {}, [h("a", { href: href(p.url), target: "_blank", rel: "noopener" }, [p.title])]),
          markCell(p, subject),
          h("td", { class: "r num hide-sm" }, [size(p.size)])
        ]);
      })
    );
  }

  function renderSubject(s, r) {
    app.innerHTML = "";
    var year = s.years.filter(function (y) { return y.key === r.year; })[0] || s.years[0];
    var sec = year.sections.filter(function (x) { return x.key === r.section; })[0] || year.sections[0];

    var yt = tabs(s.years, year.key, function (y) { return link([s.slug, y.key]); }, "years");
    var st = tabs(year.sections, sec.key, function (x) { return link([s.slug, year.key, x.key]); }, "sections");
    if (yt) app.appendChild(yt);
    if (st) app.appendChild(st);

    var q = search.value.trim().toLowerCase();
    var match = function (p) { return !q || p.title.toLowerCase().indexOf(q) !== -1; };
    var shown = 0;

    var flat = sec.papers.filter(match);
    if (flat.length) { app.appendChild(paperTable(flat, s.name)); shown++; }
    sec.groups.forEach(function (g) {
      var papers = q && g.name.toLowerCase().indexOf(q) !== -1 ? g.papers : g.papers.filter(match);
      if (!papers.length) return;
      app.appendChild(h("div", { class: "gtitle" }, [g.name]));
      app.appendChild(paperTable(papers, s.name));
      shown++;
    });
    if (!shown) app.appendChild(h("p", { class: "empty" }, ["No matches."]));
  }

  function loadSubject(slug) {
    if (!cache[slug]) {
      cache[slug] = fetch("data/subjects/" + slug + ".json")
        .then(function (res) { if (!res.ok) throw 0; return res.json(); })
        .catch(function (e) { delete cache[slug]; throw e; });
    }
    return cache[slug];
  }

  // Start fetching a subject as soon as the pointer or finger lands on its link.
  function prefetch(e) {
    var a = e.target.closest && e.target.closest("a[href^='#/']");
    if (!a) return;
    var slug = decodeURIComponent(a.getAttribute("href").slice(2).split("/")[0]);
    if (slug && subjects.some(function (s) { return s.slug === slug; })) loadSubject(slug).catch(function () {});
  }
  app.addEventListener("pointerover", prefetch);
  app.addEventListener("touchstart", prefetch, { passive: true });
  app.addEventListener("focusin", prefetch);

  var scrollPos = {};
  var pendingScroll = 0;
  function restoreScroll() { window.scrollTo(0, pendingScroll); }

  function render() {
    var r = route();
    var entry = subjects.filter(function (s) { return s.slug === r.slug; })[0];
    if (!entry) { renderHome(); restoreScroll(); return; }
    setCrumbs(entry.name);
    loadSubject(r.slug)
      .then(function (full) {
        if (route().slug !== r.slug) return;
        renderSubject(full, route());
        restoreScroll();
      })
      .catch(function () { app.innerHTML = ""; app.appendChild(h("p", { class: "empty" }, ["Couldn't load this subject."])); });
  }

  var t;
  search.addEventListener("input", function () {
    clearTimeout(t);
    t = setTimeout(function () { pendingScroll = window.scrollY; render(); }, 100);
  });

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  var lastSlug = "";
  window.addEventListener("hashchange", function (e) {
    scrollPos[e.oldURL.split("#")[1] || ""] = window.scrollY;
    pendingScroll = scrollPos[location.hash.slice(1)] || 0;
    var slug = route().slug;
    if (slug !== lastSlug) search.value = "";
    lastSlug = slug;
    render();
  });

  document.addEventListener("keydown", function (e) {
    var typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      search.focus();
      search.select();
    } else if (e.key === "Escape" && document.activeElement === search) {
      search.value = "";
      search.blur();
      render();
    }
  });

  fetch("data/manifest.json")
    .then(function (res) { return res.json(); })
    .then(function (m) { subjects = m.subjects; lastSlug = route().slug; render(); })
    .catch(function () { app.appendChild(h("p", { class: "empty" }, ["Couldn't load data."])); });
})();
