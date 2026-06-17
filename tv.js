// ─────────────────────────────────────────────
// PHEM Staff Assignments — TV Read-Only Dashboard
// Separate page. Does NOT modify the working edit board.
// Auto-refresh: every 10 minutes by default
// Dynamic pagination: automatically pushes staff to next page if they do not fit
// Rotation: staff pages → announcements → QR → shifts → repeat
// Assignment chips are colored by ACTION, not staff/unit
// ─────────────────────────────────────────────

const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

// Change this for TV refresh timing.
// 10 minutes: 10 * 60 * 1000
// 2 minutes:  2 * 60 * 1000
// 1 minute:   1 * 60 * 1000
const AUTO_REFRESH_MS = 10 * 60 * 1000;

const BOARD_VIEW_MS = 32 * 1000;
const ANNOUNCEMENT_VIEW_MS = 14 * 1000;
const QR_VIEW_MS = 16 * 1000;
const SHIFTS_VIEW_MS = 18 * 1000;

const UNITS = [
  { id: "BW SD Driver",  label: "San Diego Driver",          color: "#236092", bg: "#EAF6FA" },
  { id: "BW SC Driver",  label: "Soutcoast Driver",          color: "#FFA300", bg: "#FFF7E6" },
  { id: "Biowatch",      label: "Biowatch",                  color: "#05C3DE", bg: "#E6F9FC" },
  { id: "Logistics",     label: "Logistics",                 color: "#7B4FBF", bg: "#F3EEFF" },
  { id: "Logistics WH",  label: "Warehouse",                 color: "#E03C31", bg: "#FFF0EF" },
  { id: "Logistics GS",  label: "Logistics Ground Support",  color: "#008B8B", bg: "#E6F5F5" },
  { id: "admin",         label: "Admin / Other",             color: "#6D7378", bg: "#F7FAFC" }
];

// Colors now mean ACTION / STATUS, not staff unit.
const ACTION_COLORS = [
  { id: "unavailable", label: "Unavailable / Leave / Off", color: "#E03C31", bg: "#FFF0EF" },
  { id: "driving", label: "Driving / Delivery", color: "#236092", bg: "#EAF6FA" },
  { id: "biowatch", label: "BioWatch", color: "#05C3DE", bg: "#E6F9FC" },
  { id: "warehouse", label: "Warehouse Floor", color: "#FFA300", bg: "#FFF7E6" },
  { id: "training", label: "Training", color: "#7B4FBF", bg: "#F3EEFF" },
  { id: "meeting", label: "Meeting / Admin", color: "#6D7378", bg: "#F7FAFC" },
  { id: "tv", label: "TV Screen Deployment", color: "#008B8B", bg: "#E6F5F5" },
  { id: "remote", label: "Remote / WFH", color: "#3aaa35", bg: "#EEF9EF" },
  { id: "other", label: "Other Assignment", color: "#002138", bg: "#F7FAFC" }
];

let staff = [];
let assignments = {};
let tvData = {
  messages: [],
  events: [],
  birthdays: [],
  shifts: []
};

let weekStart = getMondayOfWeek(new Date());
let autoRefreshTimer = null;
let rotationTimer = null;
let clockTimer = null;
let resizeTimer = null;

let staffPages = [];
let currentBoardPage = 0;
let currentScreen = "board";

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  renderLegend();
  startClock();

  window.addEventListener("resize", handleResize);

  await loadData();
  startAutoRefresh();
  startPageRotation();
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function unitMeta(id) {
  return UNITS.find(u => u.id === id) || UNITS[6];
}

