// ─────────────────────────────────────────────
// PHEM Staff Assignments
// Plain GitHub Pages frontend
// Matches current index.html IDs
// Uses Claude-style Apps Script backend
// ─────────────────────────────────────────────

const DAY_SHORT = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const UNITS = [
  { id: "epi",       label: "Epidemiology",        color: "#236092", bg: "#EAF6FA" },
  { id: "biowatch",  label: "Biowatch",            color: "#FFA300", bg: "#FFF7E6" },
  { id: "vaccines",  label: "Vaccines",            color: "#05C3DE", bg: "#E6F9FC" },
  { id: "lab",       label: "Public Health Lab",   color: "#7B4FBF", bg: "#F3EEFF" },
  { id: "warehouse", label: "Emergency Warehouse", color: "#E03C31", bg: "#FFF0EF" },
  { id: "narcan",    label: "Narcan Distribution", color: "#008B8B", bg: "#E6F5F5" },
  { id: "admin",     label: "Admin / Other",       color: "#6D7378", bg: "#F7FAFC" }
];

const LOCATIONS = [
  "Worsham Warehouse",
  "Office",
  "EOC",
  "Field",
  "San Diego",
  "Pasadena",
  "FIFA Event Site",
  "Convention Center",
  "Mobile Screen Deployment",
  "Remote / WFH",
  "Leave / Off"
];

const ROLES = [
  "San Diego Route",
  "FIFA Screen Deployment",
  "Warehouse Receiving",
  "Inventory / Sortly",
  "BioWatch",
  "Narcan Distribution",
  "Pickup / Delivery",
  "Fleet / Vehicle Support",
  "Training",
  "Meeting",
  "Leave",
  "Unavailable",
  "Other"
];

let staff = [];
let assignments = {};
let weekStart = getMondayOfWeek(new Date());
let isEditMode = false;
let managerPin = "";
let savingKeys = new Set();
let activeAssignment = null;
let pinDigits = "";

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function unitMeta(id) {
  return UNITS.find(u => u.id === id) || UNITS[6];
}

