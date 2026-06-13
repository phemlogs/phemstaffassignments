// ─────────────────────────────────────────────
// PHEM Staff Assignments — TV Read-Only Dashboard
// Separate page. Does NOT modify the working edit board.
// URL: https://phemlogs.github.io/phemstaffassignments/tv.html
// Auto-refresh: every 10 minutes
// ─────────────────────────────────────────────

const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const AUTO_REFRESH_MS = 10 * 60 * 1000;

const UNITS = [
  { id: "BW SD Driver",  label: "San Diego Driver",          color: "#236092", bg: "#EAF6FA" },
  { id: "BW SC Driver",  label: "Southcoast Driver",         color: "#FFA300", bg: "#FFF7E6" },
  { id: "Biowatch",      label: "Biowatch",                  color: "#05C3DE", bg: "#E6F9FC" },
  { id: "Logistics",     label: "Logistics",                 color: "#7B4FBF", bg: "#F3EEFF" },
  { id: "Logistics WH",  label: "Warehouse",                 color: "#E03C31", bg: "#FFF0EF" },
  { id: "Logistics GS",  label: "Logistics Ground Support",  color: "#008B8B", bg: "#E6F5F5" },
  { id: "admin",         label: "Admin / Other",             color: "#6D7378", bg: "#F7FAFC" }
];

let staff = [];
let assignments = {};
let weekStart = getMondayOfWeek(new Date());
let autoRefreshTimer = null;

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  renderLegend();
  await loadData();
  startAutoRefresh();
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function unitMeta(id) {
  return UNITS.find(u => u.id === id) || UNITS[6];
}

function getMondayOfWeek(date) {
  const d = new Date(date);
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtISO(d) {
  return d.toISOString().slice(0, 10);
}

function isToday(d) {
  return d.toDateString() === new Date().toDateString();
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeDateValue(value) {
  if (!value) return "";

  const str = String(value).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  const parsed = new Date(str);

  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return str;
}

function getWeekDays() {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function getAssignmentsForStaffDay(staffId, isoDate) {
  return Object.entries(assignments)
    .map(([key, value]) => ({
      key,
      ...value,
      date: normalizeDateValue(value.date)
    }))
    .filter(a => String(a.staffId) === String(staffId) && String(a.date) === String(isoDate))
    .sort((a, b) => {
      const an = a.note || "";
      const bn = b.note || "";
      return an.localeCompare(bn);
    });
}

function setRefreshLabel(message) {
  const el = document.getElementById("refreshLabel");
  if (el) el.textContent = message;
}

// ─────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────

async function apiLoad() {
  if (!SCRIPT_URL || SCRIPT_URL.includes("YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")) {
    throw new Error("Missing Apps Script URL in config.js");
  }

  const res = await fetch(SCRIPT_URL);

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }

  const data = await res.json();

  if (!data.ok) {
    throw new Error(data.error || "Load failed");
  }

  return data;
}

async function loadData() {
  try {
    setRefreshLabel("Loading data…");

    const data = await apiLoad();

    staff = data.staff || [];
    assignments = data.assignments || {};

    document.documentElement.style.setProperty("--staff-count", Math.max(staff.length, 1));

    render();

    setRefreshLabel(`Last updated ${new Date().toLocaleTimeString()}`);

  } catch (err) {
    setRefreshLabel(`Load error: ${err.message}`);
    renderError(err.message);
  }
}

function startAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
  }

  autoRefreshTimer = setInterval(loadData, AUTO_REFRESH_MS);
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function render() {
  renderWeek();
  renderStats();
  renderBoard();
}

function renderWeek() {
  const days = getWeekDays();

  document.getElementById("weekLabel").textContent =
    `Week of ${fmtDate(days[0])} – ${fmtDate(days[6])}`;

  days.forEach((day, i) => {
    const th = document.getElementById(`day${i}`);
    if (!th) return;

    th.className = isToday(day) ? "today" : "";
    th.innerHTML = `
      <div>${DAY_SHORT[i]}</div>
      <div style="font-size:0.78em;opacity:0.68;margin-top:1px;">${fmtDate(day)}</div>
    `;
  });
}

function renderStats() {
  const weekDays = getWeekDays();

  let assignmentCount = 0;
  let openDays = 0;

  staff.forEach(s => {
    weekDays.forEach(day => {
      const count = getAssignmentsForStaffDay(s.id, fmtISO(day)).length;
      assignmentCount += count;
      if (count === 0) openDays++;
    });
  });

  document.getElementById("statStaff").textContent = staff.length;
  document.getElementById("statAssigned").textContent = assignmentCount;
  document.getElementById("statOpen").textContent = openDays;
}

function renderLegend() {
  const legend = document.getElementById("legend");

  if (!legend) return;

  legend.innerHTML = UNITS.map(u => `
    <div class="tv-legend-item">
      <span class="tv-legend-dot" style="background:${u.color}"></span>
      <span>${escapeHtml(u.label)}</span>
    </div>
  `).join("");
}

function renderBoard() {
  const body = document.getElementById("boardBody");
  const weekDays = getWeekDays();

  if (!body) return;

  if (!staff.length) {
    body.innerHTML = `
      <tr>
        <td colspan="8" class="loading-cell">No staff loaded</td>
      </tr>
    `;
    return;
  }

  body.innerHTML = staff.map(s => {
    const u = unitMeta(s.unit);

    return `
      <tr>
        <td class="tv-staff-cell">
          <div class="tv-staff-inner">
            <div class="tv-unit-bar" style="background:${u.color}"></div>
            <div class="tv-staff-text">
              <div class="tv-staff-name">${escapeHtml(s.name)}</div>
              <div class="tv-staff-unit">${escapeHtml(u.label)}</div>
            </div>
          </div>
        </td>

        ${weekDays.map(day => {
          const iso = fmtISO(day);
          const dayAssignments = getAssignmentsForStaffDay(s.id, iso);

          return `
            <td class="${isToday(day) ? "today-cell" : ""}">
              ${renderAssignmentCell(dayAssignments, u)}
            </td>
          `;
        }).join("")}
      </tr>
    `;
  }).join("");
}

function renderAssignmentCell(dayAssignments, unit) {
  if (!dayAssignments.length) {
    return `<div class="tv-empty"></div>`;
  }

  const maxVisible = 3;
  const visible = dayAssignments.slice(0, maxVisible);
  const hiddenCount = dayAssignments.length - visible.length;

  return `
    <div class="tv-cell-stack">
      ${visible.map(a => `
        <div class="tv-assignment" style="background:${unit.bg};border-left-color:${unit.color};color:${unit.color}">
          <div class="tv-assignment-role">${escapeHtml(a.role || "—")}</div>
          <div class="tv-assignment-loc">${escapeHtml(a.location || "—")}</div>
          ${a.note ? `<div class="tv-assignment-note">${escapeHtml(a.note)}</div>` : ""}
        </div>
      `).join("")}

      ${hiddenCount > 0 ? `
        <div class="tv-more">+${hiddenCount} more</div>
      ` : ""}
    </div>
  `;
}

function renderError(message) {
  const body = document.getElementById("boardBody");

  if (!body) return;

  body.innerHTML = `
    <tr>
      <td colspan="8" class="loading-cell">
        TV board load error: ${escapeHtml(message)}
      </td>
    </tr>
  `;
}
