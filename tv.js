// ─────────────────────────────────────────────
// PHEM Staff Assignments — TV Read-Only Dashboard
// Separate page. Does NOT modify the working edit board.
// Auto-refresh: every 10 minutes
// Rotation: staff pages → announcements → QR → shifts → repeat
// ─────────────────────────────────────────────

const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const AUTO_REFRESH_MS = 10 * 60 * 1000;

const STAFF_PER_PAGE = 10;

const BOARD_VIEW_MS = 32 * 1000;
const ANNOUNCEMENT_VIEW_MS = 14 * 1000;
const QR_VIEW_MS = 16 * 1000;
const SHIFTS_VIEW_MS = 18 * 1000;

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

let currentBoardPage = 0;
let currentScreen = "board";

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", async () => {
  renderLegend();
  startClock();
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
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric" });
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

function getTotalBoardPages() {
  return Math.max(1, Math.ceil(staff.length / STAFF_PER_PAGE));
}

function getStaffForCurrentPage() {
  const start = currentBoardPage * STAFF_PER_PAGE;
  return staff.slice(start, start + STAFF_PER_PAGE);
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

  const ann = document.getElementById("announcementRefreshLabel");
  if (ann) ann.textContent = message;
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

    const totalPages = getTotalBoardPages();

    if (currentBoardPage >= totalPages) {
      currentBoardPage = 0;
    }

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

  const start = currentBoardPage * STAFF_PER_PAGE + 1;
  const end = Math.min(staff.length, (currentBoardPage + 1) * STAFF_PER_PAGE);

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
    document.documentElement.style.setProperty("--staff-count", 1);

    body.innerHTML = `
      <tr>
        <td colspan="8" class="loading-cell">No staff loaded</td>
      </tr>
    `;
    return;
  }

  const pageStaff = getStaffForCurrentPage();
  document.documentElement.style.setProperty("--staff-count", Math.max(pageStaff.length, 1));

  body.innerHTML = pageStaff.map(s => {
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