function actionMeta(role, location) {
  const text = `${role || ""} ${location || ""}`.toLowerCase();

  if (
    text.includes("unavailable") ||
    text.includes("leave") ||
    text.includes("off")
  ) {
    return ACTION_COLORS[0];
  }

  if (
    text.includes("driving") ||
    text.includes("driver") ||
    text.includes("pickup") ||
    text.includes("delivery") ||
    text.includes("fleet") ||
    text.includes("vehicle") ||
    text.includes("san diego") ||
    text.includes("riverside") ||
    text.includes("pasadena") ||
    text.includes("orange county") ||
    text.includes("san bernardino")
  ) {
    return ACTION_COLORS[1];
  }

  if (
    text.includes("biowatch") ||
    text.includes("bio watch")
  ) {
    return ACTION_COLORS[2];
  }

  if (
    text.includes("warehouse") ||
    text.includes("worsham warehouse") ||
    text.includes("warehouse floor")
  ) {
    return ACTION_COLORS[3];
  }

  if (text.includes("training")) {
    return ACTION_COLORS[4];
  }

  if (
    text.includes("meeting") ||
    text.includes("administrative") ||
    text.includes("admin") ||
    text.includes("office")
  ) {
    return ACTION_COLORS[5];
  }

  if (
    text.includes("tv screen") ||
    text.includes("screen deployment")
  ) {
    return ACTION_COLORS[6];
  }

  if (
    text.includes("remote") ||
    text.includes("wfh")
  ) {
    return ACTION_COLORS[7];
  }

  return ACTION_COLORS[8];
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

function fmtMonthDayFromISO(iso) {
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
}

function fmtBirthday(month, day) {
  const d = new Date(new Date().getFullYear(), Number(month) - 1, Number(day));
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
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

function getMaxAssignmentsForStaffInWeek(staffId) {
  const days = getWeekDays();
  let max = 0;

  days.forEach(day => {
    const count = getAssignmentsForStaffDay(staffId, fmtISO(day)).length;
    if (count > max) max = count;
  });

  return max;
}

function setRefreshLabel(message) {
  const el = document.getElementById("refreshLabel");
  if (el) el.textContent = message;

  const ann = document.getElementById("announcementRefreshLabel");
  if (ann) ann.textContent = message;
}

// ─────────────────────────────────────────────
// Dynamic pagination
// ─────────────────────────────────────────────

function getAvailableBoardHeight() {
  const wrap = document.querySelector(".tv-board-wrap");
  const thead = document.querySelector(".tv-board thead");

  if (!wrap || !thead) {
    return 700;
  }

  const wrapHeight = wrap.clientHeight || 700;
  const headHeight = thead.offsetHeight || 25;

  return Math.max(250, wrapHeight - headHeight - 10);
}

function estimateRowHeight(staffId) {
  const maxAssignments = getMaxAssignmentsForStaffInWeek(staffId);

  if (maxAssignments <= 0) {
    return 54;
  }

  const chipHeight = 39;
  const gap = 3;
  const cellPadding = 10;
  const staffPadding = 4;

  const assignmentHeight =
    (maxAssignments * chipHeight) +
    ((maxAssignments - 1) * gap) +
    cellPadding +
    staffPadding;

  return Math.max(62, assignmentHeight);
}

function buildStaffPages() {
  const availableHeight = getAvailableBoardHeight();

  const pages = [];
  let currentPage = [];
  let currentHeight = 0;

  staff.forEach(s => {
    let rowHeight = estimateRowHeight(s.id);

    rowHeight = Math.min(rowHeight, availableHeight);

    const rowPackage = {
      staff: s,
      rowHeight
    };

    const wouldOverflow = currentPage.length > 0 && currentHeight + rowHeight > availableHeight;

    if (wouldOverflow) {
      pages.push(currentPage);
      currentPage = [rowPackage];
      currentHeight = rowHeight;
    } else {
      currentPage.push(rowPackage);
      currentHeight += rowHeight;
    }
  });

  if (currentPage.length > 0) {
    pages.push(currentPage);
  }

  staffPages = pages.length ? pages : [[]];

  if (currentBoardPage >= staffPages.length) {
    currentBoardPage = 0;
  }
}

function getTotalBoardPages() {
  return Math.max(1, staffPages.length);
}

function getStaffForCurrentPage() {
  return staffPages[currentBoardPage] || [];
}

function handleResize() {
  clearTimeout(resizeTimer);

  resizeTimer = setTimeout(() => {
    buildStaffPages();
    renderBoardPageLabel();
    renderBoard();
  }, 250);
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
    tvData = data.tv || { messages: [], events: [], birthdays: [], shifts: [] };

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
// Page rotation
// ─────────────────────────────────────────────

function startPageRotation() {
  if (rotationTimer) {
    clearTimeout(rotationTimer);
  }

  currentBoardPage = 0;
  showBoardPage();

  rotationTimer = setTimeout(rotateNext, BOARD_VIEW_MS);
}

function rotateNext() {
  const totalPages = getTotalBoardPages();

  if (currentScreen === "board") {
    if (currentBoardPage < totalPages - 1) {
      currentBoardPage++;
      showBoardPage();
      rotationTimer = setTimeout(rotateNext, BOARD_VIEW_MS);
      return;
    }

    showAnnouncementPage();
    rotationTimer = setTimeout(rotateNext, ANNOUNCEMENT_VIEW_MS);
    return;
  }

  if (currentScreen === "announcements") {
    showQrPage();
    rotationTimer = setTimeout(rotateNext, QR_VIEW_MS);
    return;
  }

  if (currentScreen === "qr") {
    showShiftsPage();
    rotationTimer = setTimeout(rotateNext, SHIFTS_VIEW_MS);
    return;
  }

  if (currentScreen === "shifts") {
    currentBoardPage = 0;
    showBoardPage();
    rotationTimer = setTimeout(rotateNext, BOARD_VIEW_MS);
    return;
  }
}

function setActivePage(pageId) {
  ["boardPage", "announcementPage", "qrPage", "shiftsPage"].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("active-page", id === pageId);
  });
}

function showBoardPage() {
  currentScreen = "board";
  setActivePage("boardPage");

  buildStaffPages();
  renderBoard();
  renderBoardPageLabel();
}

function showAnnouncementPage() {
  currentScreen = "announcements";
  setActivePage("announcementPage");

  renderAnnouncements();
}

function showQrPage() {
  currentScreen = "qr";
  setActivePage("qrPage");
}

function showShiftsPage() {
  currentScreen = "shifts";
  setActivePage("shiftsPage");

  renderShifts();
}

function renderBoardPageLabel() {
  const el = document.getElementById("boardPageLabel");
  if (!el) return;

  const totalPages = getTotalBoardPages();

  if (totalPages <= 1) {
    el.textContent = `Staff Board · ${staff.length} Staff`;
    return;
  }

  let start = 1;
  for (let i = 0; i < currentBoardPage; i++) {
    start += staffPages[i].length;
  }

  const end = start + (staffPages[currentBoardPage]?.length || 0) - 1;

  el.textContent = `Staff Page ${currentBoardPage + 1} of ${totalPages} · ${start}–${end} of ${staff.length}`;
}

// ─────────────────────────────────────────────
// Clock
// ─────────────────────────────────────────────

function startClock() {
  updateClock();

  if (clockTimer) {
    clearInterval(clockTimer);
  }

  clockTimer = setInterval(updateClock, 1000);
}

function updateClock() {
  const el = document.getElementById("announcementClock");
  if (!el) return;

  el.textContent = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit"
  });
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function render() {
  renderWeek();
  buildStaffPages();
  renderStats();
  renderBoardPageLabel();
  renderBoard();
  renderAnnouncements();
  renderShifts();
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
      <div style="font-size:0.74em;opacity:0.68;margin-top:0;">${fmtDate(day)}</div>
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

  legend.innerHTML = ACTION_COLORS.map(a => `
    <div class="tv-legend-item">
      <span class="tv-legend-dot" style="background:${a.color}"></span>
      <span>${escapeHtml(a.label)}</span>
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

  const pageRows = getStaffForCurrentPage();

  body.innerHTML = pageRows.map(row => {
    const s = row.staff;
    const rowHeight = row.rowHeight;
    const u = unitMeta(s.unit);

    return `
      <tr style="--row-height:${rowHeight}px">
        <td class="tv-staff-cell" style="--row-height:${rowHeight}px">
          <div class="tv-staff-inner">
            <div class="tv-unit-bar" style="background:#D9E2EC"></div>
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
            <td class="${isToday(day) ? "today-cell" : ""}" style="--row-height:${rowHeight}px">
              ${renderAssignmentCell(dayAssignments)}
            </td>
          `;
        }).join("")}
      </tr>
    `;
  }).join("");
}

