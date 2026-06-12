const DAY_SHORT = ["MON","TUE","WED","THU","FRI","SAT","SUN"];

const UNITS = [
  { id: "epi",       label: "Epidemiology",        color: "#236092", bg: "#EAF6FA" },
  { id: "biowatch",  label: "Biowatch",             color: "#FFA300", bg: "#FFF7E6" },
  { id: "vaccines",  label: "Vaccines",             color: "#05C3DE", bg: "#E6F9FC" },
  { id: "lab",       label: "Public Health Lab",    color: "#7B4FBF", bg: "#F3EEFF" },
  { id: "warehouse", label: "Emergency Warehouse",  color: "#E03C31", bg: "#FFF0EF" },
  { id: "narcan",    label: "Narcan Distribution",  color: "#008B8B", bg: "#E6F5F5" },
  { id: "admin",     label: "Admin / Other",        color: "#6D7378", bg: "#F7FAFC" },
];

const LOCATIONS = [
  "Long Beach HQ", "San Diego Office", "EOC", "Field – OC", "Field – Pasadena",
  "Field – Riverside", "Emergency Warehouse", "Remote / WFH", "Leave / Off",
];

const ROLES = [
  "Epidemiologist", "Biowatch Analyst", "Vaccine Coordinator", "Lab Tech",
  "Logistics Lead", "Narcan Distributor", "Field Supervisor", "Admin Support",
  "On-Call", "Training", "Leave", "Other",
];

const state = {
  staff: [],
  assignments: {},
  weekStart: getMondayOfWeek(new Date()),
  isEditMode: false,
  managerPin: null,
  savingKeys: new Set(),
  pinDigits: [],
  modal: null,
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheEls();
  setupStaticUI();
  bindEvents();
  loadData();
});

function cacheEls() {
  [
    "statStaff", "statAssigned", "statOpen", "modeBadge", "managerLoginBtn", "lockBtn", "refreshBtn",
    "prevWeekBtn", "nextWeekBtn", "todayBtn", "weekLabel", "legend", "statusBar",
    "staffHeader", "staffList", "sidebarAdd", "addStaffToggle", "addStaffForm", "newStaffName",
    "newStaffUnit", "addStaffBtn", "cancelAddStaffBtn", "loadingMessage", "gridTable", "gridHeader",
    "gridBody", "pinOverlay", "pinDots", "pinError", "pinKeypad", "closePinBtn",
    "assignmentOverlay", "modalStaffName", "modalDate", "modalLocation", "modalRole", "modalNote",
    "closeAssignmentBtn", "clearAssignmentBtn", "cancelAssignmentBtn", "saveAssignmentBtn"
  ].forEach(id => els[id] = document.getElementById(id));
}

function setupStaticUI() {
  els.legend.innerHTML = UNITS.map(u => `
    <span class="legend-item">
      <span class="legend-dot" style="background:${u.color}"></span>
      ${escapeHtml(u.label)}
    </span>
  `).join("");

  fillSelect(els.newStaffUnit, UNITS.map(u => [u.id, u.label]));
  fillSelect(els.modalLocation, [["", "— Select location —"], ...LOCATIONS.map(l => [l, l])]);
  fillSelect(els.modalRole, [["", "— Select role —"], ...ROLES.map(r => [r, r])]);

  renderPinDots();
  renderPinKeypad();
}

function bindEvents() {
  els.refreshBtn.addEventListener("click", loadData);
  els.prevWeekBtn.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, -7); render(); });
  els.nextWeekBtn.addEventListener("click", () => { state.weekStart = addDays(state.weekStart, 7); render(); });
  els.todayBtn.addEventListener("click", () => { state.weekStart = getMondayOfWeek(new Date()); render(); });

  els.managerLoginBtn.addEventListener("click", openPinModal);
  els.lockBtn.addEventListener("click", exitEditMode);
  els.closePinBtn.addEventListener("click", closePinModal);
  els.pinOverlay.addEventListener("click", e => { if (e.target === els.pinOverlay) closePinModal(); });

  els.addStaffToggle.addEventListener("click", () => showAddStaffForm(true));
  els.cancelAddStaffBtn.addEventListener("click", () => showAddStaffForm(false));
  els.addStaffBtn.addEventListener("click", addStaff);
  els.newStaffName.addEventListener("keydown", e => { if (e.key === "Enter") addStaff(); });

  els.closeAssignmentBtn.addEventListener("click", closeAssignmentModal);
  els.cancelAssignmentBtn.addEventListener("click", closeAssignmentModal);
  els.assignmentOverlay.addEventListener("click", e => { if (e.target === els.assignmentOverlay) closeAssignmentModal(); });
  els.saveAssignmentBtn.addEventListener("click", saveAssignment);
  els.clearAssignmentBtn.addEventListener("click", clearAssignment);
}

