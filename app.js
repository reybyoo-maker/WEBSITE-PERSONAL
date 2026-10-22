import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const config = window.APP_CONFIG || {};
const configured = typeof config.supabaseUrl === "string"
  && config.supabaseUrl.startsWith("https://")
  && !config.supabaseUrl.includes("YOUR-PROJECT")
  && typeof config.supabaseAnonKey === "string"
  && config.supabaseAnonKey.length > 20
  && !config.supabaseAnonKey.includes("YOUR_PUBLIC");
const supabase = configured ? createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const state = {
  user: null, profile: null, profiles: [], tasks: [], comments: [], attachments: [], activities: [],
  view: "dashboard", selectedTaskId: null, loading: false
};
const STATUS = {
  todo: "Belum dimulai",
  in_progress: "Sedang dikerjakan",
  in_review: "Menunggu approval",
  changes_requested: "Perlu revisi",
  approved: "Disetujui",
  done: "Selesai",
  archived: "Diarsipkan"
};
const PRIORITY = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Urgent" };
const PAGE_TITLE = {
  dashboard: "Dashboard", tasks: "Semua pekerjaan", approvals: "Approval & revisi",
  files: "Arsip & file", activity: "Riwayat aktivitas"
};

function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}
function initials(name) {
  const parts = String(name || "RK").trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] || "RK").slice(0, 2)).toUpperCase();
}
function fmtDate(value, options = { day: "numeric", month: "short", year: "numeric" }) {
  if (!value) return "Belum ditentukan";
  const date = new Date(value.length === 10 ? value + "T12:00:00" : value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("id-ID", options).format(date);
}
function fmtDateTime(value) {
  if (!value) return "—";
  return fmtDate(value, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
function roleLabel(role) { return role === "manager" ? "Manager" : "Anggota"; }
function statusBadge(status) {
  return '<span class="status status-' + esc(status) + '">' + esc(STATUS[status] || status) + "</span>";
}
function isClosed(task) { return ["done", "archived"].includes(task.status); }
function isLate(task) {
  return Boolean(task.due_date && task.due_date < new Date().toISOString().slice(0, 10) && !isClosed(task));
}
function profileName(id) {
  const found = state.profiles.find((item) => item.id === id);
  return found ? found.display_name : "Belum ditentukan";
}
function taskById(id) { return state.tasks.find((item) => item.id === id); }
function setAuthMessage(text, kind = "") {
  const node = $("#auth-message");
  node.textContent = text;
  node.className = "notice" + (kind ? " notice-" + kind : "");
  node.hidden = !text;
}
function toast(text, kind = "success") {
  const region = $("#toast-region");
  const el = document.createElement("div");
  el.className = "toast " + kind;
  el.textContent = text;
  region.appendChild(el);
  window.setTimeout(() => el.remove(), 4200);
}
function setAuthMode(mode) {
  $("#login-view").hidden = mode !== "login";
  $("#register-view").hidden = mode !== "register";
  setAuthMessage("");
}
function showAuth(message = "", kind = "") {
  $("#app-shell").hidden = true;
  $("#auth-shell").hidden = false;
  $("#modal-root").innerHTML = "";
  setAuthMode("login");
  setAuthMessage(message, kind);
}
function showConfigWarning() {
  const node = $("#config-warning");
  node.hidden = false;
  node.innerHTML = "<strong>Setup belum selesai.</strong> Isi Project URL dan public anon/publishable key di <b>config.js</b>, lalu jalankan <b>supabase/schema.sql</b> di SQL Editor. Jangan memasukkan service-role/secret key di website.";
  $$("#login-form button, #register-form button").forEach((button) => { button.disabled = true; });
}
function showLoading(text = "Memuat ruang kerja…") {
  $("#page-content").innerHTML = '<div class="loading-state"><span class="spinner"></span>' + esc(text) + "</div>";
}
function currentRole() { return state.profile ? state.profile.role : "member"; }
function taskDetails(task) {
  const title = esc(task.title);
  const due = task.due_date ? fmtDate(task.due_date) : "Tanpa deadline";
  const dueClass = isLate(task) ? "due-overdue" : "";
  const pName = profileName(task.assigned_to);
  return '<div class="task-main"><span class="task-title">' + title + '</span><div class="task-subline"><span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span><span class="' + dueClass + '">Deadline: ' + esc(due) + '</span><span>PIC: ' + esc(pName) + "</span></div></div>";
}
function taskRow(task, actionLabel = "Detail") {
  return '<div class="task-row"><div class="task-main-wrap">' + taskDetails(task) + '</div><div class="task-actions">' + statusBadge(task.status) + '<button class="btn btn-secondary btn-small task-open" data-id="' + esc(task.id) + '">' + esc(actionLabel) + "</button></div></div>";
}
function personChip(id) {
  const name = profileName(id);
  return '<span class="person-chip"><span class="avatar">' + esc(initials(name)) + "</span>" + esc(name) + "</span>";
}
function statCard(label, value, symbol, sub) {
  return '<article class="stat-card"><div class="stat-top"><span>' + esc(label) + '</span><span class="stat-icon">' + symbol + '</span></div><div class="stat-value">' + esc(value) + '</div><div class="stat-sub">' + esc(sub) + "</div></article>";
}
function emptyState(title, description, button = "") {
  return '<div class="empty-state"><div class="empty-icon">✓</div><strong>' + esc(title) + '</strong><p>' + esc(description) + "</p>" + button + "</div>";
}
function openCreateButton(label = "Buat tugas") {
  return '<button class="btn btn-primary" data-create-task><span aria-hidden="true">＋</span> ' + esc(label) + "</button>";
}
function renderDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const active = state.tasks.filter((t) => !isClosed(t));
  const dueToday = active.filter((t) => t.due_date === today).length;
  const pending = state.tasks.filter((t) => t.status === "in_review").length;
  const overdue = active.filter(isLate).length;
  const recent = active.slice().sort((a, b) => {
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  }).slice(0, 5);
  const needsMe = state.profile.role === "manager"
    ? state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length
    : state.tasks.filter((t) => t.status === "changes_requested" && (t.assigned_to === state.user.id || t.created_by === state.user.id)).length;
  return '<div class="page-heading"><div><h2>Halo, ' + esc(state.profile.display_name.split(/\s+/)[0]) + '.</h2><p>Berikut ringkasan pekerjaan tim kamu hari ini.</p></div><div class="heading-actions">' + openCreateButton() + "</div></div>" +
    '<div class="stats-grid">' +
    statCard("Tugas aktif", active.length, "☷", "Semua pekerjaan yang belum selesai") +
    statCard("Deadline hari ini", dueToday, "◷", "Perlu dituntaskan hari ini") +
    statCard(state.profile.role === "manager" ? "Menunggu review" : "Perlu ditindaklanjuti", needsMe, "✓", state.profile.role === "manager" ? "Pekerjaan menunggu keputusan" : "Approval atau revisi") +
    statCard("Terlambat", overdue, "!", overdue ? "Periksa dan perbarui progres" : "Tidak ada tugas terlambat") +
    '</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h3>Deadline terdekat</h3><p>Prioritas untuk beberapa hari ke depan</p></div><button class="text-action" data-view="tasks">Lihat semua →</button></div>' +
    (recent.length ? '<div class="task-list">' + recent.map((t) => taskRow(t, "Buka")).join("") + "</div>" : emptyState("Belum ada pekerjaan aktif", "Buat tugas pertama supaya deadline dan progres tercatat.", openCreateButton("Buat tugas pertama"))) +
    '</section><section class="panel"><div class="panel-header"><div><h3>Butuh perhatian</h3><p>Approval, revisi, atau tugas lewat deadline</p></div></div><div class="panel-body"><div class="mini-list">' +
    (overdue ? '<div class="mini-item"><span class="mini-dot" style="background:#b44343"></span><div class="mini-copy"><strong>' + overdue + " tugas terlambat</strong><p>Periksa deadline dan kabari penanggung jawab.</p></div></div>" : "") +
    (pending ? '<div class="mini-item"><span class="mini-dot" style="background:#6b54a3"></span><div class="mini-copy"><strong>' + pending + " tugas menunggu approval</strong><p>" + (state.profile.role === "manager" ? "Buka panel approval untuk meninjau hasil." : "Manager perlu meninjau hasil yang diajukan.") + '</p><button class="text-action" data-view="approvals">Buka approval →</button></div></div>' : "") +
    (needsMe === 0 && overdue === 0 && pending === 0 ? '<div class="mini-item"><span class="mini-dot" style="background:#21785b"></span><div class="mini-copy"><strong>Semua terkendali</strong><p>Belum ada hal mendesak yang membutuhkan perhatian.</p></div></div>' : "") +
    '<div class="mini-item"><span class="mini-dot"></span><div class="mini-copy"><strong>Panel ' + esc(roleLabel(state.profile.role)) + '</strong><p>' + (state.profile.role === "manager" ? "Kamu dapat menugaskan pekerjaan, meminta revisi, dan menyetujui hasil." : "Kamu dapat memperbarui progres, melampirkan file yang diizinkan, dan mengajukan approval.") + "</p></div></div>" +
    "</div></div></section></div>";
}
function renderTasks() {
  const rows = state.tasks.slice().sort((a, b) => {
    const rank = { in_review: 0, changes_requested: 1, in_progress: 2, todo: 3, approved: 4, done: 5, archived: 6 };
    const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (diff) return diff;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    return a.due_date.localeCompare(b.due_date);
  });
  return '<div class="page-heading"><div><h2>Semua pekerjaan</h2><p>Semua tugas tim, PIC, deadline, dan statusnya.</p></div><div class="heading-actions">' + openCreateButton() + "</div></div>" +
    '<div class="toolbar"><label class="search-box"><span class="search-mark">⌕</span><input id="task-search" type="search" placeholder="Cari judul atau deskripsi…" autocomplete="off"></label><select id="task-status-filter" class="filter-select" aria-label="Filter status"><option value="">Semua status</option>' +
    Object.keys(STATUS).map((key) => '<option value="' + key + '">' + esc(STATUS[key]) + "</option>").join("") +
    '</select><select id="task-priority-filter" class="filter-select" aria-label="Filter prioritas"><option value="">Semua prioritas</option>' +
    Object.keys(PRIORITY).map((key) => '<option value="' + key + '">' + esc(PRIORITY[key]) + "</option>").join("") +
    '</select></div><section class="panel"><div class="task-table-wrap"><table class="task-table"><thead><tr><th>Pekerjaan</th><th>Status</th><th>PIC</th><th>Deadline</th><th>Prioritas</th></tr></thead><tbody>' +
    (rows.length ? rows.map((task) => '<tr data-status="' + esc(task.status) + '" data-priority="' + esc(task.priority) + '" data-search="' + esc((task.title + " " + (task.description || "") + " " + profileName(task.assigned_to)).toLowerCase()) + '"><td><button class="table-task-button task-open" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button><span class="table-description">' + esc(task.description || "Tidak ada deskripsi") + '</span></td><td>' + statusBadge(task.status) + '</td><td>' + personChip(task.assigned_to) + '</td><td class="due-cell ' + (isLate(task) ? "due-overdue" : "") + '">' + esc(task.due_date ? fmtDate(task.due_date) : "—") + '</td><td>' + esc(PRIORITY[task.priority] || task.priority) + "</td></tr>").join("") : '<tr><td colspan="5">' + emptyState("Belum ada tugas", "Tambahkan pekerjaan pertama untuk tim.") + "</td></tr>") +
    '</tbody></table></div><div id="filter-empty" class="empty-inline" hidden>Tidak ada tugas yang cocok dengan filter ini.</div></section>';
}
function applyTaskFilters() {
  const needle = ($("#task-search")?.value || "").trim().toLowerCase();
  const status = $("#task-status-filter")?.value || "";
  const priority = $("#task-priority-filter")?.value || "";
  let visible = 0;
  $$(".task-table tbody tr[data-status]").forEach((row) => {
    const show = (!needle || (row.dataset.search || "").includes(needle)) &&
      (!status || row.dataset.status === status) && (!priority || row.dataset.priority === priority);
    row.hidden = !show;
    if (show) visible++;
  });
  const empty = $("#filter-empty");
  if (empty) empty.hidden = visible !== 0;
}
function renderApprovals() {
  const manager = currentRole() === "manager";
  const candidates = state.tasks.filter((t) => manager
    ? ["in_review", "changes_requested"].includes(t.status)
    : ["in_review", "changes_requested"].includes(t.status) && (t.assigned_to === state.user.id || t.created_by === state.user.id));
  return '<div class="page-heading"><div><h2>Approval & revisi</h2><p>' + (manager ? "Tinjau hasil yang masuk dan berikan keputusan yang jelas." : "Pantau hasil yang menunggu review atau perlu diperbaiki.") + '</p></div></div><section class="panel"><div class="panel-header"><div><h3>' + (manager ? "Daftar review tim" : "Status review saya") + '</h3><p>' + candidates.length + " item perlu perhatian</p></div></div>" +
    (candidates.length ? candidates.map((task) => '<div class="approval-card"><div><h3>' + esc(task.title) + '</h3><p>' + esc((task.description || "Tidak ada deskripsi").slice(0, 170)) + '</p><div class="task-subline">' + statusBadge(task.status) + '<span>PIC: ' + esc(profileName(task.assigned_to)) + '</span><span>Deadline: ' + esc(task.due_date ? fmtDate(task.due_date) : "—") + "</span></div></div><div class=\"approval-actions\"><button class=\"btn btn-secondary btn-small task-open\" data-id=\"" + esc(task.id) + "\">" + (manager && task.status === "in_review" ? "Tinjau hasil" : "Buka tugas") + "</button>" + (manager && task.status === "in_review" ? '<button class="btn btn-approve btn-small task-quick-status" data-id="' + esc(task.id) + '" data-status="approved">Setujui</button>' : "") + "</div></div>").join("") : emptyState("Tidak ada approval tertunda", "Jika pekerjaan diajukan untuk review, pekerjaan itu akan muncul di sini.")) +
    "</section>";
}
function renderFiles() {
  const items = state.attachments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return '<div class="page-heading"><div><h2>Arsip & file</h2><p>Lampiran kerja tersimpan privat dan terhubung ke tugas.</p></div>' + (currentRole() === "manager" ? '<div class="heading-actions"><button class="btn btn-secondary" data-backup-export>Backup terenkripsi</button><button class="btn btn-primary" data-backup-restore>Pulihkan backup</button></div>' : '') + '</div><div class="file-warning"><strong>Perhatian:</strong><span>Hanya unggah file non-rahasia yang memang boleh disimpan di layanan cloud ini. File berklasifikasi atau rahasia negara harus tetap di sistem resmi yang disetujui instansi.</span></div><section class="panel"><div class="panel-header"><div><h3>Semua lampiran</h3><p>File tersedia untuk anggota tim yang berwenang pada tugas terkait.</p></div><span class="role-badge">' + items.length + " file</span></div>" +
    (items.length ? items.map((file) => {
      const task = taskById(file.task_id);
      const ext = (file.file_name.split(".").pop() || "FILE").slice(0, 5).toUpperCase();
      return '<div class="file-row"><div class="file-type-icon">' + esc(ext) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(task ? task.title : "Tugas") + " · " + esc(fmtDateTime(file.created_at)) + " · " + esc(formatBytes(file.size_bytes)) + '</p></div><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button></div>';
    }).join("") : emptyState("Belum ada lampiran", "Buka detail tugas untuk mengunggah file kerja yang diizinkan.")) + "</section>";
}
function renderActivity() {
  const items = state.activities.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  const labels = { task_created: "membuat tugas", status_changed: "mengubah status tugas", task_updated: "memperbarui tugas", comment_added: "menambahkan komentar", file_uploaded: "mengunggah lampiran" };
  return '<div class="page-heading"><div><h2>Riwayat aktivitas</h2><p>Jejak perubahan untuk membantu koordinasi dan review.</p></div></div><section class="panel"><div class="panel-header"><div><h3>Aktivitas terbaru</h3><p>Catatan aktivitas tidak dapat diedit dari halaman ini.</p></div></div>' +
    (items.length ? '<div class="activity-list">' + items.map((item) => {
      const actor = state.profiles.find((p) => p.id === item.actor_id);
      const task = taskById(item.task_id);
      const details = item.details || {};
      let note = "";
      if (item.action === "status_changed") note = (STATUS[details.from] || details.from || "") + " → " + (STATUS[details.to] || details.to || "");
      return '<div class="activity-item"><div class="activity-symbol">◷</div><div class="activity-copy"><strong>' + esc(actor ? actor.display_name : "Anggota tim") + "</strong> " + esc(labels[item.action] || "melakukan aktivitas") + (task ? ' <strong>“' + esc(task.title) + '”</strong>' : "") + '<p>' + esc(note || "Aktivitas dicatat") + " · " + esc(fmtDateTime(item.created_at)) + "</p></div></div>";
    }).join("") + "</div>" : emptyState("Belum ada aktivitas", "Aktivitas pembuatan tugas dan perubahan status akan muncul di sini.")) + "</section>";
}
function renderPage() {
  $("#page-title").textContent = PAGE_TITLE[state.view] || "Ruang Kerja";
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === state.view));
  $("#nav-task-count").textContent = state.tasks.filter((t) => !isClosed(t)).length;
  $("#nav-approval-count").textContent = state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length;
  if (state.view === "dashboard") $("#page-content").innerHTML = renderDashboard();
  else if (state.view === "tasks") $("#page-content").innerHTML = renderTasks();
  else if (state.view === "approvals") $("#page-content").innerHTML = renderApprovals();
  else if (state.view === "files") $("#page-content").innerHTML = renderFiles();
  else $("#page-content").innerHTML = renderActivity();
}
function formatBytes(bytes) {
  const n = Number(bytes || 0);
  if (n < 1024) return n + " B";
  if (n < 1024 ** 2) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 ** 3) return (n / (1024 ** 2)).toFixed(1) + " MB";
  if (n < 1024 ** 4) return (n / (1024 ** 3)).toFixed(2) + " GB";
  return (n / (1024 ** 4)).toFixed(2) + " TB";
}
async function loadWorkspace() {
  if (!supabase || !state.user) return;
  state.loading = true;
  showLoading();
  const [profileRes, profilesRes, tasksRes, commentsRes, attachmentsRes, activityRes] = await Promise.all([
    supabase.from("profiles").select("id,display_name,role,created_at").eq("id", state.user.id).maybeSingle(),
    supabase.from("profiles").select("id,display_name,role,created_at").order("display_name"),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("task_comments").select("id,task_id,user_id,comment,created_at").order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("id,task_id,path,file_name,content_type,size_bytes,uploaded_by,created_at").order("created_at", { ascending: false }),
    supabase.from("activity_log").select("id,task_id,actor_id,action,details,created_at").order("created_at", { ascending: false }).limit(100)
  ]);
  if (profileRes.error || !profileRes.data) {
    state.loading = false;
    await supabase.auth.signOut();
    showAuth("Profil tidak ditemukan. Minta administrator portal memeriksa undangan dan schema database.", "error");
    return;
  }
  state.profile = profileRes.data;
  state.profiles = profilesRes.data || [profileRes.data];
  state.tasks = tasksRes.data || [];
  state.comments = commentsRes.data || [];
  state.attachments = attachmentsRes.data || [];
  state.activities = activityRes.data || [];
  state.loading = false;
  $("#profile-name").textContent = state.profile.display_name;
  $("#profile-role").textContent = "Panel " + roleLabel(state.profile.role);
  $("#profile-avatar").textContent = initials(state.profile.display_name);
  $("#today-label").textContent = fmtDate(new Date().toISOString().slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
  $("#auth-shell").hidden = true;
  $("#app-shell").hidden = false;
  renderPage();
}
async function enterApp(user) {
  state.user = user;
  await loadWorkspace();
}
function changeView(view) {
  if (!PAGE_TITLE[view]) return;
  state.view = view;
  $("#sidebar").classList.remove("mobile-open");
  renderPage();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
function openCreateModal() {
  const people = state.profiles.map((p) => '<option value="' + esc(p.id) + '"' + (p.id === state.user.id ? " selected" : "") + ">" + esc(p.display_name + " — " + roleLabel(p.role)) + "</option>").join("");
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><div class="modal-header"><div><h2 id="create-task-title">Buat pekerjaan baru</h2><p>Jelaskan hasil yang dibutuhkan dan kapan harus selesai.</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="create-task-form"><div class="modal-body"><div class="form-grid"><div class="field field-span"><label for="task-title-input">Judul pekerjaan *</label><input id="task-title-input" name="title" required maxlength="140" placeholder="Contoh: Siapkan laporan bulanan"></div><div class="field field-span"><label for="task-description-input">Deskripsi dan hasil yang diharapkan</label><textarea id="task-description-input" name="description" maxlength="8000" placeholder="Tuliskan brief, langkah kerja, dan kriteria selesai…"></textarea></div><div class="field"><label for="task-due-input">Deadline</label><input id="task-due-input" name="due_date" type="date"></div><div class="field"><label for="task-priority-input">Prioritas</label><select id="task-priority-input" name="priority"><option value="normal">Normal</option><option value="high">Tinggi</option><option value="urgent">Urgent</option><option value="low">Rendah</option></select></div><div class="field field-span"><label for="task-assignee-input">Penanggung jawab (PIC)</label><select id="task-assignee-input" name="assigned_to">' + people + '</select><p class="field-help">Manager memiliki tombol approval. Keduanya memiliki panel pribadi sesuai akun.</p></div></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-primary">Simpan pekerjaan</button></div></form></section></div>';
  $("#task-title-input")?.focus();
}
function taskActionButtons(task) {
  const manager = currentRole() === "manager";
  const owns = task.assigned_to === state.user.id || task.created_by === state.user.id;
  let html = "";
  if (!manager && owns && !isClosed(task)) {
    if (task.status === "todo" || task.status === "changes_requested") html += '<button class="btn btn-primary" data-task-status="in_progress" data-id="' + esc(task.id) + '">Mulai dikerjakan</button>';
    if (task.status === "in_progress") html += '<button class="btn btn-primary" data-task-status="in_review" data-id="' + esc(task.id) + '">Ajukan approval</button>';
  }
  if (manager && task.status === "in_review") {
    html += '<button class="btn btn-warning" data-show-revision="' + esc(task.id) + '">Minta revisi</button>';
    html += '<button class="btn btn-approve" data-task-status="approved" data-id="' + esc(task.id) + '">Setujui hasil</button>';
  }
  if (manager && task.status === "approved") html += '<button class="btn btn-approve" data-task-status="done" data-id="' + esc(task.id) + '">Tandai selesai</button>';
  if (manager && !isClosed(task) && task.status !== "in_review" && task.status !== "approved") html += '<span class="section-note">Approval akan tersedia setelah hasil diajukan.</span>';
  return html;
}
function openTaskModal(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  state.selectedTaskId = taskId;
  const comments = state.comments.filter((item) => item.task_id === taskId);
  const files = state.attachments.filter((item) => item.task_id === taskId);
  const actions = taskActionButtons(task);
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="detail-task-title"><div class="modal-header"><div><div class="task-subline">' + statusBadge(task.status) + '<span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span></div><h2 id="detail-task-title" style="margin-top:7px">' + esc(task.title) + '</h2><p>Dibuat ' + esc(fmtDateTime(task.created_at)) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><div class="modal-body"><div class="detail-metadata"><div class="detail-meta"><span>Penanggung jawab</span><strong>' + esc(profileName(task.assigned_to)) + '</strong></div><div class="detail-meta"><span>Deadline</span><strong class="' + (isLate(task) ? "due-overdue" : "") + '">' + esc(task.due_date ? fmtDate(task.due_date) : "Belum diatur") + '</strong></div><div class="detail-meta"><span>Dibuat oleh</span><strong>' + esc(profileName(task.created_by)) + '</strong></div></div><h3 class="section-subtitle" style="margin-top:15px">Deskripsi pekerjaan</h3><div class="detail-description">' + esc(task.description || "Belum ada deskripsi.") + '</div><div class="heading-actions" style="margin-top:14px">' + actions + '</div><div id="revision-box" class="modal-form-note" hidden><form id="revision-form"><label class="field-label" for="revision-note">Apa yang harus diperbaiki?</label><textarea id="revision-note" name="comment" required maxlength="3000" style="display:block;width:100%;margin:8px 0;border:1px solid #e3d2a9;border-radius:8px;padding:10px;font:inherit;min-height:75px" placeholder="Tuliskan catatan revisi yang jelas…"></textarea><button type="submit" class="btn btn-warning btn-small">Kirim permintaan revisi</button></form></div><h3 class="section-subtitle">Lampiran <span class="role-badge">' + files.length + '</span></h3><div class="file-warning"><strong>Privasi:</strong><span>Upload hanya file non-rahasia yang diizinkan. File disimpan di bucket privat Supabase Storage tanpa link publik permanen. Paket gratis membatasi ukuran file maksimal 50 MB per file dan kapasitas total 1 GB.</span></div>' +
    (files.length ? files.map((file) => '<div class="file-row"><div class="file-type-icon">' + esc((file.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(formatBytes(file.size_bytes)) + " · " + esc(fmtDateTime(file.created_at)) + '</p></div><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button></div>').join("") : '<div class="empty-inline">Belum ada lampiran pada tugas ini.</div>') +
    '<form id="upload-form" class="form-stack" style="gap:8px;margin-top:12px"><label for="task-file-input">Tambah file (semua jenis file)</label><input id="task-file-input" name="file" type="file" required><p class="field-help">Batas unggah per file adalah 50 MB pada paket gratis Supabase. Batas ini mengikuti pengaturan penyimpanan project.</p><button class="btn btn-secondary" type="submit">Unggah lampiran</button></form><h3 class="section-subtitle">Komentar & catatan <span class="role-badge">' + comments.length + '</span></h3><div class="comment-list">' + (comments.length ? comments.map((c) => {
      const author = state.profiles.find((p) => p.id === c.user_id);
      return '<article class="comment"><div class="comment-top"><strong>' + esc(author ? author.display_name : "Anggota tim") + '</strong><time>' + esc(fmtDateTime(c.created_at)) + '</time></div><p>' + esc(c.comment) + "</p></article>";
    }).join("") : '<div class="empty-inline">Belum ada komentar. Gunakan bagian ini untuk koordinasi.</div>') + '</div><form id="comment-form" class="comment-form"><textarea name="comment" rows="2" required maxlength="3000" placeholder="Tulis komentar atau update singkat…"></textarea><button type="submit" class="btn btn-primary btn-small">Kirim</button></form></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Tutup</button></div></section></div>';
}
async function refreshTaskDetail(taskId) {
  await loadWorkspace();
  openTaskModal(taskId);
}
async function createTask(form) {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  if (!title) return toast("Judul pekerjaan wajib diisi.", "error");
  const payload = {
    title,
    description: String(data.get("description") || "").trim(),
    due_date: String(data.get("due_date") || "") || null,
    priority: String(data.get("priority") || "normal"),
    status: "todo",
    created_by: state.user.id,
    assigned_to: String(data.get("assigned_to") || state.user.id)
  };
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  button.textContent = "Menyimpan…";
  const { data: task, error } = await supabase.from("tasks").insert(payload).select("*").single();
  button.disabled = false;
  button.textContent = "Simpan pekerjaan";
  if (error) return toast("Tugas belum tersimpan: " + error.message, "error");
  $("#modal-root").innerHTML = "";
  toast("Pekerjaan berhasil dibuat.");
  await loadWorkspace();
  openTaskModal(task.id);
}
async function changeTaskStatus(taskId, newStatus) {
  if (!STATUS[newStatus]) return;
  const { error } = await supabase.from("tasks").update({ status: newStatus }).eq("id", taskId);
  if (error) {
    toast("Status belum berubah: " + error.message, "error");
    return;
  }
  const actionLabel = newStatus === "approved" ? "Hasil disetujui" :
    newStatus === "done" ? "Pekerjaan ditandai selesai" :
    newStatus === "in_review" ? "Pekerjaan diajukan untuk approval" :
    newStatus === "in_progress" ? "Pekerjaan dimulai" : "Status diperbarui";
  toast(actionLabel);
  await loadWorkspace();
  if ($("#modal-root").innerHTML) openTaskModal(taskId);
}
async function sendRevision(form) {
  const data = new FormData(form);
  const comment = String(data.get("comment") || "").trim();
  const taskId = state.selectedTaskId;
  if (!comment || !taskId) return toast("Catatan revisi wajib diisi.", "error");
  const { error: statusError } = await supabase.from("tasks").update({ status: "changes_requested" }).eq("id", taskId);
  if (statusError) return toast("Permintaan revisi belum tersimpan: " + statusError.message, "error");
  const { error: commentError } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: state.user.id, comment });
  if (commentError) toast("Status revisi tersimpan, tetapi catatan gagal tersimpan: " + commentError.message, "error");
  else toast("Permintaan revisi dan catatan berhasil dikirim.");
  await refreshTaskDetail(taskId);
}
async function addComment(form) {
  const data = new FormData(form);
  const comment = String(data.get("comment") || "").trim();
  const taskId = state.selectedTaskId;
  if (!comment || !taskId) return;
  const { error } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: state.user.id, comment });
  if (error) return toast("Komentar belum terkirim: " + error.message, "error");
  await refreshTaskDetail(taskId);
}
const STORAGE_BUCKET = "ruang-kerja-files";
const MAX_STORAGE_FILE_SIZE = 50 * 1024 * 1024;