function makeId() {
  return Math.random().toString(36).slice(2, 9);
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

function assignKey(staffId, date) {
  return `${staffId}__${fmtISO(date)}`;
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getWeekDays() {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

function setStatus(type, msg) {
  const bar = document.getElementById("statusBar");
  if (!bar) return;

  bar.className = `status-bar ${type}`;

  let icon = "";
  if (type === "loading") icon = "⟳ ";
  if (type === "saving") icon = "● ";
  if (type === "saved") icon = "✓ ";
  if (type === "error") icon = "⚠ ";

  bar.textContent = icon + msg;
}

// ─────────────────────────────────────────────
// API — Claude backend compatible
// ─────────────────────────────────────────────

async function apiLoad() {
  if (!SCRIPT_URL || SCRIPT_URL.includes("YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")) {
    throw new Error("Missing Apps Script URL in config.js");
  }

  // IMPORTANT:
  // Do NOT send action=load.
  // Claude's original Apps Script doGet() just loads data.
  const res = await fetch(SCRIPT_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Load failed");

  return data;
}

async function apiPost(payload) {
  const res = await fetch(SCRIPT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=utf-8"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const data = await res.json();
  if (!data.ok) throw new Error(data.error || "Save failed");

  return data;
}

async function apiSetAssignment(pin, key, staffId, date, location, role, note) {
  return apiPost({
    action: "setAssignment",
    pin,
    key,
    staffId,
    date,
    location,
    role,
    note
  });
}

async function apiAddStaff(pin, staffData) {
  return apiPost({
    action: "addStaff",
    pin,
    staff: staffData
  });
}

async function apiRemoveStaff(pin, staffId) {
  return apiPost({
    action: "removeStaff",
    pin,
    staffId
  });
}

// ─────────────────────────────────────────────
// Startup
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bindButtons();
  populateDropdowns();
  renderLegend();
  buildPinPad();
  loadData();
});

function bindButtons() {
  document.getElementById("prevWeekBtn").addEventListener("click", () => {
    weekStart = addDays(weekStart, -7);
    render();
  });

  document.getElementById("nextWeekBtn").addEventListener("click", () => {
    weekStart = addDays(weekStart, 7);
    render();
  });

  document.getElementById("todayBtn").addEventListener("click", () => {
    weekStart = getMondayOfWeek(new Date());
    render();
  });

  document.getElementById("refreshBtn").addEventListener("click", loadData);

  document.getElementById("managerLoginBtn").addEventListener("click", openPinOverlay);
  document.getElementById("lockBtn").addEventListener("click", exitEditMode);
  document.getElementById("closePinBtn").addEventListener("click", closePinOverlay);

  document.getElementById("addStaffToggle").addEventListener("click", showAddStaffForm);
  document.getElementById("cancelAddStaffBtn").addEventListener("click", hideAddStaffForm);
  document.getElementById("addStaffBtn").addEventListener("click", handleAddStaff);

  document.getElementById("closeAssignmentBtn").addEventListener("click", closeAssignmentOverlay);
  document.getElementById("cancelAssignmentBtn").addEventListener("click", closeAssignmentOverlay);
  document.getElementById("saveAssignmentBtn").addEventListener("click", saveAssignment);
  document.getElementById("clearAssignmentBtn").addEventListener("click", clearAssignment);

  document.getElementById("assignmentOverlay").addEventListener("click", e => {
    if (e.target.id === "assignmentOverlay") closeAssignmentOverlay();
  });

  document.getElementById("pinOverlay").addEventListener("click", e => {
    if (e.target.id === "pinOverlay") closePinOverlay();
  });
}

// ─────────────────────────────────────────────
// Data
// ─────────────────────────────────────────────

async function loadData() {
  setStatus("loading", "Loading board data…");

  try {
    const data = await apiLoad();
    staff = data.staff || [];
    assignments = data.assignments || {};
    setStatus("ok", `Last loaded ${new Date().toLocaleTimeString()}`);
    render();
  } catch (err) {
    setStatus("error", `Load error: ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// Render
// ─────────────────────────────────────────────

function render() {
  renderStats();
  renderWeekLabel();
  renderStaffList();
  renderGrid();
  renderEditState();
}

function renderStats() {
  const weekDays = getWeekDays();
  const totalSlots = staff.length * 7;

  let filledSlots = 0;

  weekDays.forEach(day => {
    staff.forEach(s => {
      if (assignments[assignKey(s.id, day)]) filledSlots++;
    });
  });

  document.getElementById("statStaff").textContent = staff.length;
  document.getElementById("statAssigned").textContent = filledSlots;
  document.getElementById("statOpen").textContent = totalSlots - filledSlots;
  document.getElementById("staffHeader").textContent = `Staff (${staff.length})`;
}

function renderWeekLabel() {
  const days = getWeekDays();
  document.getElementById("weekLabel").textContent =
    `Week of ${fmtDate(days[0])} – ${fmtDate(days[6])}`;
}

function renderLegend() {
  const legend = document.getElementById("legend");

  legend.innerHTML = UNITS.map(u => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${u.color}"></span>
      ${escapeHtml(u.label)}
    </span>
  `).join("") + `
    <span class="edit-hint hidden" id="editHint">// click any cell to assign</span>
  `;
}

function renderStaffList() {
  const staffList = document.getElementById("staffList");

  staffList.innerHTML = staff.map(s => {
    const u = unitMeta(s.unit);

    return `
      <div class="staff-row ${isEditMode ? "clickable" : ""}">
        <div class="unit-bar" style="background:${u.color}"></div>
        <div style="flex:1;min-width:0">
          <div class="staff-name">${escapeHtml(s.name)}</div>
          <div class="staff-unit-tag">${escapeHtml(u.label)}</div>
        </div>
        ${isEditMode ? `
          <button class="staff-remove" data-staff-id="${escapeHtml(s.id)}" data-staff-name="${escapeHtml(s.name)}">×</button>
        ` : ""}
      </div>
    `;
  }).join("");

  document.querySelectorAll(".staff-remove").forEach(btn => {
    btn.addEventListener("click", e => {
      e.stopPropagation();
      handleRemoveStaff(btn.dataset.staffId, btn.dataset.staffName);
    });
  });
}

function renderGrid() {
  const gridHeader = document.getElementById("gridHeader");
  const gridBody = document.getElementById("gridBody");
  const gridTable = document.getElementById("gridTable");
  const loadingMessage = document.getElementById("loadingMessage");

  const weekDays = getWeekDays();

  if (!staff.length) {
    loadingMessage.classList.remove("hidden");
    loadingMessage.textContent = "// No staff loaded yet. Use Manager Login → Add Staff.";
    gridTable.classList.add("hidden");
    return;
  }

  loadingMessage.classList.add("hidden");
  gridTable.classList.remove("hidden");

  gridHeader.innerHTML = weekDays.map((day, i) => `
    <th class="${isToday(day) ? "today" : ""}">
      ${DAY_SHORT[i]}
      <span class="th-date">${fmtDate(day)}</span>
    </th>
  `).join("");

  gridBody.innerHTML = staff.map(s => `
    <tr>
      ${weekDays.map(day => {
        const key = assignKey(s.id, day);
        const asgn = assignments[key];
        const u = unitMeta(s.unit);
        const saving = savingKeys.has(key);

        if (asgn) {
          return `
            <td class="${isToday(day) ? "today-col" : ""} ${isEditMode ? "editable" : ""}"
                data-staff-id="${escapeHtml(s.id)}"
                data-date="${fmtISO(day)}">
              <div class="assignment-chip ${saving ? "saving" : ""}"
                   style="background:${u.bg};border-left:3px solid ${u.color}">
                <div class="chip-role" style="color:${u.color}">${escapeHtml(asgn.role || "—")}</div>
                <div class="chip-location" style="color:${u.color}">${escapeHtml(asgn.location || "—")}</div>
                <div class="chip-note" style="color:${u.color}">${escapeHtml(asgn.note || "")}</div>
              </div>
            </td>
          `;
        }

        return `
          <td class="${isToday(day) ? "today-col" : ""} ${isEditMode ? "editable" : ""}"
              data-staff-id="${escapeHtml(s.id)}"
              data-date="${fmtISO(day)}">
            <div class="empty-cell">
              ${isEditMode ? `<span class="empty-cell-plus">+</span>` : ""}
            </div>
          </td>
        `;
      }).join("")}
    </tr>
  `).join("");

  document.querySelectorAll("#gridBody td").forEach(cell => {
    cell.addEventListener("click", () => {
      if (!isEditMode) return;
      openAssignmentOverlay(cell.dataset.staffId, cell.dataset.date);
    });
  });
}

function renderEditState() {
  const modeBadge = document.getElementById("modeBadge");
  const managerLoginBtn = document.getElementById("managerLoginBtn");
  const lockBtn = document.getElementById("lockBtn");
  const sidebarAdd = document.getElementById("sidebarAdd");
  const editHint = document.getElementById("editHint");

  if (isEditMode) {
    modeBadge.textContent = "✎ Edit Mode";
    modeBadge.className = "mode-badge edit";
    managerLoginBtn.classList.add("hidden");
    lockBtn.classList.remove("hidden");
    sidebarAdd.classList.remove("hidden");
    editHint?.classList.remove("hidden");
  } else {
    modeBadge.textContent = "👁 View Only";
    modeBadge.className = "mode-badge view";
    managerLoginBtn.classList.remove("hidden");
    lockBtn.classList.add("hidden");
    sidebarAdd.classList.add("hidden");
    editHint?.classList.add("hidden");
    hideAddStaffForm();
  }
}

// ─────────────────────────────────────────────
// Dropdowns
// ─────────────────────────────────────────────

function populateDropdowns() {
  const newStaffUnit = document.getElementById("newStaffUnit");
  const modalLocation = document.getElementById("modalLocation");
  const modalRole = document.getElementById("modalRole");

  newStaffUnit.innerHTML = UNITS.map(u =>
    `<option value="${escapeHtml(u.id)}">${escapeHtml(u.label)}</option>`
  ).join("");

  modalLocation.innerHTML = `<option value="">— Select location —</option>` +
    LOCATIONS.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");

  modalRole.innerHTML = `<option value="">— Select role/task —</option>` +
    ROLES.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
}

// ─────────────────────────────────────────────
// PIN
// ─────────────────────────────────────────────

function buildPinPad() {
  const dots = document.getElementById("pinDots");
  const keypad = document.getElementById("pinKeypad");

  dots.innerHTML = [0, 1, 2, 3].map(() => `<div class="pin-dot"></div>`).join("");

  keypad.innerHTML = `
    ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n =>
      `<button class="pin-key" data-pin="${n}">${n}</button>`
    ).join("")}
    <div></div>
    <button class="pin-key" data-pin="0">0</button>
    <button class="pin-key" id="pinDeleteBtn" style="font-size:14px">⌫</button>
  `;

  document.querySelectorAll("[data-pin]").forEach(btn => {
    btn.addEventListener("click", () => pinPress(btn.dataset.pin));
  });

  document.getElementById("pinDeleteBtn").addEventListener("click", pinDelete);
}

function openPinOverlay() {
  pinDigits = "";
  updatePinDots();
  document.getElementById("pinError").textContent = "";
  document.getElementById("pinOverlay").classList.remove("hidden");
}

function closePinOverlay() {
  document.getElementById("pinOverlay").classList.add("hidden");
  pinDigits = "";
  updatePinDots();
}

function pinPress(num) {
  if (pinDigits.length >= 4) return;

  pinDigits += String(num);
  updatePinDots();

  if (pinDigits.length === 4) {
    setTimeout(() => {
      managerPin = pinDigits;
      isEditMode = true;
      closePinOverlay();
      render();
    }, 120);
  }
}

function pinDelete() {
  pinDigits = pinDigits.slice(0, -1);
  updatePinDots();
}

function updatePinDots() {
  document.querySelectorAll(".pin-dot").forEach((dot, i) => {
    dot.classList.toggle("filled", pinDigits.length > i);
    dot.classList.remove("error");
  });
}

function exitEditMode() {
  isEditMode = false;
  managerPin = "";
  render();
}

// ─────────────────────────────────────────────
// Staff
// ─────────────────────────────────────────────

function showAddStaffForm() {
  document.getElementById("addStaffToggle").classList.add("hidden");
  document.getElementById("addStaffForm").classList.remove("hidden");
  document.getElementById("newStaffName").focus();
}

function hideAddStaffForm() {
  const toggle = document.getElementById("addStaffToggle");
  const form = document.getElementById("addStaffForm");

  if (toggle) toggle.classList.remove("hidden");
  if (form) form.classList.add("hidden");

  const name = document.getElementById("newStaffName");
  const unit = document.getElementById("newStaffUnit");

  if (name) name.value = "";
  if (unit) unit.value = "warehouse";
}

async function handleAddStaff() {
  const name = document.getElementById("newStaffName").value.trim();
  const unit = document.getElementById("newStaffUnit").value;

  if (!name) return;

  const s = {
    id: makeId(),
    name,
    unit,
    active: true
  };

  staff.push(s);
  hideAddStaffForm();
  render();

  setStatus("saving", "Adding staff…");

  try {
    await apiAddStaff(managerPin, s);
    setStatus("saved", `${name} added`);
    await loadData();
  } catch (err) {
    setStatus("error", `Add failed: ${err.message}`);
    await loadData();
  }
}

async function handleRemoveStaff(id, name) {
  if (!confirm(`Remove ${name} from the board?`)) return;

  staff = staff.filter(s => s.id !== id);
  render();

  setStatus("saving", `Removing ${name}…`);

  try {
    await apiRemoveStaff(managerPin, id);
    setStatus("saved", `${name} removed`);
    await loadData();
  } catch (err) {
    setStatus("error", `Remove failed: ${err.message}`);
    await loadData();
  }
}

// ─────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────

function openAssignmentOverlay(staffId, isoDate) {
  const s = staff.find(x => x.id === staffId);
  if (!s) return;

  const day = new Date(isoDate + "T00:00:00");
  const key = `${staffId}__${isoDate}`;
  const existing = assignments[key];

  activeAssignment = {
    staffId,
    staffName: s.name,
    day,
    key
  };

  document.getElementById("modalStaffName").textContent = s.name;
  document.getElementById("modalDate").textContent = `${fmtDate(day)} · ${isoDate}`;

  document.getElementById("modalLocation").value = existing?.location || "";
  document.getElementById("modalRole").value = existing?.role || "";
  document.getElementById("modalNote").value = existing?.note || "";

  document.getElementById("clearAssignmentBtn").classList.toggle("hidden", !existing);
  document.getElementById("assignmentOverlay").classList.remove("hidden");
}

function closeAssignmentOverlay() {
  document.getElementById("assignmentOverlay").classList.add("hidden");
  activeAssignment = null;
}

async function saveAssignment() {
  if (!activeAssignment) return;

  const location = document.getElementById("modalLocation").value;
  const role = document.getElementById("modalRole").value;
  const note = document.getElementById("modalNote").value;

  const { staffId, day, key } = activeAssignment;

  closeAssignmentOverlay();

  if (!location && !role && !note) {
    delete assignments[key];
  } else {
    assignments[key] = {
      staffId,
      date: fmtISO(day),
      location,
      role,
      note
    };
  }

  savingKeys.add(key);
  render();

  setStatus("saving", "Saving…");

  try {
    await apiSetAssignment(managerPin, key, staffId, fmtISO(day), location, role, note);
    savingKeys.delete(key);
    setStatus("saved", `Saved · ${new Date().toLocaleTimeString()}`);
    await loadData();
  } catch (err) {
    savingKeys.delete(key);
    setStatus("error", `Save failed: ${err.message}`);

    if (err.message === "Invalid PIN") {
      exitEditMode();
    }

    await loadData();
  }
}

async function clearAssignment() {
  if (!activeAssignment) return;

  const { staffId, day, key } = activeAssignment;

  closeAssignmentOverlay();

  delete assignments[key];
  savingKeys.add(key);
  render();

  setStatus("saving", "Clearing…");

  try {
    await apiSetAssignment(managerPin, key, staffId, fmtISO(day), "", "", "");
    savingKeys.delete(key);
    setStatus("saved", `Cleared · ${new Date().toLocaleTimeString()}`);
    await loadData();
  } catch (err) {
    savingKeys.delete(key);
    setStatus("error", `Clear failed: ${err.message}`);
    await loadData();
  }
}
