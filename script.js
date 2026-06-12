// ─────────────────────────────────────────────
// HE-CDER Staff Operations Board
// Plain GitHub Pages frontend
// ─────────────────────────────────────────────

const DAY_SHORT = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

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
let activeModal = null;

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
  d.setHours(0,0,0,0);
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

function setStatus(type, msg) {
  const el = document.getElementById("statusBar");
  if (!el) return;

  el.className = `status-bar ${type}`;

  let icon = "";
  if (type === "loading") icon = "⟳ ";
  if (type === "saving") icon = "● ";
  if (type === "saved") icon = "✓ ";
  if (type === "error") icon = "⚠ ";

  el.textContent = icon + msg;
}

function getWeekDays() {
  return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
}

// ─────────────────────────────────────────────
// JSONP API
// ─────────────────────────────────────────────

function jsonp(params = {}) {
  return new Promise((resolve, reject) => {
    if (!SCRIPT_URL || SCRIPT_URL.includes("YOUR_APPS_SCRIPT_WEB_APP_URL_HERE")) {
      reject(new Error("Missing Apps Script URL in config.js"));
      return;
    }

    const callbackName = "jsonp_cb_" + Math.random().toString(36).slice(2);
    const url = new URL(SCRIPT_URL);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, typeof value === "object" ? JSON.stringify(value) : value);
    });

    url.searchParams.set("callback", callbackName);

    const script = document.createElement("script");

    window[callbackName] = function(data) {
      cleanup();
      resolve(data);
    };

    script.onerror = function() {
      cleanup();
      reject(new Error("Could not reach Apps Script."));
    };

    function cleanup() {
      delete window[callbackName];
      script.remove();
    }

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function apiLoad() {
  const data = await jsonp({ action: "load" });
  if (!data.ok) throw new Error(data.error || "Load failed");
  return data;
}

async function apiSetAssignment(pin, key, staffId, date, location, role, note) {
  const data = await jsonp({
    action: "setAssignment",
    pin,
    key,
    staffId,
    date,
    location,
    role,
    note
  });

  if (!data.ok) throw new Error(data.error || "Save failed");
}

async function apiAddStaff(pin, staffData) {
  const data = await jsonp({
    action: "addStaff",
    pin,
    staff: staffData
  });

  if (!data.ok) throw new Error(data.error || "Add staff failed");
}

async function apiRemoveStaff(pin, staffId) {
  const data = await jsonp({
    action: "removeStaff",
    pin,
    staffId
  });

  if (!data.ok) throw new Error(data.error || "Remove staff failed");
}

// ─────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {
  bindEvents();
  renderLegend();
  loadData();
});

function bindEvents() {
  document.getElementById("prevWeekBtn")?.addEventListener("click", () => {
    weekStart = addDays(weekStart, -7);
    render();
  });

  document.getElementById("nextWeekBtn")?.addEventListener("click", () => {
    weekStart = addDays(weekStart, 7);
    render();
  });

  document.getElementById("todayBtn")?.addEventListener("click", () => {
    weekStart = getMondayOfWeek(new Date());
    render();
  });

  document.getElementById("refreshBtn")?.addEventListener("click", loadData);

  document.getElementById("managerLoginBtn")?.addEventListener("click", openPinModal);
  document.getElementById("lockBtn")?.addEventListener("click", exitEditMode);

  document.getElementById("addStaffBtn")?.addEventListener("click", showAddStaffForm);
  document.getElementById("cancelAddStaffBtn")?.addEventListener("click", hideAddStaffForm);
  document.getElementById("saveAddStaffBtn")?.addEventListener("click", handleAddStaff);

  document.getElementById("modalCancelBtn")?.addEventListener("click", closeAssignmentModal);
  document.getElementById("modalSaveBtn")?.addEventListener("click", saveAssignmentModal);
  document.getElementById("modalClearBtn")?.addEventListener("click", clearAssignmentCell);

  document.getElementById("pinCancelBtn")?.addEventListener("click", closePinModal);
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
  renderHeaderStats();
  renderWeekNav();
  renderStaffList();
  renderGrid();
  renderEditState();
}