function safeFilename(name) {
  return String(name || "file").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^\\.+/, "").slice(0, 100) || "file";
}
async function uploadPrivateFile(taskId, file) {
  if (!file || file.size < 1) throw new Error("File kosong.");
  if (file.size > MAX_STORAGE_FILE_SIZE) {
    throw new Error("Ukuran maksimum per file pada paket Supabase gratis adalah 50 MB. Kompres atau pecah file menjadi beberapa file lebih kecil.");
  }
  const path = taskId + "/" + state.user.id + "/" + crypto.randomUUID() + "-" + safeFilename(file.name);
  const { data, error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: "0",
    contentType: file.type || "application/octet-stream",
    upsert: false
  });
  if (error) throw new Error(error.message || "Supabase Storage gagal menerima file.");
  return { path: data.path || path, size: file.size };
}
async function uploadTaskFile(form) {
  const task = taskById(state.selectedTaskId);
  const file = $("#task-file-input")?.files?.[0];
  if (!task || !file) return;
  const button = $('button[type="submit"]', form);
  if (file.size > MAX_STORAGE_FILE_SIZE) {
    return toast("Maksimum 50 MB per file pada paket gratis. Kompres atau pecah file terlebih dahulu.", "error");
  }
  button.disabled = true;
  button.textContent = "Mengunggah ke Supabase…";
  let uploaded = null;
  try {
    uploaded = await uploadPrivateFile(task.id, file);
    const { error: metaError } = await supabase.from("task_attachments").insert({
      task_id: task.id,
      path: uploaded.path,
      file_name: file.name.slice(0, 255),
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
      uploaded_by: state.user.id
    });
    if (metaError) {
      await supabase.storage.from(STORAGE_BUCKET).remove([uploaded.path]);
      throw new Error("File sudah masuk penyimpanan, tetapi catatan lampiran gagal disimpan. " + metaError.message);
    }
    toast("Lampiran berhasil diunggah (" + formatBytes(file.size) + ").");
    await refreshTaskDetail(task.id);
  } catch (error) {
    button.disabled = false;
    button.textContent = "Unggah lampiran";
    toast("Upload belum selesai: " + (error.message || "periksa koneksi atau kuota Supabase"), "error");
  }
}
async function downloadFile(attachmentId) {
  const file = state.attachments.find((item) => item.id === attachmentId);
  if (!file) return toast("Lampiran tidak ditemukan.", "error");
  try {
    const { data, error } = await supabase.storage.from(STORAGE_BUCKET)
      .createSignedUrl(file.path, 60, { download: file.file_name });
    if (error) throw error;
    if (!data?.signedUrl) throw new Error("Supabase tidak memberikan tautan unduhan.");
    const link = document.createElement("a");
    link.href = data.signedUrl;
    link.rel = "noopener";
    link.download = file.file_name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  } catch (error) {
    toast("File tidak dapat diunduh: " + (error.message || "kesalahan tidak diketahui"), "error");
  }
}