// ── API via JSONP ─────────────────────────────────────────────
function apiCall(params = {}) {
  return new Promise((resolve, reject) => {
    if (!SCRIPT_URL || SCRIPT_URL.includes("YOUR_APPS_SCRIPT")) {
      reject(new Error("SCRIPT_URL is not set in config.js"));
      return;
    }

    const callbackName = "hecder_cb_" + Math.random().toString(36).slice(2);
    const script = document.createElement("script");
    const url = new URL(SCRIPT_URL);

    Object.entries(params).forEach(([key, value]) => {
      url.searchParams.set(key, value == null ? "" : String(value));
    });
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("_", Date.now());

    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Request timed out"));
    }, 20000);

    window[callbackName] = data => {
      cleanup();
      if (!data || data.ok === false) reject(new Error(data?.error || "Request failed"));
      else resolve(data);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error("Network/script load failed"));
    };

    function cleanup() {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
    }

    script.src = url.toString();
    document.body.appendChild(script);
  });
}

async function loadData() {
  setStatus("loading", "⟳ Loading board data…");
  try {
    const data = await apiCall();
    state.staff = data.staff || [];
    state.assignments = data.assignments || {};
    setStatus("ok", `Last loaded ${new Date().toLocaleTimeString()}`);
    render();
  } catch (e) {
    setStatus("error", `⚠ Load error: ${e.message}`);
    render();
  }
}

// ── Render ───────────────────────────────────────────────────
function render() {
  const weekDays = getWeekDays();
  const totalSlots = state.staff.length * 7;
  const filledSlots = weekDays.reduce((acc, d) => {
    return acc + state.staff.filter(s => state.assignments[assignKey(s.id, d)]).length;
  }, 0);

  els.statStaff.textContent = state.staff.length;
  els.statAssigned.textContent = filledSlots;
  els.statOpen.textContent = totalSlots - filledSlots;
  els.staffHeader.textContent = `Staff (${state.staff.length})`;
  els.weekLabel.textContent = `Week of ${fmtDate(state.weekStart)} – ${fmtDate(addDays(state.weekStart, 6))}`;

  els.modeBadge.className = `mode-badge ${state.isEditMode ? "edit" : "view"}`;
  els.modeBadge.textContent = state.isEditMode ? "✎ Edit Mode" : "👁 View Only";
  els.managerLoginBtn.classList.toggle("hidden", state.isEditMode);
  els.lockBtn.classList.toggle("hidden", !state.isEditMode);
  els.sidebarAdd.classList.toggle("hidden", !state.isEditMode);

  const existingHint = els.legend.querySelector(".edit-hint");
  if (existingHint) existingHint.remove();
  if (state.isEditMode) {
    const hint = document.createElement("span");
    hint.className = "edit-hint";
    hint.textContent = "// click any cell to assign";
    els.legend.appendChild(hint);
  }

  renderStaffList();
  renderGrid(weekDays);
}

function renderStaffList() {
  els.staffList.innerHTML = state.staff.map(s => {
    const u = unitMeta(s.unit);
    return `
      <div class="staff-row ${state.isEditMode ? "clickable" : ""}">
        <div class="unit-bar" style="background:${u.color}"></div>
        <div style="flex:1;min-width:0">
          <div class="staff-name">${escapeHtml(s.name)}</div>
          <div class="staff-unit-tag">${escapeHtml(u.label)}</div>
        </div>
        ${state.isEditMode ? `<button class="staff-remove" data-id="${escapeAttr(s.id)}" data-name="${escapeAttr(s.name)}">×</button>` : ""}
      </div>
    `;
  }).join("");

  els.staffList.querySelectorAll(".staff-remove").forEach(btn => {
    btn.addEventListener("click", () => removeStaff(btn.dataset.id, btn.dataset.name));
  });
}