function renderAssignmentCell(dayAssignments) {
  if (!dayAssignments.length) {
    return `<div class="tv-empty"></div>`;
  }

  const maxVisible = 3;
  const visible = dayAssignments.slice(0, maxVisible);
  const hiddenCount = dayAssignments.length - visible.length;

  return `
    <div class="tv-cell-stack">
      ${visible.map(a => {
        const action = actionMeta(a.role, a.location);

        return `
          <div class="tv-assignment" style="background:${action.bg};border-left-color:${action.color};color:${action.color}">
            <div class="tv-assignment-role">${escapeHtml(a.role || "—")}</div>
            <div class="tv-assignment-loc">${escapeHtml(a.location || "—")}</div>
            ${a.note ? `<div class="tv-assignment-note">${escapeHtml(a.note)}</div>` : ""}
          </div>
        `;
      }).join("")}

      ${hiddenCount > 0 ? `
        <div class="tv-more">+${hiddenCount} more</div>
      ` : ""}
    </div>
  `;
}

// ─────────────────────────────────────────────
// Announcements
// ─────────────────────────────────────────────

function renderAnnouncements() {
  renderMessageOfDay();
  renderEvents();
  renderBirthdays();
}

function renderMessageOfDay() {
  const el = document.getElementById("messageOfDay");
  if (!el) return;

  const messages = tvData.messages || [];

  if (!messages.length) {
    el.textContent = "No active message posted.";
    return;
  }

  el.textContent = messages[0].message || "No active message posted.";
}