async function deriveBackupKey(passphrase, salt, usages) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: 310000, hash: "SHA-256" },
    material, { name: "AES-GCM", length: 256 }, false, usages
  );
}
function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}
async function exportEncryptedBackup() {
  if (currentRole() !== "manager") return toast("Backup penuh hanya tersedia untuk manager.", "error");
  const passphrase = window.prompt("Buat password backup minimal 16 karakter. Simpan di tempat aman; tanpa password ini backup tidak bisa dipulihkan.");
  if (!passphrase) return;
  if (passphrase.length < 16) return toast("Password backup harus minimal 16 karakter.", "error");
  const confirmation = window.prompt("Ketik ulang password backup untuk konfirmasi.");
  if (confirmation !== passphrase) return toast("Konfirmasi password tidak cocok. Backup dibatalkan.", "error");
  toast("Menyiapkan data dan lampiran untuk backup…", "success");
  try {
    const [tasksRes, commentsRes, attachmentsRes, activitiesRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at"),
      supabase.from("task_comments").select("*").order("created_at"),
      supabase.from("task_attachments").select("*").order("created_at"),
      supabase.from("activity_log").select("*").order("created_at")
    ]);
    for (const result of [tasksRes, commentsRes, attachmentsRes, activitiesRes]) {
      if (result.error) throw result.error;
    }
    const attachmentTotalBytes = (attachmentsRes.data || []).reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    if (attachmentTotalBytes > 300 * 1024 * 1024) {
      throw new Error("Total lampiran melebihi 300 MB. Backup terenkripsi berbasis browser belum aman untuk paket sebesar ini. Simpan salinan file besar secara terpisah di media backup terenkripsi sebelum mengandalkan backup database.");
    }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = new JSZip();
    const manifest = {
      format: "ruang-kerja-encrypted-backup",
      version: 1,
      created_at: new Date().toISOString(),
      profiles: state.profiles.map((p) => ({ id: p.id, display_name: p.display_name, role: p.role })),
      tasks: tasksRes.data || [],
      comments: commentsRes.data || [],
      attachments: attachmentsRes.data || [],
      activities: activitiesRes.data || []
    };
    zip.file("backup.json", JSON.stringify(manifest));
    const attachmentRows = manifest.attachments;
    for (let i = 0; i < attachmentRows.length; i++) {
      const item = attachmentRows[i];
      const { data: blob, error: downloadError } = await supabase.storage.from(STORAGE_BUCKET).download(item.path);
      if (downloadError || !blob) throw new Error("Lampiran tidak bisa dibaca: " + item.file_name + (downloadError ? " — " + downloadError.message : ""));
      zip.file("files/" + item.id, blob);
      if ((i + 1) % 5 === 0 || i === attachmentRows.length - 1) {
        toast("Menyiapkan lampiran " + (i + 1) + "/" + attachmentRows.length + "…", "success");
      }
    }
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 5 } });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase, salt, ["encrypt"]);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, archive));
    const envelope = new Uint8Array(36 + encrypted.length);
    envelope.set([82, 75, 87, 49, 0, 0, 0, 1], 0);
    envelope.set(salt, 8); envelope.set(iv, 24); envelope.set(encrypted, 36);
    saveBlob(new Blob([envelope], { type: "application/octet-stream" }), "ruang-kerja-backup-" + new Date().toISOString().slice(0, 10) + ".rkbak");
    toast("Backup terenkripsi berhasil diunduh. Simpan salinan di tempat terpisah yang aman.", "success");
  } catch (error) {
    toast("Backup gagal: " + (error.message || "kesalahan yang tidak diketahui"), "error");
  }
}
async function insertInChunks(table, rows, chunkSize = 40) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}
async function restoreEncryptedBackup(file) {
  if (currentRole() !== "manager") return toast("Pemulihan backup hanya tersedia untuk manager.", "error");
  if (!file || file.size < 64 || file.size > 400 * 1024 * 1024) return toast("File backup tidak valid atau melebihi batas 400 MB.", "error");
  const passphrase = window.prompt("Masukkan password yang dipakai saat membuat backup.");
  if (!passphrase) return;
  toast("Memverifikasi dan membuka backup…", "success");
  try {
    const envelope = new Uint8Array(await file.arrayBuffer());
    const magic = [82, 75, 87, 49, 0, 0, 0, 1];
    if (!magic.every((value, index) => envelope[index] === value)) throw new Error("Format file backup tidak dikenali.");
    const salt = envelope.slice(8, 24);
    const iv = envelope.slice(24, 36);
    const encrypted = envelope.slice(36);
    const key = await deriveBackupKey(passphrase, salt, ["decrypt"]);
    let archive;
    try {
      archive = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted));
    } catch (_) {
      throw new Error("Password salah atau file backup rusak.");
    }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = await JSZip.loadAsync(archive);
    const manifestFile = zip.file("backup.json");
    if (!manifestFile) throw new Error("Isi backup.json tidak ditemukan.");
    const backup = JSON.parse(await manifestFile.async("string"));
    if (backup.format !== "ruang-kerja-encrypted-backup" || backup.version !== 1 ||
        !Array.isArray(backup.tasks) || !Array.isArray(backup.comments) ||
        !Array.isArray(backup.attachments) || !Array.isArray(backup.activities) ||
        !Array.isArray(backup.profiles)) throw new Error("Struktur backup tidak valid.");
    const profileMap = {};
    backup.profiles.forEach((oldProfile) => {
      const match = state.profiles.find((p) => p.role === oldProfile.role);
      if (match) profileMap[oldProfile.id] = match.id;
    });
    const mapProfile = (id) => id ? profileMap[id] : null;
    if (backup.profiles.some((p) => !profileMap[p.id])) throw new Error("Role anggota backup tidak cocok dengan akun tim saat ini.");
    const { data: presentTasks, error: taskReadError } = await supabase.from("tasks").select("id");
    if (taskReadError) throw taskReadError;
    const taskIds = new Set((presentTasks || []).map((t) => t.id));
    let restoredTasks = 0;
    const statusToRestore = [];
    for (const old of backup.tasks) {
      if (taskIds.has(old.id)) continue;
      const createdBy = mapProfile(old.created_by);
      const assignedTo = mapProfile(old.assigned_to);
      if (!createdBy || !assignedTo) throw new Error("PIC atau pembuat tugas tidak dapat dipetakan.");
      const payload = {
        id: old.id, title: old.title, description: old.description || "",
        due_date: old.due_date || null, priority: old.priority || "normal",
        status: "todo", created_by: createdBy, assigned_to: assignedTo,
        created_at: old.created_at
      };
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
      taskIds.add(old.id); restoredTasks++;
      if (old.status && old.status !== "todo") statusToRestore.push({ id: old.id, status: old.status });
    }
    for (const row of statusToRestore) {
      const { error } = await supabase.from("tasks").update({ status: row.status }).eq("id", row.id);
      if (error) throw error;
    }
    const { data: presentComments, error: commentReadError } = await supabase.from("task_comments").select("id");
    if (commentReadError) throw commentReadError;
    const commentIds = new Set((presentComments || []).map((r) => r.id));
    const missingComments = backup.comments.filter((c) => !commentIds.has(c.id)).map((c) => ({
      id: c.id, task_id: c.task_id, user_id: mapProfile(c.user_id),
      comment: c.comment, created_at: c.created_at
    }));
    if (missingComments.some((c) => !c.user_id)) throw new Error("Penulis komentar tidak dapat dipetakan.");
    await insertInChunks("task_comments", missingComments);
    const { data: presentAttachments, error: attachmentReadError } = await supabase.from("task_attachments").select("id,path");
    if (attachmentReadError) throw attachmentReadError;
    const attachmentIds = new Set((presentAttachments || []).map((r) => r.id));
    const attachmentPaths = new Set((presentAttachments || []).map((r) => r.path));
    const missingMetadata = [];
    for (const item of backup.attachments) {
      if (attachmentIds.has(item.id) || attachmentPaths.has(item.path)) continue;
      const entry = zip.file("files/" + item.id);
      if (!entry) throw new Error("Konten lampiran tidak ada di backup: " + item.file_name);
      const bytes = await entry.async("uint8array");
      const blob = new Blob([bytes], { type: item.content_type || "application/octet-stream" });
      const restoredFile = new File([blob], item.file_name, { type: item.content_type || "application/octet-stream" });
      const uploaded = await uploadPrivateFile(item.task_id, restoredFile);
      const uploadedBy = mapProfile(item.uploaded_by);
      if (!uploadedBy) throw new Error("Pemilik lampiran tidak dapat dipetakan.");
      missingMetadata.push({
        id: item.id, task_id: item.task_id, path: uploaded.path,
        file_name: item.file_name, content_type: item.content_type || "application/octet-stream",
        size_bytes: item.size_bytes, uploaded_by: uploadedBy, created_at: item.created_at
      });
      attachmentIds.add(item.id); attachmentPaths.add(uploaded.path);
    }
    await insertInChunks("task_attachments", missingMetadata, 20);
    const { data: presentActivity, error: activityReadError } = await supabase.from("activity_log").select("id");
    if (activityReadError) throw activityReadError;
    const activityIds = new Set((presentActivity || []).map((r) => r.id));
    const missingActivity = backup.activities.filter((a) => !activityIds.has(a.id)).map((a) => ({
      id: a.id, task_id: a.task_id || null, actor_id: mapProfile(a.actor_id),
      action: a.action, details: a.details || {}, created_at: a.created_at
    }));
    await insertInChunks("activity_log", missingActivity, 40);
    await loadWorkspace();
    toast("Pemulihan selesai. " + restoredTasks + " tugas yang sebelumnya belum ada berhasil dipulihkan; data yang sudah ada tidak ditimpa.", "success");
  } catch (error) {
    toast("Pemulihan belum selesai: " + (error.message || "kesalahan yang tidak diketahui") + ". Kamu dapat mencoba lagi; catatan yang sudah ada tidak ditimpa.", "error");
  }
}

