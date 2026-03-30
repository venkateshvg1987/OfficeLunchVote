// ════════════════════════════════════════════════
//  LunchVote — app.js
//  - Login: Employee ID only (no names stored)
//  - Password: Employee ID itself
//  - Admin: SEEIN00024
//  - No duplicate employee IDs allowed
//  - Bulk upload: Employee ID list only
// ════════════════════════════════════════════════

import { initializeApp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, getDoc, setDoc,
  collection, getDocs, deleteDoc, onSnapshot
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ── Firebase Config ───────────────────────────────
const firebaseConfig = {
  apiKey:            "AIzaSyBZaOUCcbMc5AmQmSeFL2cuArkLgkeibxo",
  authDomain:        "lunchvote-82062.firebaseapp.com",
  projectId:         "lunchvote-82062",
  storageBucket:     "lunchvote-82062.firebasestorage.app",
  messagingSenderId: "227164928735",
  appId:             "1:227164928735:web:7f2fb40d0ed8b9d0f9876a"
};

const ADMIN_ID = "SEEIN00024";

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ── App state ─────────────────────────────────────
let currentUser = null;
let weekId      = "";
let weekDays    = [];
let myVotes     = {};
let liveUnsub   = null;

// ════════════════════════════════════════════════
//  WEEK HELPERS
// ════════════════════════════════════════════════

function getNextWeekMonday() {
  const now = new Date();
  const day = now.getDay();
  const daysUntilNextMon = (day === 0) ? 1 : (8 - day);
  const nextMon = new Date(now);
  nextMon.setDate(now.getDate() + daysUntilNextMon);
  nextMon.setHours(0, 0, 0, 0);
  return nextMon;
}

function getWeekId(monday) {
  const d    = new Date(monday);
  const jan4 = new Date(d.getFullYear(), 0, 4);
  const w    = Math.ceil((((d - jan4) / 86400000) + jan4.getDay() + 1) / 7);
  return `${d.getFullYear()}-W${String(w).padStart(2, "0")}`;
}

function getWeekDays(monday) {
  const dayNames = ["Mon","Tue","Wed","Thu","Fri"];
  const months   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return dayNames.map((name, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return `${name} ${d.getDate()} ${months[d.getMonth()]}`;
  });
}

function isVotingOpen() {
  const now  = new Date();
  const day  = now.getDay();
  const hour = now.getHours();
  return !(day === 0 && hour >= 18);
}

function formatTimestamp(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })
    + " " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true });
}

// ════════════════════════════════════════════════
//  UI HELPERS
// ════════════════════════════════════════════════

window.showScreen = function(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById(id).classList.add("active");
};

window.toast = function(msg, type = "ok") {
  const t = document.getElementById("toast");
  t.textContent = msg;
  t.className = `show ${type}`;
  setTimeout(() => t.className = "", 3000);
};

// ════════════════════════════════════════════════
//  LOGIN
// ════════════════════════════════════════════════

window.doLogin = async function() {
  const empId = document.getElementById("loginEmpId").value.trim().toUpperCase();
  const pass  = document.getElementById("loginPass").value.trim().toUpperCase();

  if (!empId || !pass) return toast("Please enter your Employee ID", "error");
  if (empId !== pass)  return toast("Password must match your Employee ID", "error");

  document.getElementById("loginLoading").style.display = "block";

  try {
    // Admin login — auto-creates admin record on first login
    if (empId === ADMIN_ID) {
      const adminDoc = await getDoc(doc(db, "admins", ADMIN_ID));
      if (!adminDoc.exists()) {
        await setDoc(doc(db, "admins", ADMIN_ID), {
          password: ADMIN_ID, createdAt: new Date().toISOString()
        });
      }
      currentUser = { id: ADMIN_ID, isAdmin: true };
      afterLogin();
      return;
    }

    // Employee login
    const empDoc = await getDoc(doc(db, "employees", empId));
    if (empDoc.exists()) {
      currentUser = { id: empId, isAdmin: false };
      afterLogin();
      return;
    }

    toast("Employee ID not found. Contact HR.", "error");
  } catch (e) {
    toast("Connection error. Please try again.", "error");
    console.error(e);
  } finally {
    document.getElementById("loginLoading").style.display = "none";
  }
};

function afterLogin() {
  document.getElementById("badgeId").textContent = currentUser.id;
  document.getElementById("userBadge").style.display = "flex";

  const nextMon = getNextWeekMonday();
  weekId   = getWeekId(nextMon);
  weekDays = getWeekDays(nextMon);

  if (currentUser.isAdmin) {
    showScreen("adminScreen");
    loadAdminEmployees();
    loadAdminTally();
  } else {
    showScreen("voteScreen");
    renderVoteScreen();
    subscribeToTally();
  }
}

document.getElementById("logoutBtn").onclick = function() {
  currentUser = null;
  if (liveUnsub) liveUnsub();
  document.getElementById("userBadge").style.display = "none";
  document.getElementById("loginEmpId").value = "";
  document.getElementById("loginPass").value  = "";
  showScreen("loginScreen");
};