function renderEvents() {
  const el = document.getElementById("eventsList");
  if (!el) return;

  const now = new Date();
  const month = now.getMonth() + 1;

  const events = (tvData.events || [])
    .filter(e => {
      const d = new Date(String(e.date) + "T00:00:00");
      if (isNaN(d.getTime())) return true;
      return d.getMonth() + 1 === month;
    })
    .slice(0, 8);

  if (!events.length) {
    el.innerHTML = `<div class="announcement-empty">No upcoming events posted this month.</div>`;
    return;
  }

  el.innerHTML = events.map(e => `
    <div class="announcement-item">
      <div class="announcement-date">${escapeHtml(fmtMonthDayFromISO(e.date))}</div>
      <div class="announcement-text">${escapeHtml(e.title)}</div>
    </div>
  `).join("");
}

function renderBirthdays() {
  const el = document.getElementById("birthdaysList");
  if (!el) return;

  const month = new Date().getMonth() + 1;

  const birthdays = (tvData.birthdays || [])
    .filter(b => Number(b.month) === month)
    .slice(0, 10);

  if (!birthdays.length) {
    el.innerHTML = `<div class="announcement-empty">No birthdays posted this month.</div>`;
    return;
  }

  el.innerHTML = birthdays.map(b => `
    <div class="announcement-item" style="border-left-color:#FFA300">
      <div class="announcement-date">${escapeHtml(fmtBirthday(b.month, b.day))}</div>
      <div class="announcement-text">${escapeHtml(b.name)}</div>
    </div>
  `).join("");
}

// ─────────────────────────────────────────────
// Shifts
// ─────────────────────────────────────────────

function renderShifts() {
  const el = document.getElementById("shiftsList");
  if (!el) return;

  const shifts = (tvData.shifts || []).slice(0, 8);

  if (!shifts.length) {
    el.innerHTML = `<div class="shifts-empty">No active shifts posted. Contact Joselyn.Delosreyes@longbeach.gov for current needs.</div>`;
    return;
  }

  el.innerHTML = shifts.map(s => `
    <div class="shift-card">
      <div class="shift-date">${escapeHtml(fmtMonthDayFromISO(s.date))} · ${escapeHtml(s.shift)}</div>
      <div class="shift-title">${escapeHtml(s.assignment)}</div>
      <div class="shift-meta">${escapeHtml(s.location || "Location TBD")}</div>
      ${s.spots ? `<div class="shift-spots">${escapeHtml(s.spots)} spot(s) available</div>` : ""}
    </div>
  `).join("");
}

// ─────────────────────────────────────────────
// Error
// ─────────────────────────────────────────────

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
