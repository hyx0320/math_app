/*
  数竞智脑 Web Demo（静态原型）
  - 纯前端，无构建
  - 数据来自 data/users.json 与 data/problems.json
  - CDN 不可用时会自动降级（Markdown/图表/GeoGebra）
*/

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  /** @returns {string} */
  function hhmmss() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  /** @param {any} v */
  function safeString(v) {
    if (v == null) return "";
    return String(v);
  }

  /** @param {string} s */
  function escapeHtml(s) {
    return safeString(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#39;");
  }

  /** @param {string} text */
  function renderMarkdownToHtml(text) {
    const md = safeString(text);
    try {
      if (window.marked && typeof window.marked.parse === "function") {
        return window.marked.parse(md);
      }
    } catch {
      // ignore
    }
    return escapeHtml(md).replace(/\n/g, "<br>");
  }

  /** @param {HTMLElement} el */
  function tryRenderMath(el) {
    try {
      if (window.renderMathInElement && typeof window.renderMathInElement === "function") {
        window.renderMathInElement(el, {
          delimiters: [
            { left: "$$", right: "$$", display: true },
            { left: "\\(", right: "\\)", display: false },
            { left: "\\[", right: "\\]", display: true }
          ]
        });
      }
    } catch {
      // KaTeX 不可用则不渲染
    }
  }

  /**
   * @param {string} text
   * @returns {Promise<boolean>}
   */
  async function copyToClipboard(text) {
    const t = safeString(text);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(t);
        return true;
      }
    } catch {
      // fallback below
    }

    try {
      const ta = document.createElement("textarea");
      ta.value = t;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      ta.style.top = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      const ok = document.execCommand("copy");
      document.body.removeChild(ta);
      return ok;
    } catch {
      return false;
    }
  }

  /**
   * @param {string} msg
   * @param {{duration?: number}} [opt]
   */
  function toast(msg, opt = {}) {
    const el = $("toast");
    if (!el) return;
    el.textContent = safeString(msg);
    el.hidden = false;
    const duration = opt.duration ?? 2200;
    window.clearTimeout(toast._t);
    toast._t = window.setTimeout(() => {
      el.hidden = true;
    }, duration);
  }

  /** @type {{users:any[], problems:any[], currentUser:any|null, currentProblem:any|null, stepIndex:number, answerStepIndex:number, sessionActive:boolean, logs:any[], ggb:any, chart:any, initialDrawingApplied:boolean, uploadedImageName:string}} */
  const state = {
    users: [],
    problems: [],
    currentUser: null,
    currentProblem: null,
    stepIndex: 0,
    answerStepIndex: 0,
    sessionActive: false,
    logs: [],
    uploadedImageName: "",
    initialDrawingApplied: false,
    ggb: {
      available: false,
      ready: false,
      applet: null,
      commandCount: 0,
      pendingCommands: /** @type {string[]} */ ([]),
      allCommands: /** @type {string[]} */ ([])
    },
    chart: null
  };

  /**
   * @param {string} event_type
   * @param {any} payload
   * @param {boolean} [success]
   */
  function addLog(event_type, payload, success = true) {
    state.logs.unshift({
      ts: new Date().toISOString(),
      time: hhmmss(),
      event_type,
      payload,
      success
    });
    renderLogs();
  }

  function renderLogs() {
    const logsEl = $("logs");
    const metaEl = $("drawerMeta");
    if (!logsEl || !metaEl) return;

    const u = state.currentUser;
    const p = state.currentProblem;
    metaEl.textContent = `用户：${u ? u.name : "—"}（${u ? u.user_id : "—"}）  ·  题目：${p ? p.problem_id : "—"}`;

    logsEl.innerHTML = "";
    for (const item of state.logs.slice(0, 80)) {
      const div = document.createElement("div");
      div.className = "log-item";
      const top = document.createElement("div");
      top.className = "log-item__top";
      const left = document.createElement("div");
      left.className = "log-item__type";
      left.textContent = item.event_type;
      const right = document.createElement("div");
      right.textContent = item.time;
      top.appendChild(left);
      top.appendChild(right);

      const pre = document.createElement("div");
      pre.className = "log-item__payload";
      pre.textContent = (() => {
        try {
          return JSON.stringify(item.payload, null, 2);
        } catch {
          return safeString(item.payload);
        }
      })();

      div.appendChild(top);
      div.appendChild(pre);
      logsEl.appendChild(div);
    }
  }

  /** @param {boolean} open */
  function setDrawerOpen(open) {
    const overlay = $("drawerOverlay");
    const drawer = $("drawer");
    if (!overlay || !drawer) return;
    overlay.hidden = !open;
    drawer.classList.toggle("is-open", open);
    drawer.setAttribute("aria-hidden", open ? "false" : "true");
  }

  /** @param {string|null} modalId */
  function setModalOpen(modalId) {
    const overlay = $("modalOverlay");
    const modalLibrary = $("modalLibrary");
    const modalNew = $("modalNewProblem");
    if (!overlay || !modalLibrary || !modalNew) return;

    const open = Boolean(modalId);
    overlay.hidden = !open;
    modalLibrary.hidden = modalId !== "modalLibrary";
    modalNew.hidden = modalId !== "modalNewProblem";
  }

  function setChip(id, text) {
    const el = $(id);
    if (!el) return;
    el.textContent = safeString(text);
  }

  function updateStepper() {
    const el = $("stepper");
    if (!el) return;
    const total = state.currentProblem?.steps?.length ?? 0;
    const cur = Math.min(state.stepIndex, total);
    el.textContent = `Step ${cur}/${total}`;
  }

  /** @param {any} user */
  function isBasicUser(user) {
    if (!user) return true;
    const level = safeString(user.level);
    return level.includes("薄弱");
  }

  function currentVariant() {
    return isBasicUser(state.currentUser) ? "basic" : "advanced";
  }

  /** @param {any} user */
  function renderProfile(user) {
    const badge = $("profileLevelBadge");
    const card = $("profileCard");
    if (!badge || !card) return;

    if (!user) {
      badge.textContent = "—";
      card.innerHTML = "";
      return;
    }
    badge.textContent = safeString(user.level || "—");
    const rows = [
      ["姓名", user.name],
      ["学校", user.school],
      ["年级", user.grade],
      ["画像", user.level]
    ];
    card.innerHTML = "";
    for (const [k, v] of rows) {
      const div = document.createElement("div");
      div.className = "kv";
      div.innerHTML = `<span class="k">${escapeHtml(k)}</span><span class="v">${escapeHtml(
        safeString(v)
      )}</span>`;
      card.appendChild(div);
    }
  }

  /** @param {any} user */
  function renderTags(user) {
    const el = $("tags");
    if (!el) return;
    el.innerHTML = "";
    if (!user) return;

    const weak = Array.isArray(user.weak_tags) ? user.weak_tags : [];
    const strong = Array.isArray(user.strong_tags) ? user.strong_tags : [];

    for (const t of weak) {
      const span = document.createElement("span");
      span.className = "tag tag--weak";
      span.textContent = `薄弱：${t}`;
      el.appendChild(span);
    }
    for (const t of strong) {
      const span = document.createElement("span");
      span.className = "tag tag--strong";
      span.textContent = `优势：${t}`;
      el.appendChild(span);
    }
  }

  /** @param {any} user */
  function renderHistory(user) {
    const el = $("history");
    if (!el) return;
    el.innerHTML = "";
    if (!user) return;
    const history = Array.isArray(user.history) ? user.history : [];
    for (const it of history.slice(0, 10)) {
      const div = document.createElement("div");
      div.className = "history-item";
      const top = document.createElement("div");
      top.className = "history-item__top";
      top.innerHTML = `<span>${escapeHtml(safeString(it.date))}</span><span>${escapeHtml(
        safeString(it.topic)
      )}</span>`;
      const desc = document.createElement("div");
      desc.className = "history-item__desc";
      desc.textContent = safeString(it.result);
      div.appendChild(top);
      div.appendChild(desc);
      el.appendChild(div);
    }
  }

  /** @param {any} user */
  function renderRadar(user) {
    const canvas = $("radar");
    const fallback = $("radarFallback");
    const wrap = $("radarWrap");
    if (!canvas || !fallback || !wrap) return;

    const radar = user?.radar || {};
    const labels = Object.keys(radar);
    const data = labels.map((k) => radar[k]);

    // Chart.js 可用则画图，否则降级。
    if (window.Chart && typeof window.Chart === "function") {
      fallback.hidden = true;
      canvas.hidden = false;

      const cfg = {
        type: "radar",
        data: {
          labels,
          datasets: [
            {
              label: "能力画像",
              data,
              fill: true,
              backgroundColor: "rgba(43,108,176,0.18)",
              borderColor: "rgba(43,108,176,0.85)",
              pointBackgroundColor: "rgba(43,108,176,1)",
              pointRadius: 3
            }
          ]
        },
        options: {
          animation: { duration: 650 },
          scales: {
            r: {
              min: 0,
              max: 1,
              ticks: { display: false },
              grid: { color: "rgba(113,128,150,0.25)" },
              angleLines: { color: "rgba(113,128,150,0.25)" },
              pointLabels: {
                font: { size: 12, weight: "bold" },
                color: "rgba(26,32,44,0.9)"
              }
            }
          },
          plugins: {
            legend: { display: false }
          }
        }
      };

      if (!state.chart) {
        state.chart = new window.Chart(canvas, cfg);
      } else {
        state.chart.data.labels = labels;
        state.chart.data.datasets[0].data = data;
        state.chart.update();
      }
    } else {
      canvas.hidden = true;
      fallback.hidden = false;
      fallback.textContent = labels
        .map((k) => `${k}：${Math.round(radar[k] * 100)}%`)
        .join("\n");
    }
  }

  /** @param {number} delta @param {string} dim */
  function showRadarDelta(delta, dim) {
    const el = $("radarDelta");
    if (!el) return;
    el.textContent = `↑ ${delta > 0 ? "+" : ""}${delta.toFixed(2)}  ${dim}`;
    el.hidden = false;
    window.clearTimeout(showRadarDelta._t);
    showRadarDelta._t = window.setTimeout(() => {
      el.hidden = true;
    }, 1200);
  }

  /** @param {any} user @param {string} dim @param {number} delta */
  function bumpUserRadar(user, dim, delta) {
    if (!user) return;
    if (!user.radar) user.radar = {};
    const prev = Number(user.radar[dim] ?? 0);
    const next = Math.max(0, Math.min(1, prev + delta));
    user.radar[dim] = next;
    showRadarDelta(next - prev, dim);
    renderRadar(user);
  }

  /** @param {any} problem */
  function renderProblemHeader(problem) {
    const titleEl = $("problemTitle");
    const metaEl = $("problemMeta");
    if (!titleEl || !metaEl) return;
    if (!problem) {
      titleEl.textContent = "—";
      metaEl.textContent = "—";
      return;
    }
    titleEl.textContent = `${problem.problem_id} · ${problem.title}`;
    const topics = Array.isArray(problem.topics) ? problem.topics.join(" / ") : "—";
    metaEl.textContent = `${problem.difficulty || "—"} · ${topics}`;
  }

  function setCurrentUser(userId) {
    const user = state.users.find((u) => u.user_id === userId) || state.users[0] || null;
    state.currentUser = user;

    renderProfile(user);
    renderTags(user);
    renderHistory(user);
    renderRadar(user);

    setChip("chipProfile", user ? `画像：${user.user_id}` : "画像：—");
    addLog("PROFILE_READ", { user_id: userId }, true);
  }

  function setCurrentProblem(problemId) {
    const p =
      state.problems.find((x) => x.problem_id === problemId) || state.problems[0] || null;
    state.currentProblem = p;
    state.answerStepIndex = 0;
    renderProblemHeader(p);
    updateStepper();
    renderComparePanel();
    addLog("PROBLEM_LOAD", { problem_id: problemId }, true);
  }

  function renderUserSelect() {
    const sel = $("userSelect");
    if (!sel) return;
    sel.innerHTML = "";
    for (const u of state.users) {
      const opt = document.createElement("option");
      opt.value = u.user_id;
      opt.textContent = `${u.name}（${u.user_id}）`;
      sel.appendChild(opt);
    }
    if (state.currentUser) sel.value = state.currentUser.user_id;
  }

  /** @param {string} keyword */
  function renderProblemLibrary(keyword) {
    const list = $("problemList");
    if (!list) return;
    const kw = safeString(keyword).trim().toLowerCase();
    const problems = state.problems.filter((p) => {
      if (!kw) return true;
      const hay = `${p.problem_id} ${p.title} ${(p.topics || []).join(" ")}`.toLowerCase();
      return hay.includes(kw);
    });

    list.innerHTML = "";
    for (const p of problems) {
      const card = document.createElement("div");
      card.className = "problem-card";
      card.tabIndex = 0;
      card.innerHTML = `
        <div class="problem-card__title">${escapeHtml(`${p.problem_id} · ${p.title}`)}</div>
        <div class="problem-card__meta">${escapeHtml(
          `${p.difficulty || "—"} · ${(p.topics || []).join(" / ")}`
        )}</div>
      `;
      card.addEventListener("click", () => {
        setCurrentProblem(p.problem_id);
        setOcrText(p.ocr_text || "", { from: "library" });
        setModalOpen(null);
        toast("已载入演示题目");
      });
      card.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") card.click();
      });
      list.appendChild(card);
    }
  }

  /**
   * @param {string} text
   * @param {{from?: string}} [opt]
   */
  function setOcrText(text, opt = {}) {
    const ta = $("ocrText");
    const status = $("ocrStatus");
    const btn = $("btnStartTutoring");
    if (ta) ta.value = safeString(text);
    const ok = safeString(text).trim().length > 0;
    if (btn) btn.disabled = !ok;

    const from = opt.from || "manual";
    if (status) {
      status.textContent = ok
        ? from === "mock"
          ? "OCR：成功（Mock）"
          : from === "library"
            ? "OCR：题库文本已载入"
            : "OCR：文本已准备"
        : "OCR：未开始";
    }

    if (ok) {
      setChip("chipOCR", "OCR：成功");
    } else {
      setChip("chipOCR", "OCR：—");
    }
  }

  function removeUploadedImage() {
    const preview = $("uploadPreview");
    const fileInput = $("fileInput");
    const btnRemoveImage = $("btnRemoveImage");

    if (preview) {
      preview.removeAttribute("src");
      preview.style.display = "none";
    }
    if (fileInput) fileInput.value = "";
    if (btnRemoveImage) btnRemoveImage.hidden = true;

    state.uploadedImageName = "";
    const ta = $("ocrText");
    setOcrText(safeString(ta?.value), { from: "manual" });
    addLog("OCR_UPLOAD_REMOVED", {}, true);
    toast("已删除上传图片");
  }

  function clearChatAndWhiteboard() {
    const chat = $("chat");
    const wb = $("whiteboard");
    if (chat) chat.innerHTML = "";
    if (wb) wb.innerHTML = "";
    state.answerStepIndex = 0;
  }

  function clearWhiteboardOnly() {
    const wb = $("whiteboard");
    if (wb) wb.innerHTML = "";
    state.answerStepIndex = 0;
  }

  /**
   * @param {"system"|"user"} role
   * @param {string} content
   * @param {{pill?: string, step?: string, citations?: any[]}} [meta]
   */
  function appendChat(role, content, meta = {}) {
    const chat = $("chat");
    if (!chat) return;
    const msg = document.createElement("div");
    msg.className = `msg msg--${role}`;

    const bubble = document.createElement("div");
    bubble.className = "bubble";

    const metaDiv = document.createElement("div");
    metaDiv.className = "bubble__meta";
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.textContent = meta.pill || (role === "user" ? "学生" : "系统");

    const step = document.createElement("span");
    step.textContent = meta.step || hhmmss();
    const time = document.createElement("span");
    time.textContent = hhmmss();
    metaDiv.appendChild(pill);
    metaDiv.appendChild(step);
    metaDiv.appendChild(time);

    const body = document.createElement("div");
    body.className = "bubble__content";
    body.innerHTML = renderMarkdownToHtml(content);

    bubble.appendChild(metaDiv);
    bubble.appendChild(body);

    if (Array.isArray(meta.citations) && meta.citations.length > 0) {
      const cite = document.createElement("div");
      cite.className = "bubble__citations";
      cite.innerHTML = `<div><b>引用/来源</b></div>`;
      for (const c of meta.citations) {
        const line = document.createElement("span");
        line.className = "cite";
        const p = c.page ? `p.${c.page}` : "";
        line.textContent = `· ${c.title || "资料"} ${p}`.trim();
        cite.appendChild(line);
      }
      bubble.appendChild(cite);
    }

    msg.appendChild(bubble);
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;

    tryRenderMath(bubble);
  }

  /** @param {string} line */
  function appendWhiteboard(line) {
    const wb = $("whiteboard");
    if (!wb) return;
    const div = document.createElement("div");
    div.className = "wb-line";
    div.textContent = safeString(line);
    wb.appendChild(div);
    wb.scrollTop = wb.scrollHeight;
  }

  function updateCommandsPanel() {
    const pre = $("commandsBody");
    if (!pre) return;
    pre.textContent = state.ggb.allCommands.join("\n");
  }

  function revealOneAnswerStep() {
    if (!state.sessionActive) startSession();
    if (!state.sessionActive) return;

    const p = state.currentProblem;
    const total = p?.steps?.length ?? 0;
    if (!p || total === 0) {
      toast("当前题目暂无分步答案");
      return;
    }

    if (state.answerStepIndex >= total) {
      toast("答案已全部显示");
      return;
    }

    const stepObj = p.steps[state.answerStepIndex];
    const variant = currentVariant();
    const wbLine = stepObj?.whiteboard?.[variant] || stepObj?.whiteboard?.basic || "";

    if (wbLine) appendWhiteboard(wbLine);

    const commands =
      state.answerStepIndex === 0 && state.initialDrawingApplied
        ? []
        : Array.isArray(stepObj?.drawing_commands)
          ? stepObj.drawing_commands
          : [];
    applyDrawingCommands(commands);

    state.answerStepIndex += 1;
  }

  /** @param {string[]} commands */
  function applyDrawingCommands(commands) {
    const list = Array.isArray(commands) ? commands.filter(Boolean) : [];
    if (list.length === 0) return;

    state.ggb.allCommands.push(...list);
    state.ggb.commandCount += list.length;
    setChip("chipDraw", `画图：${state.ggb.commandCount} commands`);
    updateCommandsPanel();
    addLog("DRAW_COMMANDS", { count: list.length, commands: list }, true);

    // GeoGebra 可用则执行，否则只展示命令列表。
    if (state.ggb.ready && state.ggb.applet && typeof state.ggb.applet.evalCommand === "function") {
      for (const cmd of list) {
        try {
          state.ggb.applet.evalCommand(cmd);
        } catch (e) {
          addLog("DRAW_COMMAND_FAIL", { cmd, error: safeString(e) }, false);
        }
      }
      const ph = $("ggbPlaceholder");
      if (ph) ph.hidden = true;
    } else {
      state.ggb.pendingCommands.push(...list);
      // 降级：展示命令面板
      const commandsPanel = $("commandsPanel");
      if (commandsPanel) commandsPanel.hidden = false;
    }
  }

  function resetDrawing() {
    state.ggb.commandCount = 0;
    state.ggb.pendingCommands = [];
    state.ggb.allCommands = [];
    updateCommandsPanel();
    setChip("chipDraw", state.ggb.ready ? "画图：就绪" : "画图：—");
    const ph = $("ggbPlaceholder");
    if (ph) ph.hidden = false;
    try {
      if (state.ggb.ready && state.ggb.applet && typeof state.ggb.applet.reset === "function") {
        state.ggb.applet.reset();
      }
    } catch {
      // ignore
    }
    addLog("DRAW_RESET", {}, true);
  }

  function renderComparePanel() {
    const panel = $("comparePanel");
    const body = $("compareBody");
    const toggle = $("toggleCompareMode");
    if (!panel || !body || !toggle) return;
    const open = Boolean(toggle.checked);
    panel.hidden = !open;

    const p = state.currentProblem;
    if (p && Array.isArray(p.compare_answer_lines)) {
      body.textContent = p.compare_answer_lines.join("\n");
    } else {
      body.textContent = "（无对比内容）";
    }
  }

  function startSession() {
    const ta = $("ocrText");
    const txt = ta ? safeString(ta.value).trim() : "";
    if (!txt) {
      toast("请先准备题目文本（OCR 或题库载入）");
      return;
    }
    state.sessionActive = true;
    state.stepIndex = 0;
    state.answerStepIndex = 0;
    state.initialDrawingApplied = false;
    clearChatAndWhiteboard();
    resetDrawing();

    const initialCommands = Array.isArray(state.currentProblem?.steps?.[0]?.drawing_commands)
      ? state.currentProblem.steps[0].drawing_commands
      : [];
    if (initialCommands.length > 0) {
      applyDrawingCommands(initialCommands);
      state.initialDrawingApplied = true;
    }

    updateStepper();

    appendChat(
      "system",
      "已开始辅导：我会严格分步输出。请点击下方提示按钮（L0/L1/L2/L3）获取下一步。",
      { pill: "会话", step: "Session" }
    );

    // 模拟“检索就绪”与“画像已读取”
    setChip("chipRAG", "检索：—");
    setChip("chipProfile", state.currentUser ? `画像：${state.currentUser.user_id}` : "画像：—");
    addLog("SESSION_START", { text_len: txt.length }, true);
  }

  /** @param {string} hintLevel */
  function produceOneStep(hintLevel) {
    if (!state.sessionActive) startSession();
    if (!state.sessionActive) return;

    const p = state.currentProblem;
    const total = p?.steps?.length ?? 0;

    if (!p || total === 0) {
      appendChat(
        "system",
        "当前为自定义题目（Demo 简化）：请优先使用【演示题库】载入带分步数据的题目。",
        { pill: hintLevel, step: "—" }
      );
      return;
    }

    if (state.stepIndex >= total) {
      appendChat(
        "system",
        "已到本题最后一步。你可以：1) 开启【对比模式】看直出；2) 切换用户 A/B 观察提示差异；3) 切换到下一题。",
        { pill: "完成", step: `Step ${total}/${total}` }
      );
      toast("已到最后一步");
      return;
    }

    const stepObj = p.steps[state.stepIndex];
    const variant = currentVariant();

    const hint =
      stepObj?.hints?.[variant]?.[hintLevel] ||
      stepObj?.hints?.basic?.[hintLevel] ||
      "（暂无该层级提示）";

    const wbLine = stepObj?.whiteboard?.[variant] || stepObj?.whiteboard?.basic || "";
    const citations = Array.isArray(stepObj?.citations) ? stepObj.citations : [];
    const commands =
      state.stepIndex === 0 && state.initialDrawingApplied
        ? []
        : Array.isArray(stepObj?.drawing_commands)
          ? stepObj.drawing_commands
          : [];

    // 1) 对话
    appendChat("system", hint, {
      pill: hintLevel,
      step: `Step ${state.stepIndex + 1}/${total}`,
      citations
    });

    // 2) RAG（演示）
    if (citations.length > 0) {
      setChip("chipRAG", `检索：${citations.length} 引用`);
      addLog("RAG_CITATIONS", { count: citations.length }, true);
    }

    // 3) 画图
    applyDrawingCommands(commands);

    // 4) 画像更新（演示：每一步微幅提升对应维度）
    const topics = Array.isArray(p.topics) ? p.topics : [];
    const dim = topics.includes("平面几何")
      ? "平面几何"
      : topics.includes("数论")
        ? "数论"
        : topics.includes("组合数学")
          ? "组合数学"
          : "代数变形";
    bumpUserRadar(state.currentUser, dim, 0.03);
    addLog("PROFILE_WRITE", { reason: "STEP_PROGRESS", dim, delta: 0.03 }, true);

    state.stepIndex += 1;
    updateStepper();
  }

  function handleAttemptSubmit() {
    const ta = $("attemptText");
    if (!ta) return;
    const attempt = safeString(ta.value).trim();
    if (!attempt) {
      toast("请先输入你的尝试/思路");
      return;
    }

    appendChat("user", attempt, { pill: "我的尝试", step: "纠错" });
    ta.value = "";

    // Mock 诊断
    const p = state.currentProblem;
    const topics = Array.isArray(p?.topics) ? p.topics : [];
    const dim = topics.includes("平面几何")
      ? "平面几何"
      : topics.includes("数论")
        ? "数论"
        : topics.includes("组合数学")
          ? "组合数学"
          : "代数变形";

    const diagnosis =
      "**错因诊断（Mock）：**\n\n" +
      "- 你当前的思路可能‘跳步’过快，缺少把题设信息明确转化为定理/结构的那一步。\n" +
      "- 建议先写出【目标】与【已知】，再选择一个最短判定路径（例如：共圆判定/平方展开/构造）。\n\n" +
      "接下来请点击 **L0 / L1** 重新对齐题型与关键定理。";

    appendChat("system", diagnosis, { pill: "MISTAKE_DIAG", step: "纠错" });
    addLog("MISTAKE_DIAG", { attempt_len: attempt.length }, true);

    // 纠错后给较明显的提升动画
    bumpUserRadar(state.currentUser, dim, 0.12);
    addLog("PROFILE_WRITE", { reason: "MISTAKE_CORRECT", dim, delta: 0.12 }, true);
  }

  async function initGeoGebra() {
    const ph = $("ggbPlaceholder");
    if (ph) ph.hidden = false;

    // 允许 CDN 慢加载：等待一会儿。
    const start = Date.now();
    while (Date.now() - start < 1800) {
      if (window.GGBApplet && typeof window.GGBApplet === "function") break;
      await new Promise((r) => setTimeout(r, 60));
    }

    if (!window.GGBApplet || typeof window.GGBApplet !== "function") {
      state.ggb.available = false;
      state.ggb.ready = false;
      setChip("chipDraw", "画图：命令演示");
      addLog("GGB_UNAVAILABLE", { reason: "CDN_OFFLINE_OR_BLOCKED" }, false);
      return;
    }

    // 定义回调：GeoGebra 初始化完成后会调用
    window.ggbAppletOnInit = function () {
      state.ggb.available = true;
      state.ggb.ready = true;
      // GeoGebra 注入后会创建同名全局变量
      state.ggb.applet = window.ggbApplet;
      setChip("chipDraw", "画图：就绪");
      addLog("GGB_READY", {}, true);

      const placeholder = $("ggbPlaceholder");
      if (placeholder) placeholder.hidden = true;

      // flush pending
      if (state.ggb.pendingCommands.length > 0) {
        const cmds = [...state.ggb.pendingCommands];
        state.ggb.pendingCommands = [];
        applyDrawingCommands(cmds);
      }
    };

    try {
      const params = {
        id: "ggbApplet",
        appName: "geometry",
        showToolBar: false,
        showAlgebraInput: false,
        showMenuBar: false,
        showZoomButtons: true,
        enableShiftDragZoom: true,
        enableRightClick: false,
        errorDialogsActive: false,
        useBrowserForJS: true
      };
      const applet = new window.GGBApplet(params, true);
      applet.inject("ggbAppletTarget");
      addLog("GGB_INJECT", { ok: true }, true);
    } catch (e) {
      state.ggb.available = false;
      state.ggb.ready = false;
      setChip("chipDraw", "画图：命令演示");
      addLog("GGB_INJECT_FAIL", { error: safeString(e) }, false);
    }
  }

  /** @param {string} url @param {any} fallback */
  async function fetchJson(url, fallback) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      addLog("FETCH_FAIL", { url, error: safeString(e) }, false);
      return fallback;
    }
  }

  async function init() {
    // --- bind events ---
    const sel = $("userSelect");
    if (sel) {
      sel.addEventListener("change", () => {
        setCurrentUser(sel.value);
        toast("已切换用户画像");
      });
    }

    const toggleDemo = $("toggleDemoMode");
    if (toggleDemo) {
      toggleDemo.addEventListener("change", () => {
        document.body.classList.toggle("demo-mode", toggleDemo.checked);
      });
    }

    const toggleCompare = $("toggleCompareMode");
    if (toggleCompare) {
      toggleCompare.addEventListener("change", () => {
        renderComparePanel();
      });
    }

    const btnOpenLogs = $("btnOpenLogs");
    if (btnOpenLogs) btnOpenLogs.addEventListener("click", () => setDrawerOpen(true));
    const btnCloseLogs = $("btnCloseLogs");
    if (btnCloseLogs) btnCloseLogs.addEventListener("click", () => setDrawerOpen(false));
    const drawerOverlay = $("drawerOverlay");
    if (drawerOverlay) drawerOverlay.addEventListener("click", () => setDrawerOpen(false));

    const btnLibrary = $("btnProblemLibrary");
    if (btnLibrary) btnLibrary.addEventListener("click", () => setModalOpen("modalLibrary"));
    const btnCloseLibrary = $("btnCloseLibrary");
    if (btnCloseLibrary) btnCloseLibrary.addEventListener("click", () => setModalOpen(null));

    const btnNew = $("btnNewProblem");
    if (btnNew) btnNew.addEventListener("click", () => setModalOpen("modalNewProblem"));
    const btnCloseNew = $("btnCloseNewProblem");
    if (btnCloseNew) btnCloseNew.addEventListener("click", () => setModalOpen(null));

    const modalOverlay = $("modalOverlay");
    if (modalOverlay) modalOverlay.addEventListener("click", () => setModalOpen(null));

    const problemSearch = $("problemSearch");
    if (problemSearch) {
      problemSearch.addEventListener("input", () => {
        renderProblemLibrary(problemSearch.value);
      });
    }

    const btnFocusUpload = $("btnFocusUpload");
    if (btnFocusUpload) {
      btnFocusUpload.addEventListener("click", () => {
        setModalOpen(null);
        const upload = $("uploadArea");
        if (upload) upload.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }

    const uploadArea = $("uploadArea");
    const fileInput = $("fileInput");
    const btnChooseFile = $("btnChooseFile");
    const btnUploadImage = $("btnUploadImage");
    const btnVoiceInput = $("btnVoiceInput");
    if (btnChooseFile && fileInput) btnChooseFile.addEventListener("click", () => fileInput.click());
    if (btnUploadImage && fileInput)
      btnUploadImage.addEventListener("click", () => fileInput.click());
    if (btnVoiceInput) {
      btnVoiceInput.addEventListener("click", () => {
        startVoiceInput();
      });
    }
    if (uploadArea && fileInput) {
      uploadArea.addEventListener("click", () => fileInput.click());
      uploadArea.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") fileInput.click();
      });
      uploadArea.addEventListener("dragover", (ev) => {
        ev.preventDefault();
      });
      uploadArea.addEventListener("drop", (ev) => {
        ev.preventDefault();
        const f = ev.dataTransfer?.files?.[0];
        if (f) handleFile(f);
      });
      fileInput.addEventListener("change", () => {
        const f = fileInput.files?.[0];
        if (f) handleFile(f);
      });
    }

    const ta = $("ocrText");
    if (ta) {
      ta.addEventListener("input", () => {
        setOcrText(ta.value, { from: "manual" });
      });
    }

    const btnMockOCR = $("btnMockOCR");
    if (btnMockOCR) {
      btnMockOCR.addEventListener("click", () => {
        const p = state.currentProblem || state.problems[0];
        if (!p) return;
        setOcrText(p.ocr_text || "", { from: "mock" });
        toast("Mock OCR 完成");
        addLog("OCR_SUCCESS", { mock: true }, true);
      });
    }

    const btnRemoveImage = $("btnRemoveImage");
    if (btnRemoveImage) {
      btnRemoveImage.addEventListener("click", () => {
        removeUploadedImage();
      });
    }

    const btnStart = $("btnStartTutoring");
    if (btnStart) btnStart.addEventListener("click", () => startSession());

    const btnClearChat = $("btnClearChat");
    if (btnClearChat)
      btnClearChat.addEventListener("click", () => {
        clearChatAndWhiteboard();
        toast("已清空");
      });

    const btnAttempt = $("btnSubmitAttempt");
    if (btnAttempt) btnAttempt.addEventListener("click", () => handleAttemptSubmit());

    // Hint buttons
    const bindHint = (id, level) => {
      const b = $(id);
      if (!b) return;
      b.addEventListener("click", () => {
        produceOneStep(level);
      });
    };
    bindHint("btnHintL0", "L0");
    bindHint("btnHintL1", "L1");
    bindHint("btnHintL2", "L2");
    bindHint("btnHintL3", "L3");
    bindHint("btnStuck", "L0");

    const btnShowAnswer = $("btnShowAnswer");
    if (btnShowAnswer) {
      btnShowAnswer.addEventListener("click", () => {
        revealOneAnswerStep();
      });
    }

    const btnClearWhiteboard = $("btnClearWhiteboard");
    if (btnClearWhiteboard) {
      btnClearWhiteboard.addEventListener("click", () => {
        clearWhiteboardOnly();
        toast("已清空答案区");
      });
    }

    const btnResetDrawing = $("btnResetDrawing");
    if (btnResetDrawing) btnResetDrawing.addEventListener("click", () => resetDrawing());
    const btnShowCommands = $("btnShowCommands");
    if (btnShowCommands) {
      btnShowCommands.addEventListener("click", () => {
        const panel = $("commandsPanel");
        if (!panel) return;
        panel.hidden = !panel.hidden;
      });
    }
    const btnCopyCommands = $("btnCopyCommands");
    if (btnCopyCommands) {
      btnCopyCommands.addEventListener("click", async () => {
        const ok = await copyToClipboard(state.ggb.allCommands.join("\n"));
        toast(ok ? "已复制命令" : "复制失败");
      });
    }
    const btnCopyWhiteboard = $("btnCopyWhiteboard");
    if (btnCopyWhiteboard) {
      btnCopyWhiteboard.addEventListener("click", async () => {
        const wb = $("whiteboard");
        const text = wb
          ? Array.from(wb.querySelectorAll(".wb-line"))
              .map((x) => x.textContent || "")
              .join("\n")
          : "";
        const ok = await copyToClipboard(text);
        toast(ok ? "已复制白板" : "复制失败");
      });
    }

    // --- load data ---
    const fallbackUsers = [
      {
        user_id: "A",
        name: "A同学",
        school: "示例中学",
        grade: "高二竞赛生",
        level: "几何薄弱 · 代数较强",
        radar: {
          代数变形: 0.7,
          平面几何: 0.4,
          组合数学: 0.5,
          数论: 0.5,
          逻辑推理: 0.6
        },
        weak_tags: ["圆周角定理"],
        strong_tags: ["代数计算"],
        history: []
      }
    ];

    const fallbackProblems = [
      {
        problem_id: "DEMO-001",
        title: "示例题（离线降级）",
        difficulty: "—",
        topics: ["平面几何"],
        ocr_text: "（离线降级）请用【演示题库】载入题目。",
        compare_answer_lines: ["（无）"],
        steps: []
      }
    ];

    state.users = await fetchJson("data/users.json", fallbackUsers);
    state.problems = await fetchJson("data/problems.json", fallbackProblems);

    renderUserSelect();
    setCurrentUser(state.users[0]?.user_id);
    setCurrentProblem(state.problems[0]?.problem_id);

    renderProblemLibrary("");
    updateStepper();

    // 初始 chips
    setChip("chipOCR", "OCR：—");
    setChip("chipRAG", "检索：—");
    setChip("chipDraw", "画图：—");
    setChip("chipProfile", state.currentUser ? `画像：${state.currentUser.user_id}` : "画像：—");

    // 初始 OCR 文本填充（来自题库首题，便于直接演示）
    if (state.currentProblem?.ocr_text) {
      setOcrText(state.currentProblem.ocr_text, { from: "library" });
    }

    addLog("INIT", {
      marked: Boolean(window.marked),
      chart: Boolean(window.Chart),
      katex: Boolean(window.renderMathInElement),
      geogebra: Boolean(window.GGBApplet)
    });

    initGeoGebra();
  }

  /** @param {File} file */
  function handleFile(file) {
    const preview = $("uploadPreview");
    const status = $("ocrStatus");
    const btnRemoveImage = $("btnRemoveImage");
    if (status) status.textContent = `OCR：已上传（${file.name}）`;
    if (btnRemoveImage) btnRemoveImage.hidden = false;
    setChip("chipOCR", "OCR：已上传");
    state.uploadedImageName = safeString(file.name);
    addLog("OCR_UPLOAD", { name: file.name, size: file.size, type: file.type }, true);

    try {
      const reader = new FileReader();
      reader.onload = () => {
        if (preview) {
          preview.src = safeString(reader.result);
          preview.style.display = "block";
        }
      };
      reader.readAsDataURL(file);
    } catch {
      // ignore
    }
  }

  function startVoiceInput() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      toast("当前浏览器不支持语音输入");
      addLog("VOICE_UNSUPPORTED", { ua: navigator.userAgent }, false);
      return;
    }

    let recognition;
    try {
      recognition = new SpeechRecognition();
    } catch (e) {
      toast("语音输入初始化失败");
      addLog("VOICE_INIT_FAIL", { error: safeString(e) }, false);
      return;
    }

    recognition.lang = "zh-CN";
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;

    setChip("chipOCR", "OCR：语音中");
    toast("请开始说话…");
    addLog("VOICE_START", { lang: recognition.lang }, true);

    recognition.onresult = (event) => {
      const text = safeString(event.results?.[0]?.[0]?.transcript).trim();
      if (!text) return;

      const ta = $("ocrText");
      const current = safeString(ta?.value).trim();
      const merged = current ? `${current}\n${text}` : text;
      setOcrText(merged, { from: "manual" });
      toast("语音已转文字");
      addLog("VOICE_SUCCESS", { text_length: text.length }, true);
    };

    recognition.onerror = (event) => {
      toast("语音识别失败");
      const hasText = safeString($("ocrText")?.value).trim().length > 0;
      setChip("chipOCR", hasText ? "OCR：成功" : "OCR：—");
      addLog("VOICE_FAIL", { error: safeString(event.error) }, false);
    };

    recognition.onend = () => {
      const hasText = safeString($("ocrText")?.value).trim().length > 0;
      setChip("chipOCR", hasText ? "OCR：成功" : "OCR：—");
    };

    recognition.start();
  }

  // 启动
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