function renderHeaderStats() {
  const weekDays = getWeekDays();
  const totalSlots = staff.length * 7;

  let filledSlots = 0;
  weekDays.forEach(day => {
    staff.forEach(s => {
      if (assignments[assignKey(s.id, day)]) filledSlots++;
    });
  });

  document.getElementById("staffCount").textContent = staff.length;
  document.getElementById("assignedCount").textContent = filledSlots;
  document.getElementById("openCount").textContent = totalSlots - filledSlots;
}

function renderWeekNav() {
  const weekDays = getWeekDays();
  document.getElementById("weekLabel").textContent =
    `Week of ${fmtDate(weekDays[0])} – ${fmtDate(weekDays[6])}`;
}

function renderLegend() {
  const legend = document.getElementById("legend");
  if (!legend) return;

  legend.innerHTML = UNITS.map(u => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${u.color}"></span>
      ${escapeHtml(u.label)}
    </span>
  `).join("") + `
    <span id="editHint" class="edit-hint hidden">// click any cell to assign</span>
  `;
}

function renderStaffList() {
  const staffList = document.getElementById("staffList");
  if (!staffList) return;

  staffList.innerHTML = staff.map(s => {
    const u = unitMeta(s.unit);

    return `
      <div class="staff-row ${isEditMode ? "clickable" : ""}">
        <div class="unit-bar" style="background:${u.color}"></div>
        <div style="flex:1;min-width:0">
          <div class="staff-name">${escapeHtml(s.name)}</div>
          <div class="staff-unit-tag">${escapeHtml(u.label)}</div>
        </div>
        ${isEditMode ? `<button class="staff-remove" onclick="handleRemoveStaff('${escapeHtml(s.id)}','${escapeHtml(s.name)}')">×</button>` : ""}
      </div>
    `;
  }).join("");

  document.getElementById("staffListCount").textContent = staff.length;
}

function renderGrid() {
  const gridArea = document.getElementById("gridArea");
  if (!gridArea) return;

  const weekDays = getWeekDays();

  if (!staff.length) {
    gridArea.innerHTML = `
      <div class="loading-message">
        // No staff loaded yet. Use Manager Login → Add Staff.
      </div>
    `;
    return;
  }

  const header = `
    <thead>
      <tr>
        ${weekDays.map((d, i) => `
          <th class="${isToday(d) ? "today" : ""}">
            ${DAY_SHORT[i]}
            <span class="th-date">${fmtDate(d)}</span>
          </th>
        `).join("")}
      </tr>
    </thead>
  `;

  const body = `
    <tbody>
      ${staff.map(s => `
        <tr>
          ${weekDays.map((d, i) => {
            const key = assignKey(s.id, d);
            const asgn = assignments[key];
            const u = unitMeta(s.unit);
            const saving = savingKeys.has(key);

            if (asgn) {
              return `
                <td class="${isToday(d) ? "today-col" : ""} ${isEditMode ? "editable" : ""}"
                    onclick="openAssignmentModal('${escapeHtml(s.id)}','${fmtISO(d)}')">
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
              <td class="${isToday(d) ? "today-col" : ""} ${isEditMode ? "editable" : ""}"
                  onclick="openAssignmentModal('${escapeHtml(s.id)}','${fmtISO(d)}')">
                <div class="empty-cell">
                  ${isEditMode ? `<span class="empty-cell-plus">+</span>` : ""}
                </div>
              </td>
            `;
          }).join("")}
        </tr>
      `).join("")}
    </tbody>
  `;

  gridArea.innerHTML = `
    <table class="grid-table">
      ${header}
      ${body}
    </table>
  `;
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
  }
}

// ─────────────────────────────────────────────
// PIN
// ─────────────────────────────────────────────

function openPinModal() {
  document.getElementById("pinModal").classList.remove("hidden");
  resetPin();
}

function closePinModal() {
  document.getElementById("pinModal").classList.add("hidden");
  resetPin();
}

function resetPin() {
  const input = document.getElementById("pinHiddenInput");
  if (input) input.value = "";

  document.querySelectorAll(".pin-dot").forEach(dot => {
    dot.classList.remove("filled", "error");
  });

  const msg = document.getElementById("pinErrorMsg");
  if (msg) msg.textContent = "";
}

function pinPress(num) {
  const input = document.getElementById("pinHiddenInput");
  if (!input || input.value.length >= 4) return;

  input.value += String(num);
  updatePinDots(input.value);

  if (input.value.length === 4) {
    setTimeout(() => {
      managerPin = input.value;
      isEditMode = true;
      closePinModal();
      render();
    }, 120);
  }
}

function pinDelete() {
  const input = document.getElementById("pinHiddenInput");
  if (!input) return;

  input.value = input.value.slice(0, -1);
  updatePinDots(input.value);
}

function updatePinDots(value) {
  document.querySelectorAll(".pin-dot").forEach((dot, i) => {
    dot.classList.toggle("filled", value.length > i);
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
  document.getElementById("addStaffForm").classList.remove("hidden");
  document.getElementById("addStaffBtn").classList.add("hidden");
  document.getElementById("newStaffName").focus();
}

function hideAddStaffForm() {
  document.getElementById("addStaffForm").classList.add("hidden");
  document.getElementById("addStaffBtn").classList.remove("hidden");
  document.getElementById("newStaffName").value = "";
  document.getElementById("newStaffUnit").value = "warehouse";
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
    loadData();
  } catch (err) {
    setStatus("error", `Add failed: ${err.message}`);
    loadData();
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
    loadData();
  } catch (err) {
    setStatus("error", `Remove failed: ${err.message}`);
    loadData();
  }
}

// ─────────────────────────────────────────────
// Assignments
// ─────────────────────────────────────────────

function openAssignmentModal(staffId, isoDate) {
  if (!isEditMode) return;

  const s = staff.find(x => x.id === staffId);
  if (!s) return;

  const day = new Date(isoDate + "T00:00:00");
  const key = `${staffId}__${isoDate}`;
  const existing = assignments[key];

  activeModal = {
    staffId,
    staffName: s.name,
    day,
    key
  };

  document.getElementById("modalTitle").textContent = s.name;
  document.getElementById("modalSub").textContent = `${fmtDate(day)} · ${isoDate}`;

  populateModalDropdowns();

  document.getElementById("modalLocation").value = existing?.location || "";
  document.getElementById("modalRole").value = existing?.role || "";
  document.getElementById("modalNote").value = existing?.note || "";

  document.getElementById("modalClearBtn").classList.toggle("hidden", !existing);
  document.getElementById("assignmentModal").classList.remove("hidden");
}

function populateModalDropdowns() {
  const loc = document.getElementById("modalLocation");
  const role = document.getElementById("modalRole");
  const unit = document.getElementById("newStaffUnit");

  if (loc) {
    loc.innerHTML = `<option value="">— Select location —</option>` +
      LOCATIONS.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(l)}</option>`).join("");
  }

  if (role) {
    role.innerHTML = `<option value="">— Select role/task —</option>` +
      ROLES.map(r => `<option value="${escapeHtml(r)}">${escapeHtml(r)}</option>`).join("");
  }

  if (unit) {
    unit.innerHTML = UNITS.map(u => `<option value="${u.id}">${escapeHtml(u.label)}</option>`).join("");
  }
}

