(function () {
  "use strict";

  // PDFs hosted in this repo are too large for GitHub Pages, so they're served from the repo itself.
  var FILE_BASE = "https://raw.githubusercontent.com/UBGHyper/thgilciffart/main/";

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

  function href(url) { return /^https?:/.test(url) ? url : FILE_BASE + url; }

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

  function paperTable(papers) {
    return table(
      [h("th", {}, ["Name"]), h("th", { class: "r num-col" }, ["Size"])],
      papers.map(function (p) {
        return h("tr", {}, [
          h("td", {}, [h("a", { href: href(p.url), target: "_blank", rel: "noopener" }, [p.title])]),
          h("td", { class: "r num" }, [size(p.size)])
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
    if (flat.length) { app.appendChild(paperTable(flat)); shown++; }
    sec.groups.forEach(function (g) {
      var papers = q && g.name.toLowerCase().indexOf(q) !== -1 ? g.papers : g.papers.filter(match);
      if (!papers.length) return;
      app.appendChild(h("div", { class: "gtitle" }, [g.name]));
      app.appendChild(paperTable(papers));
      shown++;
    });
    if (!shown) app.appendChild(h("p", { class: "empty" }, ["No matches."]));
  }

  function render() {
    var r = route();
    var entry = subjects.filter(function (s) { return s.slug === r.slug; })[0];
    if (!entry) { renderHome(); return; }
    setCrumbs(entry.name);
    if (cache[r.slug]) { renderSubject(cache[r.slug], r); return; }
    app.innerHTML = "";
    fetch("data/subjects/" + r.slug + ".json")
      .then(function (res) { if (!res.ok) throw 0; return res.json(); })
      .then(function (full) { cache[r.slug] = full; renderSubject(full, route()); })
      .catch(function () { app.innerHTML = ""; app.appendChild(h("p", { class: "empty" }, ["Couldn't load this subject."])); });
  }

  var t;
  search.addEventListener("input", function () { clearTimeout(t); t = setTimeout(render, 100); });
  var lastSlug = "";
  window.addEventListener("hashchange", function () {
    var slug = route().slug;
    if (slug !== lastSlug) search.value = "";
    lastSlug = slug;
    render();
  });

  fetch("data/manifest.json")
    .then(function (res) { return res.json(); })
    .then(function (m) { subjects = m.subjects; lastSlug = route().slug; render(); })
    .catch(function () { app.appendChild(h("p", { class: "empty" }, ["Couldn't load data."])); });
})();