function closeModal() {
  $("#modal-root").innerHTML = "";
  state.selectedTaskId = null;
}
async function logout() {
  if (supabase) await supabase.auth.signOut();
  state.user = null;
  state.profile = null;
  state.profiles = [];
  state.tasks = [];
  state.comments = [];
  state.attachments = [];
  state.activities = [];
  showAuth("Kamu sudah keluar dari ruang kerja.", "success");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const data = new FormData(form);
  button.disabled = true; button.textContent = "Memeriksa akun…"; setAuthMessage("");
  const { error } = await supabase.auth.signInWithPassword({
    email: String(data.get("email") || "").trim(),
    password: String(data.get("password") || "")
  });
  button.disabled = false; button.textContent = "Masuk ke ruang kerja";
  if (error) setAuthMessage("Login gagal. Periksa email, password, atau konfirmasi email kamu.", "error");
});
$("#register-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const data = new FormData(form);
  const email = String(data.get("email") || "").trim();
  const password = String(data.get("password") || "");
  const fullName = String(data.get("full_name") || "").trim();
  const inviteCode = String(data.get("invite_code") || "").trim().toUpperCase().replace(/\s+/g, "");
  if (password.length < 12) return setAuthMessage("Gunakan password minimal 12 karakter.", "error");
  if (inviteCode.length < 20) return setAuthMessage("Kode undangan tidak lengkap.", "error");
  button.disabled = true; button.textContent = "Mengaktifkan…"; setAuthMessage("");
  const { data: result, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { full_name: fullName, invite_code: inviteCode } }
  });
  button.disabled = false; button.textContent = "Aktifkan akun";
  if (error) return setAuthMessage("Pendaftaran gagal. Pastikan kode undangan benar dan belum pernah digunakan. " + error.message, "error");
  form.reset();
  if (result.session) {
    setAuthMessage("Akun aktif. Membuka ruang kerja…", "success");
    await enterApp(result.user);
  } else {
    setAuthMode("login");
    setAuthMessage("Pendaftaran diterima. Jika konfirmasi email aktif, buka email kamu untuk mengonfirmasi akun terlebih dahulu, lalu login.", "success");
  }
});
$$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) { changeView(nav.dataset.view); return; }
  if (event.target.closest("#new-task-top") || event.target.closest("[data-create-task]")) { openCreateModal(); return; }
  if (event.target.closest("#mobile-menu-button")) { $("#sidebar").classList.toggle("mobile-open"); return; }
  if (event.target.closest("#logout-button")) { await logout(); return; }
  const openTask = event.target.closest(".task-open");
  if (openTask) { openTaskModal(openTask.dataset.id); return; }
  const quickStatus = event.target.closest(".task-quick-status");
  if (quickStatus) { await changeTaskStatus(quickStatus.dataset.id, quickStatus.dataset.status); return; }
  const status = event.target.closest("[data-task-status]");
  if (status) { await changeTaskStatus(status.dataset.id, status.dataset.taskStatus); return; }
  const revision = event.target.closest("[data-show-revision]");
  if (revision) { const box = $("#revision-box"); box.hidden = !box.hidden; $("#revision-note")?.focus(); return; }
  if (event.target.closest("[data-backup-export]")) { await exportEncryptedBackup(); return; }
  if (event.target.closest("[data-backup-restore]")) {
    if (currentRole() !== "manager") return toast("Pemulihan backup hanya tersedia untuk manager.", "error");
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = ".rkbak,application/octet-stream";
    picker.addEventListener("change", () => restoreEncryptedBackup(picker.files && picker.files[0]));
    picker.click(); return;
  }
  const download = event.target.closest(".download-file");
  if (download) { await downloadFile(download.dataset.id); return; }
  if (event.target.closest(".close-modal")) { closeModal(); return; }
  if (event.target.matches("[data-backdrop]")) { closeModal(); }
});
document.addEventListener("input", (event) => { if (event.target.id === "task-search") applyTaskFilters(); });
document.addEventListener("change", (event) => {
  if (event.target.id === "task-status-filter" || event.target.id === "task-priority-filter") applyTaskFilters();
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "create-task-form") { event.preventDefault(); await createTask(event.target); }
  else if (event.target.id === "revision-form") { event.preventDefault(); await sendRevision(event.target); }
  else if (event.target.id === "comment-form") { event.preventDefault(); await addComment(event.target); }
  else if (event.target.id === "upload-form") { event.preventDefault(); await uploadTaskFile(event.target); }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && $("#modal-root").innerHTML) closeModal();
});

if (!configured) {
  showConfigWarning();
} else {
  supabase.auth.getSession().then(({ data, error }) => {
    if (error) showAuth("Sesi tidak dapat dibaca. Silakan login kembali.", "error");
    else if (data.session) enterApp(data.session.user);
  }).catch(() => showAuth("Koneksi belum tersedia. Coba refresh halaman.", "error"));
  supabase.auth.onAuthStateChange((event, session) => {
    if (session && ["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED"].includes(event)) {
      window.setTimeout(() => enterApp(session.user), 0);
    } else if (event === "SIGNED_OUT") {
      state.user = null;
      state.profile = null;
      showAuth();
    }
  });
}