function closeAssignmentModal() {
  document.getElementById("assignmentModal").classList.add("hidden");
  activeModal = null;
}

async function saveAssignmentModal() {
  if (!activeModal) return;

  const location = document.getElementById("modalLocation").value;
  const role = document.getElementById("modalRole").value;
  const note = document.getElementById("modalNote").value;

  const { staffId, day, key } = activeModal;

  closeAssignmentModal();

  if (!location && !role) {
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
    loadData();
  } catch (err) {
    savingKeys.delete(key);
    setStatus("error", `Save failed: ${err.message}`);
    if (err.message === "Invalid PIN") exitEditMode();
    loadData();
  }
}

async function clearAssignmentCell() {
  if (!activeModal) return;

  const { staffId, day, key } = activeModal;
  closeAssignmentModal();

  delete assignments[key];
  savingKeys.add(key);
  render();

  setStatus("saving", "Clearing…");

  try {
    await apiSetAssignment(managerPin, key, staffId, fmtISO(day), "", "", "");
    savingKeys.delete(key);
    setStatus("saved", `Cleared · ${new Date().toLocaleTimeString()}`);
    loadData();
  } catch (err) {
    savingKeys.delete(key);
    setStatus("error", `Clear failed: ${err.message}`);
    loadData();
  }
}

// Expose functions needed by inline onclick handlers
window.pinPress = pinPress;
window.pinDelete = pinDelete;
window.handleRemoveStaff = handleRemoveStaff;
window.openAssignmentModal = openAssignmentModal;