function renderGrid(weekDays) {
  if (!state.staff.length) {
    els.loadingMessage.classList.remove("hidden");
    els.loadingMessage.textContent = "// No staff yet. Log in as manager and add staff.";
    els.gridTable.classList.add("hidden");
    return;
  }

  els.loadingMessage.classList.add("hidden");
  els.gridTable.classList.remove("hidden");

  els.gridHeader.innerHTML = weekDays.map((d, i) => `
    <th class="${isToday(d) ? "today" : ""}">
      ${DAY_SHORT[i]}
      <span class="th-date">${fmtDate(d)}</span>
    </th>
  `).join("");

  els.gridBody.innerHTML = state.staff.map(s => `
    <tr>
      ${weekDays.map((d, di) => renderCell(s, d, di)).join("")}
    </tr>
  `).join("");

  els.gridBody.querySelectorAll("td[data-staff-id]").forEach(td => {
    td.addEventListener("click", () => openAssignmentModal(td.dataset.staffId, td.dataset.date));
  });
}

function renderCell(s, d) {
  const key = assignKey(s.id, d);
  const asgn = state.assignments[key];
  const u = unitMeta(s.unit);
  const saving = state.savingKeys.has(key);
  const cls = [isToday(d) ? "today-col" : "", state.isEditMode ? "editable" : ""].join(" ");

  if (asgn) {
    return `
      <td class="${cls}" data-staff-id="${escapeAttr(s.id)}" data-date="${fmtISO(d)}">
        <div class="assignment-chip ${saving ? "saving" : ""}" style="background:${u.bg};border-left:3px solid ${u.color}">
          <div class="chip-role" style="color:${u.color}">${escapeHtml(asgn.role || "—")}</div>
          <div class="chip-location" style="color:${u.color}">${escapeHtml(asgn.location || "—")}</div>
        </div>
      </td>
    `;
  }

  return `
    <td class="${cls}" data-staff-id="${escapeAttr(s.id)}" data-date="${fmtISO(d)}">
      <div class="empty-cell">${state.isEditMode ? `<span class="empty-cell-plus">+</span>` : ""}</div>
    </td>
  `;
}

// ── PIN / Edit Mode ──────────────────────────────────────────
function openPinModal() {
  state.pinDigits = [];
  els.pinError.textContent = "";
  renderPinDots();
  els.pinOverlay.classList.remove("hidden");
}

function closePinModal() {
  els.pinOverlay.classList.add("hidden");
}

function renderPinDots(error = false) {
  els.pinDots.innerHTML = [0,1,2,3].map(i =>
    `<div class="pin-dot ${state.pinDigits.length > i ? (error ? "error" : "filled") : ""}"></div>`
  ).join("");
}

function renderPinKeypad() {
  els.pinKeypad.innerHTML = [1,2,3,4,5,6,7,8,9].map(n =>
    `<button class="pin-key" data-digit="${n}">${n}</button>`
  ).join("") + `<div></div><button class="pin-key" data-digit="0">0</button><button class="pin-key" id="pinBackspace" style="font-size:14px">⌫</button>`;

  els.pinKeypad.querySelectorAll("button[data-digit]").forEach(btn => {
    btn.addEventListener("click", () => pressPin(btn.dataset.digit));
  });
  document.getElementById("pinBackspace").addEventListener("click", () => {
    state.pinDigits = state.pinDigits.slice(0, -1);
    renderPinDots();
  });
}

function pressPin(digit) {
  if (state.pinDigits.length >= 4) return;
  state.pinDigits.push(digit);
  els.pinError.textContent = "";
  renderPinDots();

  if (state.pinDigits.length === 4) {
    state.managerPin = state.pinDigits.join("");
    state.isEditMode = true;
    closePinModal();
    render();
  }
}

function exitEditMode() {
  state.isEditMode = false;
  state.managerPin = null;
  showAddStaffForm(false);
  render();
}

// ── Assignment Modal ─────────────────────────────────────────
function openAssignmentModal(staffId, isoDate) {
  if (!state.isEditMode) return;
  const staff = state.staff.find(s => s.id === staffId);
  if (!staff) return;

  const day = parseISODate(isoDate);
  const key = assignKey(staffId, day);
  const existing = state.assignments[key];

  state.modal = { staffId, staffName: staff.name, date: isoDate, key };
  els.modalStaffName.textContent = staff.name;
  els.modalDate.textContent = `${DAY_SHORT[getWeekDays().findIndex(d => fmtISO(d) === isoDate)]} · ${fmtDate(day)}`;
  els.modalLocation.value = existing?.location || "";
  els.modalRole.value = existing?.role || "";
  els.modalNote.value = existing?.note || "";
  els.clearAssignmentBtn.classList.toggle("hidden", !existing);
  els.assignmentOverlay.classList.remove("hidden");
}

