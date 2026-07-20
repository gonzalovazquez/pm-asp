/* ============================================================
 * Product Map demo — lens light-up + detail panel + mock charts.
 * No framework, no backend. Driven entirely by window.ATLAS (data.js).
 * ============================================================ */
(function () {
  "use strict";
  var D = window.ATLAS;
  var LENSES = ["product", "delivery", "program"];
  var state = { lens: "product", selected: null };

  // Canned "generation" output for artifacts that start missing (demo reveal).
  var CANNED = {
    release: "# Release Notes: Atlas\n*v1 · generated just now*\n\n## What's new\n- Unified notification API (SMS, email, push)\n- Customer preference center\n- Real-time delivery with automatic retries\n\n## Known limitations\n- Push retries land in M4\n\n## Rollout\nStaged: 5% → 25% → 100% over one week.",
  };

  var $ = function (sel) { return document.querySelector(sel); };
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function nodeById(id) { for (var s of D.stages) for (var n of s.nodes) if (n.id === id) return n; return null; }
  function icon(type) { return type === "artifact" ? "📄" : type === "skill" ? "⚡" : "📊"; }

  /* ---------- tiny markdown renderer (controlled subset) ---------- */
  function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  function inline(s) {
    return esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(^|[^*])\*([^*]+?)\*/g, "$1<em>$2</em>")
      .replace(/`([^`]+?)`/g, "<code>$1</code>");
  }
  function md(src) {
    if (!src) return "";
    var lines = src.split("\n"), out = [], i = 0;
    while (i < lines.length) {
      var ln = lines[i];
      if (/^\s*$/.test(ln)) { i++; continue; }
      var h = ln.match(/^(#{1,3})\s+(.*)/);
      if (h) { out.push("<h" + h[1].length + ">" + inline(h[2]) + "</h" + h[1].length + ">"); i++; continue; }
      if (/^\s*\|/.test(ln)) {                       // table block
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
        var cells = function (r) { return r.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(function (c) { return c.trim(); }); };
        var head = cells(rows[0]);
        var body = rows.slice(2).map(cells);
        var t = "<table><thead><tr>" + head.map(function (c) { return "<th>" + inline(c) + "</th>"; }).join("") + "</tr></thead><tbody>";
        t += body.map(function (r) { return "<tr>" + r.map(function (c) { return "<td>" + inline(c) + "</td>"; }).join("") + "</tr>"; }).join("");
        out.push(t + "</tbody></table>"); continue;
      }
      if (/^\s*-\s+/.test(ln)) {                     // list block
        var items = [];
        while (i < lines.length && /^\s*-\s+/.test(lines[i])) { items.push("<li>" + inline(lines[i].replace(/^\s*-\s+/, "")) + "</li>"); i++; }
        out.push("<ul>" + items.join("") + "</ul>"); continue;
      }
      out.push("<p>" + inline(ln) + "</p>"); i++;
    }
    return out.join("");
  }

  /* ---------- SVG charts (mock delivery metrics) ---------- */
  function burndownSVG() {
    var m = D.metrics.burndown, n = m.labels.length, maxY = m.ideal[0];
    var x0 = 40, x1 = 466, y0 = 172, y1 = 18, W = x1 - x0, H = y0 - y1;
    var px = function (i) { return x0 + (i / (n - 1)) * W; };
    var py = function (v) { return y0 - (v / maxY) * H; };
    var line = function (arr) { return arr.map(function (v, i) { return px(i) + "," + py(v); }).join(" "); };
    var grid = "";
    for (var g = 0; g <= 4; g++) { var gy = y0 - (g / 4) * H; grid += '<line x1="' + x0 + '" y1="' + gy + '" x2="' + x1 + '" y2="' + gy + '" stroke="currentColor" opacity=".12"/>'; grid += '<text x="' + (x0 - 6) + '" y="' + (gy + 3) + '" font-size="9" text-anchor="end" fill="currentColor" opacity=".55">' + Math.round((g / 4) * maxY) + "</text>"; }
    var behind = m.actual[n - 1] - m.ideal[n - 1];
    return '<svg viewBox="0 0 480 190" width="100%" role="img" aria-label="Sprint burndown">' + grid +
      '<polyline fill="none" stroke="var(--muted)" stroke-width="2" stroke-dasharray="5 4" points="' + line(m.ideal) + '"/>' +
      '<polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="' + line(m.actual) + '"/>' +
      '<circle cx="' + px(n - 1) + '" cy="' + py(m.actual[n - 1]) + '" r="4" fill="var(--accent)"/>' +
      '<text x="' + px(n - 1) + '" y="' + (py(m.actual[n - 1]) - 8) + '" font-size="10" text-anchor="end" fill="var(--warn)">+' + behind + ' behind</text>' +
      '<text x="' + x0 + '" y="188" font-size="9" fill="currentColor" opacity=".55">day 0</text>' +
      '<text x="' + x1 + '" y="188" font-size="9" text-anchor="end" fill="currentColor" opacity=".55">day ' + (n - 1) + '</text>' +
      '</svg>';
  }
  function throughputSVG() {
    var arr = D.metrics.throughput, n = arr.length, maxV = Math.max.apply(null, arr.map(function (a) { return a.done; }));
    var x0 = 30, x1 = 466, y0 = 150, y1 = 18, W = x1 - x0, H = y0 - y1, bw = (W / n) * 0.55;
    var bars = arr.map(function (a, i) {
      var cx = x0 + (i + 0.5) * (W / n), h = (a.done / maxV) * H, y = y0 - h;
      return '<rect x="' + (cx - bw / 2) + '" y="' + y + '" width="' + bw + '" height="' + h + '" rx="4" fill="var(--accent2)"/>' +
        '<text x="' + cx + '" y="' + (y - 5) + '" font-size="10" text-anchor="middle" fill="currentColor">' + a.done + '</text>' +
        '<text x="' + cx + '" y="' + (y0 + 14) + '" font-size="10" text-anchor="middle" fill="currentColor" opacity=".6">' + a.week + '</text>';
    }).join("");
    return '<svg viewBox="0 0 480 170" width="100%" role="img" aria-label="Weekly throughput">' +
      '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x1 + '" y2="' + y0 + '" stroke="currentColor" opacity=".18"/>' + bars + '</svg>';
  }

  /* ---------- detail renderers ---------- */
  function tag(k) { return '<span class="k">' + k + "</span>"; }

  function renderArtifact(node) {
    var d = $("#detail");
    if (node.missing) {
      var canRun = !!node.producedBy;
      d.innerHTML = '<div class="dh">' + tag("artifact") + "<h2>" + node.title + "</h2></div>" +
        '<div class="placeholder"><div class="big">🕳️</div><p>Not generated yet — this is a gap in the knowledge center.</p>' +
        (canRun ? '<button class="btn primary" id="runBtn">⚡ Run ' + node.producedBy + "</button>" : '<p class="empty">No skill wired for this artifact yet.</p>') + "</div>";
      if (canRun) $("#runBtn").onclick = function () { runSkill(node); };
      return;
    }
    var runHtml = node.producedBy ? '<button class="btn" id="runBtn">⚡ Re-run ' + node.producedBy + "</button>" : "";
    d.innerHTML = '<div class="dh">' + tag("artifact") + "<h2>" + node.title + "</h2>" +
      '<span class="k">v' + node.version + "</span>" + runHtml + "</div>" +
      '<div class="md">' + md(node.markdown) + "</div>";
    if (node.producedBy) $("#runBtn").onclick = function () { runSkill(node); };
  }

  function renderSkill(node) {
    var d = $("#detail");
    var target = node.produces ? nodeById(node.produces) : null;
    d.innerHTML = '<div class="dh">' + tag("skill") + "<h2>" + node.title + "</h2></div>" +
      "<p>" + node.desc + "</p>" +
      (target ? '<button class="btn primary" id="runBtn">⚡ Run — produces “' + target.title + "”</button>" : "");
    if (target) $("#runBtn").onclick = function () { runSkill(node); };
  }

  function renderDeliveryDashboard(title) {
    var m = D.metrics, d = $("#detail");
    d.innerHTML = '<div class="dh">' + tag("delivery") + "<h2>" + (title || "Delivery metrics") + "</h2>" +
      '<span class="k">Sprint 7 · day 8/10</span></div>' +
      '<div class="tiles">' +
        '<div class="tile"><div class="v warn">+' + (m.burndown.actual[m.burndown.actual.length - 1] - m.burndown.ideal[m.burndown.ideal.length - 1]) + '</div><div class="l">points behind</div></div>' +
        '<div class="tile"><div class="v">' + m.cycletime.avgDays + 'd</div><div class="l">avg cycle time</div></div>' +
        '<div class="tile"><div class="v">' + m.wip + '</div><div class="l">work in progress</div></div>' +
        '<div class="tile"><div class="v">' + m.throughput.reduce(function (s, a) { return s + a.done; }, 0) + '</div><div class="l">items shipped</div></div>' +
      '</div>' +
      '<div class="charts" style="margin-top:14px">' +
        '<div class="chart"><h3>Burndown</h3>' + burndownSVG() + '<div class="legend"><span><i></i>actual</span><span><i class="ideal"></i>ideal</span></div></div>' +
        '<div class="chart"><h3>Throughput (items / week)</h3>' + throughputSVG() + '</div>' +
      '</div>';
  }

  function renderReadiness() {
    var pct = D.metrics.readiness, d = $("#detail");
    var gates = [
      { k: "PRD approved", ok: true }, { k: "Roadmap set", ok: true },
      { k: "Delivery on track", ok: false }, { k: "Release notes", ok: !nodeById("release").missing },
    ];
    d.innerHTML = '<div class="dh">' + tag("program") + "<h2>Launch readiness</h2></div>" +
      '<div class="tiles"><div class="tile"><div class="v ' + (pct < 80 ? "warn" : "") + '">' + pct + '%</div><div class="l">gate readiness</div></div></div>' +
      '<div class="md" style="margin-top:12px"><ul>' +
      gates.map(function (g) { return "<li>" + (g.ok ? "✅" : "⚠️") + " " + g.k + "</li>"; }).join("") +
      "</ul></div>";
  }

  function renderProgramOverview() {
    var d = $("#detail");
    var rows = D.stages.map(function (s) {
      var arts = s.nodes.filter(function (n) { return n.type === "artifact"; });
      var have = arts.filter(function (n) { return !n.missing; }).length;
      var gaps = arts.filter(function (n) { return n.missing; }).map(function (n) { return n.title; });
      return "<tr><td>" + s.name + "</td><td>" + have + "/" + arts.length + "</td><td>" +
        (gaps.length ? '<span style="color:var(--bad)">' + gaps.join(", ") + "</span>" : "—") + "</td></tr>";
    }).join("");
    d.innerHTML = '<div class="dh">' + tag("program") + "<h2>Program view — the whole product</h2></div>" +
      "<p>Artifact coverage and gaps across every lifecycle stage. Click a metric for launch readiness, or an artifact to open it.</p>" +
      '<div class="md"><table><thead><tr><th>Stage</th><th>Artifacts</th><th>Gaps</th></tr></thead><tbody>' + rows + "</tbody></table></div>";
  }

  /* ---------- actions ---------- */
  function runSkill(node) {
    var target = node.type === "skill" ? nodeById(node.produces) : node;
    if (!target) return;
    if (target.missing) { target.missing = false; target.version = 1; target.markdown = CANNED[target.id] || ("# " + target.title + "\n\nGenerated.\n"); }
    renderStages(); applyLens(state.lens);
    var chip = document.querySelector('[data-node="' + target.id + '"]');
    if (chip) { chip.classList.add("flash"); setTimeout(function () { chip.classList.remove("flash"); }, 1100); }
    openNode(target);
  }

  function openNode(node) {
    state.selected = node.id;
    if (node.type === "artifact") renderArtifact(node);
    else if (node.type === "skill") renderSkill(node);
    else if (node.metric === "readiness") renderReadiness();
    else renderDeliveryDashboard(node.title);
    document.querySelectorAll(".node").forEach(function (c) { c.style.outline = c.dataset.node === node.id ? "2px solid var(--accent)" : "none"; });
  }

  /* ---------- render map ---------- */
  function renderStages() {
    var wrap = $("#stages"); wrap.innerHTML = "";
    D.stages.forEach(function (s) {
      var col = el("div", "stage");
      col.appendChild(el("div", "stage-h", '<span class="sd ' + s.status + '"></span>' + s.name));
      col.appendChild(el("div", "stage-sub", s.status));
      var nodes = el("div", "nodes");
      s.nodes.forEach(function (n) {
        var meta = n.type === "artifact" ? (n.missing ? "missing" : "v" + n.version) : (n.type === "skill" ? "skill" : "metric");
        var chip = el("button", "node " + n.type + (n.missing ? " missing" : ""),
          '<span class="ic">' + icon(n.type) + '</span><span><span class="nt">' + n.title + '</span><br><span class="nm">' + meta + "</span></span>");
        chip.dataset.node = n.id;
        chip.onclick = function () { openNode(n); };
        nodes.appendChild(chip);
      });
      col.appendChild(nodes);
      wrap.appendChild(col);
    });
  }

  /* ---------- lens light-up ---------- */
  function applyLens(lens) {
    state.lens = lens;
    document.querySelectorAll(".lens").forEach(function (b) { b.classList.toggle("active", b.dataset.lens === lens); });
    $("#blurb").innerHTML = "<b>" + D.journeys[lens].persona + "</b> — " + D.journeys[lens].blurb;

    document.querySelectorAll(".node").forEach(function (chip) {
      var n = nodeById(chip.dataset.node);
      var lit = n.journeys.indexOf(lens) !== -1;
      chip.classList.toggle("lit", lit);
      chip.classList.toggle("dim", !lit);
    });
    // program lens: coverage badges on stage headers
    document.querySelectorAll(".stage").forEach(function (col, idx) {
      var s = D.stages[idx], h = col.querySelector(".stage-h"), old = h.querySelector(".cov");
      if (old) old.remove();
      if (lens === "program") {
        var arts = s.nodes.filter(function (n) { return n.type === "artifact"; });
        if (arts.length) {
          var have = arts.filter(function (n) { return !n.missing; }).length, gap = have < arts.length;
          h.appendChild(el("span", "cov" + (gap ? " gap" : ""), have + "/" + arts.length));
        }
      }
    });
  }

  function setLens(lens) {
    applyLens(lens);
    if (lens === "product") openNode(nodeById("prd"));
    else if (lens === "delivery") { state.selected = null; renderDeliveryDashboard("Delivery metrics"); }
    else renderProgramOverview();
  }

  /* ---------- guided tour ---------- */
  var TOUR = [
    { lens: "product", cap: "Meet <b>Atlas</b> — one product moving through its lifecycle. Three roles work the <b>same map</b>. Watch how it comes together." },
    { lens: "product", focus: "prd", cap: "<b>Product journey</b> (TPM): the PRD is generated in <b>Definition</b>, grounded in Jira &amp; Confluence context." },
    { lens: "product", run: "risks", cap: "Same journey — the <b>identify_risks</b> skill surfaces delivery &amp; technical risks as a new artifact on the map." },
    { lens: "product", focus: "roadmap", cap: "<b>Planning</b>: a milestone roadmap turns scope into a plan." },
    { lens: "delivery", dashboard: true, cap: "<b>Delivery journey</b> (Delivery Lead): the same product, now by the numbers — burndown shows the sprint is <b>+5 points behind</b>." },
    { lens: "program", overview: true, cap: "<b>Program journey</b> (Program Manager): zoom out — artifact coverage and gaps across <b>every stage</b>. Launch is missing its Release Notes." },
    { lens: "program", run: "release", cap: "One click runs the skill, <b>fills the gap</b>, and the map updates live — coverage turns green." },
    { lens: "program", overview: true, cap: "Everything comes back to <b>one product</b>. Three journeys, one map." },
  ];
  var tour = { i: -1, playing: false, timer: null, bar: null };

  function buildTourBar() {
    var b = el("div", null,
      '<span class="step" id="tStep"></span><span class="cap" id="tCap"></span>' +
      '<span class="ctrls">' +
        '<button id="tPrev" title="Previous">‹</button>' +
        '<button id="tPlay" class="primary" title="Play / pause">❚❚</button>' +
        '<button id="tNext" title="Next">›</button>' +
        '<button id="tStop" title="End tour">✕</button></span>');
    b.id = "tourbar";
    document.body.appendChild(b);
    b.querySelector("#tPrev").onclick = function () { go(tour.i - 1); };
    b.querySelector("#tNext").onclick = function () { tour.i >= TOUR.length - 1 ? stopTour() : go(tour.i + 1); };
    b.querySelector("#tPlay").onclick = function () { tour.playing = !tour.playing; updateBar(); schedule(); };
    b.querySelector("#tStop").onclick = stopTour;
    tour.bar = b;
  }
  function startTour() { if (!tour.bar) buildTourBar(); tour.bar.classList.add("on"); document.body.classList.add("touring"); tour.playing = true; go(0); }
  function stopTour() { if (tour.timer) clearTimeout(tour.timer); tour.playing = false; tour.i = -1; if (tour.bar) tour.bar.classList.remove("on"); document.body.classList.remove("touring"); setLens("product"); }
  function schedule() { if (tour.timer) clearTimeout(tour.timer); if (tour.playing && tour.i < TOUR.length - 1) tour.timer = setTimeout(function () { go(tour.i + 1); }, 5400); }
  function go(i) { if (i < 0 || i >= TOUR.length) return; runStep(i); schedule(); }
  function runStep(i) {
    tour.i = i; var s = TOUR[i];
    applyLens(s.lens);
    if (s.run) runSkill(nodeById(s.run));
    else if (s.dashboard) renderDeliveryDashboard("Delivery metrics");
    else if (s.overview) renderProgramOverview();
    else if (s.focus) openNode(nodeById(s.focus));
    else openNode(nodeById("prd"));
    var id = s.run || s.focus;
    if (id) { var chip = document.querySelector('[data-node="' + id + '"]'); if (chip) { chip.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" }); chip.classList.add("tour-spot"); setTimeout(function () { chip.classList.remove("tour-spot"); }, 1600); } }
    updateBar();
  }
  function updateBar() {
    if (!tour.bar || tour.i < 0) return;
    var s = TOUR[tour.i];
    tour.bar.querySelector("#tCap").innerHTML = s.cap;
    tour.bar.querySelector("#tStep").textContent = (tour.i + 1) + " / " + TOUR.length;
    tour.bar.querySelector("#tPrev").disabled = tour.i <= 0;
    tour.bar.querySelector("#tPlay").textContent = tour.playing ? "❚❚" : "▶";
    tour.bar.querySelector("#tNext").textContent = tour.i >= TOUR.length - 1 ? "Finish" : "›";
  }

  /* ---------- init ---------- */
  function init() {
    $("#hero").innerHTML = '<div style="font-size:22px;font-weight:800;letter-spacing:-.02em">' + D.product +
      ' <span style="color:var(--muted);font-weight:400;font-size:15px">· ' + D.tagline + "</span></div>";
    var row = $("#lensRow");
    row.appendChild(el("span", "lbl", "Journey"));
    LENSES.forEach(function (k) {
      var j = D.journeys[k];
      var b = el("button", "lens", "<b>" + j.label + "</b><small>" + j.persona + "</small>");
      b.dataset.lens = k;
      b.onclick = function () { setLens(k); };
      row.appendChild(b);
    });
    var tourBtn = el("button", "lens tour", "▶ Guided tour");
    tourBtn.onclick = startTour;
    row.appendChild(tourBtn);
    renderStages();
    setLens("product");
  }

  document.addEventListener("DOMContentLoaded", init);
})();