// ════════════════════════════════════════════════
//  VOTE SCREEN
// ════════════════════════════════════════════════

async function renderVoteScreen() {
  const open  = isVotingOpen();
  const badge = document.getElementById("deadlineBadge");
  badge.innerHTML = open
    ? `<div class="deadline-badge open"><div class="dot"></div>Voting open – closes Sunday 6 PM</div>`
    : `<div class="deadline-badge closed"><div class="dot"></div>Voting closed – reopens Monday</div>`;

  document.getElementById("weekLabel").textContent =
    "Next week: " + weekDays[0] + " → " + weekDays[4];

  const voteDoc = await getDoc(doc(db, "votes", weekId, "byUser", currentUser.id));
  myVotes = voteDoc.exists() ? (voteDoc.data().days || {}) : {};
  renderDaysList(open);
}

function renderDaysList(open) {
  document.getElementById("daysList").innerHTML = weekDays.map(d => `
    <div class="day-row ${myVotes[d] ? "selected" : ""}" id="row-${btoa(d)}"
         onclick="${open ? `toggleDay('${d}')` : ""}">
      <div class="day-check">${myVotes[d] ? "✓" : ""}</div>
      <div class="day-label">${d}</div>
    </div>
  `).join("");
  document.getElementById("submitVoteBtn").disabled = !open;
}

window.toggleDay = function(day) {
  myVotes[day] = !myVotes[day];
  const row = document.getElementById("row-" + btoa(day));
  row.classList.toggle("selected", myVotes[day]);
  row.querySelector(".day-check").textContent = myVotes[day] ? "✓" : "";
};