function closeAssignmentModal() {
  state.modal = null;
  els.assignmentOverlay.classList.add("hidden");
}

async function saveAssignment() {
  if (!state.modal) return;
  const { staffId, date, key } = state.modal;
  const location = els.modalLocation.value;
  const role = els.modalRole.value;
  const note = els.modalNote.value;

  closeAssignmentModal();
  optimisticAssignment(key, staffId, date, location, role, note);
  setStatus("saving", "● Saving…");

  try {
    await apiCall({ action: "setAssignment", pin: state.managerPin, key, staffId, date, location, role, note });
    setStatus("saved", `✓ Saved · ${new Date().toLocaleTimeString()}`);
    await loadData();
  } catch (e) {
    setStatus("error", `⚠ Save failed: ${e.message}`);
    if (e.message === "Invalid PIN") exitEditMode();
    await loadData();
  } finally {
    state.savingKeys.delete(key);
    render();
  }
}

async function clearAssignment() {
  if (!state.modal) return;
  const { staffId, date, key } = state.modal;

  closeAssignmentModal();
  optimisticAssignment(key, staffId, date, "", "", "");
  setStatus("saving", "● Clearing…");

  try {
    await apiCall({ action: "setAssignment", pin: state.managerPin, key, staffId, date, location: "", role: "", note: "" });
    setStatus("saved", `✓ Cleared · ${new Date().toLocaleTimeString()}`);
    await loadData();
  } catch (e) {
    setStatus("error", `⚠ Clear failed: ${e.message}`);
    await loadData();
  } finally {
    state.savingKeys.delete(key);
    render();
  }
}

function optimisticAssignment(key, staffId, date, location, role, note) {
  state.savingKeys.add(key);
  if (!location && !role) delete state.assignments[key];
  else state.assignments[key] = { staffId, date, location, role, note };
  render();
}

// ── Staff ────────────────────────────────────────────────────
function showAddStaffForm(show) {
  els.addStaffForm.classList.toggle("hidden", !show);
  els.addStaffToggle.classList.toggle("hidden", show);
  if (show) els.newStaffName.focus();
}

async function addStaff() {
  const name = els.newStaffName.value.trim();
  const unit = els.newStaffUnit.value;
  if (!name) return;

  const staff = { id: makeId(), name, unit, active: true };
  state.staff.push(staff);
  els.newStaffName.value = "";
  els.newStaffUnit.value = "epi";
  showAddStaffForm(false);
  render();
  setStatus("saving", "● Adding staff…");

  try {
    await apiCall({ action: "addStaff", pin: state.managerPin, id: staff.id, name: staff.name, unit: staff.unit });
    setStatus("saved", `✓ ${staff.name} added`);
    await loadData();
  } catch (e) {
    setStatus("error", `⚠ Add failed: ${e.message}`);
    await loadData();
  }
}

async function removeStaff(id, name) {
  if (!window.confirm(`Remove ${name} from the board?`)) return;

  state.staff = state.staff.filter(s => s.id !== id);
  render();
  setStatus("saving", `● Removing ${name}…`);

  try {
    await apiCall({ action: "removeStaff", pin: state.managerPin, staffId: id });
    setStatus("saved", `✓ ${name} removed`);
    await loadData();
  } catch (e) {
    setStatus("error", `⚠ Remove failed: ${e.message}`);
    await loadData();
  }
}

// ── Helpers ──────────────────────────────────────────────────
function setStatus(type, msg) {
  els.statusBar.className = `status-bar ${type}`;
  els.statusBar.textContent = msg;
}

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

function getWeekDays() {
  return Array.from({ length: 7 }, (_, i) => addDays(state.weekStart, i));
}

function fmtDate(d) {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtISO(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function parseISODate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function isToday(d) {
  return d.toDateString() === new Date().toDateString();
}

function assignKey(staffId, date) {
  const dateStr = date instanceof Date ? fmtISO(date) : date;
  return `${staffId}__${dateStr}`;
}

function fillSelect(select, options) {
  select.innerHTML = options.map(([value, label]) => `<option value="${escapeAttr(value)}">${escapeHtml(label)}</option>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}