window.submitVote = async function() {
  const btn = document.getElementById("submitVoteBtn");
  btn.disabled = true;
  btn.textContent = "Saving…";
  try {
    await setDoc(doc(db, "votes", weekId, "byUser", currentUser.id), {
      empId: currentUser.id, days: myVotes, updatedAt: new Date().toISOString()
    });
    toast("✓ Votes saved!", "ok");
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
  btn.disabled = false;
  btn.textContent = "Save my choices";
};

function subscribeToTally() {
  liveUnsub = onSnapshot(collection(db, "votes", weekId, "byUser"), (snap) => {
    const counts = {};
    weekDays.forEach(d => counts[d] = 0);
    snap.forEach(ds => {
      const days = ds.data().days || {};
      weekDays.forEach(d => { if (days[d]) counts[d]++; });
    });
    renderSummaryTable(counts, "tallyTable");
  });
}

// ════════════════════════════════════════════════
//  SUMMARY TABLE
// ════════════════════════════════════════════════

function renderSummaryTable(counts, tableId) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  document.getElementById(tableId).innerHTML = `
    <table class="summary-table">
      <thead>
        <tr><th>Day</th><th>Date</th><th style="text-align:right">Headcount</th></tr>
      </thead>
      <tbody>
        ${weekDays.map(d => {
          const [day, date, mon] = d.split(" ");
          return `<tr>
            <td><strong>${day}</strong></td>
            <td style="color:var(--muted)">${date} ${mon}</td>
            <td style="text-align:right"><span class="count-pill">${counts[d]} pax</span></td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
    <div class="total-bar">
      <span style="color:var(--muted);font-size:12px">Total lunch orders this week</span>
      <span class="total-num">${total}</span>
    </div>`;
}

// ════════════════════════════════════════════════
//  ADMIN — EMPLOYEES TAB
// ════════════════════════════════════════════════

window.addEmployee = async function() {
  const empId = document.getElementById("empId").value.trim().toUpperCase();
  if (!empId) return toast("Enter an Employee ID", "error");
  if (empId === ADMIN_ID) return toast("Admin ID cannot be added as employee", "error");

  const existing = await getDoc(doc(db, "employees", empId));
  if (existing.exists()) return toast(`${empId} already exists — duplicate not allowed`, "error");

  try {
    await setDoc(doc(db, "employees", empId), {
      empId, password: empId, createdAt: new Date().toISOString()
    });
    toast(`✓ ${empId} added successfully`, "ok");
    document.getElementById("empId").value = "";
    loadAdminEmployees();
  } catch (e) {
    toast("Error: " + e.message, "error");
  }
};

async function loadAdminEmployees() {
  const snap = await getDocs(collection(db, "employees"));
  document.getElementById("empCountSub").textContent = snap.empty
    ? "No employees added yet"
    : `${snap.size} employee${snap.size !== 1 ? "s" : ""} registered`;

  if (snap.empty) {
    document.getElementById("empList").innerHTML =
      `<p style="color:var(--muted);font-size:12px;padding:10px 0">No employees yet.</p>`;
    return;
  }

  const sorted = snap.docs.slice().sort((a, b) => a.id.localeCompare(b.id));
  document.getElementById("empList").innerHTML = `
    <table class="emp-table">
      <thead><tr><th>#</th><th>Employee ID</th><th>Added on</th><th></th></tr></thead>
      <tbody>
        ${sorted.map((d, i) => `
          <tr>
            <td style="color:var(--muted2);font-size:11px">${i + 1}</td>
            <td><span class="emp-id-tag">${d.id}</span></td>
            <td class="timestamp-tag">${formatTimestamp(d.data().createdAt)}</td>
            <td style="text-align:right">
              <button class="remove-btn" onclick="removeEmployee('${d.id}')">✕</button>
            </td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

window.removeEmployee = async function(empId) {
  if (!confirm(`Remove employee ${empId}?`)) return;
  await deleteDoc(doc(db, "employees", empId));
  toast(`${empId} removed`, "ok");
  loadAdminEmployees();
};

// ════════════════════════════════════════════════
//  BULK UPLOAD — Employee ID list (one per line)
//  Example CSV:
//    SEEIN00001
//    SEEIN00002
//    SEEIN00003
// ════════════════════════════════════════════════

window.handleCSVUpload = function(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    const lines = e.target.result
      .split("\n")
      .map(l => l.trim().toUpperCase())
      .filter(l => l.length > 0 && l !== ADMIN_ID);

    // Skip header row if present
    const firstLower = lines[0].toLowerCase();
    const dataLines  = (firstLower.includes("emp") && !firstLower.match(/^[A-Z0-9]+$/))
                       ? lines.slice(1) : lines;

    // Deduplicate within file
    const unique = [...new Set(dataLines)];

    const preview = document.getElementById("csvPreview");
    preview.style.display = "block";
    preview.innerHTML =
      `<strong>${unique.length} unique Employee IDs found:</strong><br>` +
      unique.slice(0, 8).join(" · ") +
      (unique.length > 8 ? ` · ... and ${unique.length - 8} more` : "");

    const btn = document.getElementById("confirmUploadBtn");
    btn.style.display = "block";
    btn.disabled = false;
    btn.textContent = `Upload ${unique.length} Employees`;
    btn.onclick = () => bulkUpload(unique);
  };
  reader.readAsText(file);
};

async function bulkUpload(ids) {
  const btn = document.getElementById("confirmUploadBtn");
  btn.disabled = true;
  btn.textContent = "Uploading…";

  let added = 0, skipped = 0, failed = 0;
  for (const empId of ids) {
    if (!empId) continue;
    try {
      const existing = await getDoc(doc(db, "employees", empId));
      if (existing.exists()) { skipped++; continue; }
      await setDoc(doc(db, "employees", empId), {
        empId, password: empId, createdAt: new Date().toISOString()
      });
      added++;
    } catch { failed++; }
  }

  toast(
    `✓ ${added} added` +
    (skipped > 0 ? `, ${skipped} already existed (skipped)` : "") +
    (failed  > 0 ? `, ${failed} failed` : ""),
    "ok"
  );

  btn.style.display = "none";
  document.getElementById("csvPreview").style.display = "none";
  document.getElementById("csvFileInput").value = "";
  loadAdminEmployees();
}

// ════════════════════════════════════════════════
//  ADMIN — RESULTS TAB
// ════════════════════════════════════════════════

async function loadAdminTally() {
  document.getElementById("adminWeekLabel").textContent =
    "Next week: " + weekDays[0] + " → " + weekDays[4];

  const snap   = await getDocs(collection(db, "votes", weekId, "byUser"));
  const counts = {};
  weekDays.forEach(d => counts[d] = 0);
  const voters = [];

  snap.forEach(ds => {
    const data       = ds.data();
    const days       = data.days || {};
    const daysChosen = weekDays.filter(d => days[d]);
    weekDays.forEach(d => { if (days[d]) counts[d]++; });
    voters.push({ empId: data.empId || ds.id, days: daysChosen, updatedAt: data.updatedAt });
  });

  voters.sort((a, b) => a.empId.localeCompare(b.empId));
  renderSummaryTable(counts, "adminTallyTable");

  const vl = document.getElementById("adminVoterList");
  if (voters.length === 0) {
    vl.innerHTML = `<p style="color:var(--muted);font-size:12px;padding:10px 0">No votes yet this week.</p>`;
    return;
  }

  vl.innerHTML = `
    <table class="voter-table">
      <thead>
        <tr>
          <th>Employee ID</th>
          <th>Days opted</th>
          <th style="text-align:right">Voted at</th>
        </tr>
      </thead>
      <tbody>
        ${voters.map(v => `
          <tr>
            <td><span class="emp-id-tag">${v.empId}</span></td>
            <td class="days-tag">
              ${v.days.length > 0
                ? v.days.map(d => d.split(" ")[0]).join(" · ")
                : "<span style='color:var(--muted2)'>None selected</span>"}
            </td>
            <td style="text-align:right" class="timestamp-tag">${formatTimestamp(v.updatedAt)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

window.showAdminTab = function(tab, el) {
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
  el.classList.add("active");
  document.getElementById("tab-employees").style.display = tab === "employees" ? "block" : "none";
  document.getElementById("tab-results").style.display   = tab === "results"   ? "block" : "none";
  if (tab === "results") loadAdminTally();
};
