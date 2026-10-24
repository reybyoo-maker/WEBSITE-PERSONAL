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
const savedInstagramPosts = (() => {
  try {
    const parsed = JSON.parse(localStorage.getItem("ruang-kerja-instagram-posts") || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((post) => post && typeof post === "object" && typeof post.url === "string")
      .slice(0, 30).map((post) => ({
        id: String(post.id || ("ig-" + Math.random().toString(36).slice(2))),
        url: String(post.url || ""),
        shortcode: String(post.shortcode || ""),
        image_url: String(post.image_url || post.thumbnail_url || ""),
        caption: String(post.caption || ""),
        timestamp: post.timestamp || null,
        likes: Number.isFinite(Number(post.likes)) && post.likes !== null && post.likes !== "" ? Number(post.likes) : null,
        comments: Number.isFinite(Number(post.comments)) && post.comments !== null && post.comments !== "" ? Number(post.comments) : null,
        shares: Number.isFinite(Number(post.shares)) && post.shares !== null && post.shares !== "" ? Number(post.shares) : null,
        reposts: Number.isFinite(Number(post.reposts)) && post.reposts !== null && post.reposts !== "" ? Number(post.reposts) : null,
        lookup_status: String(post.lookup_status || "saved"),
        lookup_error: String(post.lookup_error || ""),
        last_attempt_at: Number(post.last_attempt_at || 0),
        fetched_at: post.fetched_at || null
      }));
  } catch { return []; }
})();
const state = {
  user: null, profile: null, profiles: [], tasks: [], comments: [], attachments: [], contentAssets: [], activities: [], visitSchedules: [],
  view: "dashboard", selectedTaskId: null, loading: false, googleDriveConnected: false, previewObjectUrl: null, previewRequestId: 0,
  instagramReport: { loading: false, error: "", posts: savedInstagramPosts, lastFetched: null, lastAttemptAt: 0 }
};
const STATUS = {
  todo: "Belum dimulai",
  in_progress: "Sedang dikerjakan",
  in_review: "Menunggu approval",
  changes_requested: "Perlu revisi",
  approved: "Disetujui",
  done: "Done",
  archived: "Diarsipkan"
};
const PRIORITY = { low: "Rendah", normal: "Normal", high: "Tinggi", urgent: "Urgent" };
const VISIT_STATUS = { fixed: "Fix", planned: "Masih rencana", cancelled: "Batal" };
const MAX_STORAGE_FILE_SIZE = 800 * 1024 * 1024;
const STORAGE_CHUNK_SIZE = 20 * 1024 * 1024;
const PAGE_TITLE = {
  dashboard: "Dashboard", tasks: "Semua pekerjaan", approvals: "Approval & revisi",
  files: "Arsip & file", content: "Content", instagram: "Instagram Engagement Report", visits: "Visit offline", activity: "Riwayat aktivitas"
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
function fmtClock(value) {
  return value ? String(value).slice(0, 5) : "";
}
function deadlineLabel(task, fallback = "—") {
  return task?.due_date ? fmtDate(task.due_date) + (task.due_time ? " · " + fmtClock(task.due_time) : "") : fallback;
}
function contentScheduleLabel(item) {
  return (item.scheduled_date ? fmtDate(item.scheduled_date) : "Tanggal belum diatur") +
    " · " + (item.scheduled_time ? fmtClock(item.scheduled_time) : "Jam belum diatur");
}
function roleLabel(role) { return "Akses penuh"; }
function statusBadge(status) {
  return '<span class="status status-' + esc(status) + '">' + esc(STATUS[status] || status) + "</span>";
}
function isClosed(task) { return ["approved", "done", "archived"].includes(task.status); }
function isLate(task) {
  if (!task.due_date || isClosed(task) || task.status === "in_review") return false;
  const dueAt = new Date(task.due_date + "T" + (task.due_time ? String(task.due_time).slice(0, 8) : "23:59:59"));
  return !Number.isNaN(dueAt.getTime()) && dueAt.getTime() < Date.now();
}
function profileName(id) {
  const found = state.profiles.find((item) => item.id === id);
  return found ? (found.access_label || found.display_name || "Kode") : "Belum ditentukan";
}
function profileColorToken(profile) { return profile && profile.access_color === "#ec4899" ? "pink" : "red"; }
function profileColorLabel(profile) { return profileColorToken(profile) === "pink" ? "Pink" : "Merah"; }
function getStoredPaths(item) {
  return Array.isArray(item?.storage_parts) && item.storage_parts.length
    ? item.storage_parts.filter((path) => typeof path === "string" && path)
    : (item?.path ? [item.path] : []);
}
function visitWindowLabel(visit) {
  return fmtDate(visit.visit_date) + " · " + fmtClock(visit.start_time) + " — " + fmtDate(visit.end_date) + " · " + fmtClock(visit.end_time);
}
function taskById(id) { return state.tasks.find((item) => item.id === id); }
function groupContentAssets(assets = state.contentAssets) {
  const groups = new Map();
  for (const asset of assets) {
    const key = asset.content_group_id || asset.id;
    if (!groups.has(key)) groups.set(key, { ...asset, content_group_id: key, files: [] });
    const group = groups.get(key);
    group.files.push(asset);
    if (asset.created_at && asset.created_at < group.created_at) group.created_at = asset.created_at;
  }
  return [...groups.values()];
}
function contentFormatLabel(format) { return ({ reels: "Reels", feed: "Feed", carousel: "Carousel" })[format] || "Feed"; }
function deadlineStatusBadge(task) {
  if (!task?.due_date || ["in_review", "approved", "done", "archived"].includes(task.status)) return "";
  if (isLate(task)) return '<span class="status status-deadline-late">Terlambat</span>';
  return '<span class="status status-deadline-active">Aktif</span>';
}
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
function showAuth(message = "", kind = "") {
  $("#app-shell").hidden = true;
  $("#auth-shell").hidden = false;
  $("#modal-root").innerHTML = "";
  $("#login-form")?.reset();
  setAuthMessage(message, kind);
}
function showConfigWarning() {
  const node = $("#config-warning");
  node.hidden = false;
  node.innerHTML = "<strong>Setup belum selesai.</strong> Isi Project URL dan public anon/publishable key di <b>config.js</b>, lalu jalankan <b>supabase/schema.sql</b> di SQL Editor. Jangan memasukkan service-role/secret key di website.";
  $$("#login-form button").forEach((button) => { button.disabled = true; });
}
function showLoading(text = "Memuat ruang kerja…") {
  $("#page-content").innerHTML = '<div class="loading-state"><span class="spinner"></span>' + esc(text) + "</div>";
}
function currentRole() { return state.profile ? state.profile.role : "member"; }
function taskDetails(task) {
  const title = esc(task.title);
  const due = deadlineLabel(task, "Tanpa deadline");
  const dueClass = isLate(task) ? "due-overdue" : "";
  const pName = profileName(task.assigned_to);
  return '<div class="task-main"><span class="task-title">' + title + '</span><div class="task-subline"><span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span><span class="' + dueClass + '">Deadline: ' + esc(due) + '</span><span>PIC: ' + esc(pName) + "</span></div></div>";
}
function taskRow(task, actionLabel = "Detail") {
  return '<div class="task-row"><div class="task-main-wrap">' + taskDetails(task) + '</div><div class="task-actions">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<button class="btn btn-secondary btn-small task-open" data-id="' + esc(task.id) + '">' + esc(actionLabel) + "</button></div></div>";
}
function personChip(id) {
  const profile = state.profiles.find((item) => item.id === id);
  const name = profile ? (profile.access_label || profile.display_name) : "Belum ditentukan";
  return '<span class="person-chip"><span class="avatar avatar-code-' + profileColorToken(profile) + '">' + esc(initials(name)) + "</span>" + esc(name) + "</span>";
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
  const completed = state.tasks.filter((t) => t.status === "done").length;
  const pending = state.tasks.filter((t) => t.status === "in_review").length + groupContentAssets().filter((c) => c.status === "in_review").length;
  const overdue = active.filter(isLate).length;
  const recent = active.slice().sort((a, b) => {
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    const dateDiff = a.due_date.localeCompare(b.due_date);
    if (dateDiff) return dateDiff;
    return String(a.due_time || "23:59:59").localeCompare(String(b.due_time || "23:59:59"));
  }).slice(0, 5);
  const needsMe = state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length + groupContentAssets().filter((c) => c.status === "in_review" || c.status === "changes_requested").length;
  const upcomingVisits = state.visitSchedules.filter((v) => v.status !== "cancelled" && v.visit_date >= today).length;
  return '<div class="page-heading"><div><h2>Halo, ' + esc(state.profile.access_label || state.profile.display_name) + '.</h2><p>Berikut ringkasan pekerjaan tim kamu hari ini.</p></div><div class="heading-actions">' + openCreateButton() + '</div></div>' +
    '<div class="stats-grid">' +
    statCard("Tugas aktif", active.length, "☷", "Semua pekerjaan yang belum selesai") +
    statCard("Tugas selesai", completed, "✓", "Total tugas berstatus Done") +
    statCard("Deadline hari ini", dueToday, "◷", "Perlu dituntaskan hari ini") +
    statCard("Menunggu approval", needsMe, "✓", "Tugas dan content menunggu keputusan atau revisi") +
    statCard("Terlambat", overdue, "!", overdue ? "Periksa dan perbarui progres" : "Tidak ada tugas terlambat") +
    '</div><div class="dashboard-grid"><section class="panel"><div class="panel-header"><div><h3>Deadline terdekat</h3><p>Prioritas untuk beberapa hari ke depan</p></div><button class="text-action" data-view="tasks">Lihat semua →</button></div>' +
    (recent.length ? '<div class="task-list">' + recent.map((t) => taskRow(t, "Buka")).join("") + '</div>' : emptyState("Belum ada pekerjaan aktif", "Buat tugas pertama supaya deadline dan progres tercatat.", openCreateButton("Buat tugas pertama"))) +
    '</section><section class="panel"><div class="panel-header"><div><h3>Butuh perhatian</h3><p>Approval, revisi, atau tugas lewat deadline</p></div></div><div class="panel-body"><div class="mini-list">' +
    (overdue ? '<div class="mini-item"><span class="mini-dot" style="background:#b44343"></span><div class="mini-copy"><strong>' + overdue + ' tugas terlambat</strong><p>Periksa deadline dan kabari penanggung jawab.</p></div></div>' : "") +
    (pending ? '<div class="mini-item"><span class="mini-dot" style="background:#6b54a3"></span><div class="mini-copy"><strong>' + pending + ' tugas menunggu approval</strong><p>Buka menu Approval untuk meninjau hasil yang diajukan.</p><button class="text-action" data-view="approvals">Buka approval →</button></div></div>' : "") +
    (upcomingVisits ? '<div class="mini-item"><span class="mini-dot" style="background:#2f68a8"></span><div class="mini-copy"><strong>' + upcomingVisits + ' schedule visit mendatang</strong><p>Periksa kota dan waktu kunjungan offline.</p><button class="text-action" data-view="visits">Buka schedule visit →</button></div></div>' : "") +
    (needsMe === 0 && overdue === 0 && pending === 0 ? '<div class="mini-item"><span class="mini-dot" style="background:#21785b"></span><div class="mini-copy"><strong>Semua terkendali</strong><p>Belum ada hal mendesak yang membutuhkan perhatian.</p></div></div>' : "") +
    '<div class="mini-item"><span class="mini-dot" style="background:' + esc(state.profile.access_color || "#dc2626") + '"></span><div class="mini-copy"><strong>' + esc(state.profile.access_label || state.profile.display_name) + ' · ' + esc(profileColorLabel(state.profile)) + '</strong><p>Kode login dibedakan melalui warna avatar. Kedua kode memiliki hak akses tim yang sama.</p></div></div>' +
    '</div></div></section></div>';
}

function renderTasks() {
  const rows = state.tasks.slice().sort((a, b) => {
    const rank = { in_review: 0, changes_requested: 1, in_progress: 2, todo: 3, approved: 4, done: 5, archived: 6 };
    const diff = (rank[a.status] ?? 9) - (rank[b.status] ?? 9);
    if (diff) return diff;
    if (!a.due_date && !b.due_date) return 0;
    if (!a.due_date) return 1;
    if (!b.due_date) return -1;
    const dateDiff = a.due_date.localeCompare(b.due_date);
    return dateDiff || String(a.due_time || "23:59:59").localeCompare(String(b.due_time || "23:59:59"));
  });
  return '<div class="page-heading"><div><h2>Semua pekerjaan</h2><p>Semua tugas tim, PIC, deadline, dan statusnya.</p></div><div class="heading-actions">' + openCreateButton() + '</div></div>' +
    '<div class="toolbar"><label class="search-box"><span class="search-mark">⌕</span><input id="task-search" type="search" placeholder="Cari judul atau deskripsi…" autocomplete="off"></label><select id="task-status-filter" class="filter-select" aria-label="Filter status"><option value="">Semua status</option>' +
    Object.keys(STATUS).map((key) => '<option value="' + key + '">' + esc(STATUS[key]) + '</option>').join("") +
    '</select><select id="task-priority-filter" class="filter-select" aria-label="Filter prioritas"><option value="">Semua prioritas</option>' +
    Object.keys(PRIORITY).map((key) => '<option value="' + key + '">' + esc(PRIORITY[key]) + '</option>').join("") +
    '</select></div><section class="panel"><div class="task-table-wrap"><table class="task-table"><thead><tr><th>Pekerjaan</th><th>Status</th><th>PIC</th><th>Deadline</th><th>Prioritas</th><th>Aksi</th></tr></thead><tbody>' +
    (rows.length ? rows.map((task) => '<tr data-status="' + esc(task.status) + '" data-priority="' + esc(task.priority) + '" data-search="' + esc((task.title + " " + (task.description || "") + " " + profileName(task.assigned_to)).toLowerCase()) + '"><td><button class="table-task-button task-open" data-id="' + esc(task.id) + '">' + esc(task.title) + '</button><span class="table-description">' + esc(task.description || "Tidak ada deskripsi") + '</span></td><td>' + statusBadge(task.status) + ' ' + deadlineStatusBadge(task) + '</td><td>' + personChip(task.assigned_to) + '</td><td class="due-cell ' + (isLate(task) ? "due-overdue" : "") + '">' + esc(deadlineLabel(task, "—")) + '</td><td>' + esc(PRIORITY[task.priority] || task.priority) + '</td><td><button class="btn btn-ghost btn-small delete-task" data-id="' + esc(task.id) + '">Hapus tugas</button></td></tr>').join("") : '<tr><td colspan="6">' + emptyState("Belum ada tugas", "Tambahkan pekerjaan pertama untuk tim.") + '</td></tr>') +
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
  const candidates = state.tasks.filter((t) => ["in_review", "changes_requested"].includes(t.status));
  const contentCandidates = groupContentAssets().filter((c) => ["in_review", "changes_requested"].includes(c.status));
  const taskCards = candidates.map((task) => {
    const latestComment = state.comments.filter((comment) => comment.task_id === task.id).slice(-1)[0];
    const revisionNote = task.status === "changes_requested" && latestComment
      ? '<p class="revision-note-display"><strong>Catatan revisi:</strong> ' + esc(latestComment.comment) + '</p>' : "";
    const resultFiles = state.attachments.filter((file) => file.task_id === task.id && file.attachment_type === "result");
    const resultMarkup = resultFiles.length
      ? '<div class="approval-result-files"><strong>Hasil Sudah Dikerjakan (' + resultFiles.length + ')</strong>' + resultFiles.map((file) => '<div class="approval-result-file"><span>' + esc(file.file_name) + ' · ' + esc(formatBytes(file.size_bytes)) + '</span><button class="btn btn-secondary btn-small preview-file" data-kind="attachment" data-id="' + esc(file.id) + '">Preview</button><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh hasil</button></div>').join("") + '</div>'
      : '<p class="approval-result-missing">Belum ada hasil yang dilampirkan.</p>';
    return '<article class="approval-card"><div><h3>' + esc(task.title) + '</h3><p>' + esc((task.description || "Tidak ada deskripsi").slice(0, 170)) + '</p>' + revisionNote + resultMarkup + '<div class="task-subline">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<span>PIC: ' + esc(profileName(task.assigned_to)) + '</span><span>Deadline: ' + esc(deadlineLabel(task, "—")) + '</span></div></div><div class="approval-actions"><button class="btn btn-secondary btn-small task-open" data-id="' + esc(task.id) + '">Buka tugas</button>' + (task.status === "in_review" ? '<button class="btn btn-warning btn-small task-quick-revision" data-id="' + esc(task.id) + '">Revisi</button><button class="btn btn-approve btn-small task-quick-status" data-id="' + esc(task.id) + '" data-status="done">Approval · Done</button>' : "") + '</div></article>';
  }).join("");
  const contentCards = contentCandidates.map((content) => '<article class="approval-card"><div><h3>' + esc(content.title) + ' <span class="role-badge">' + esc(contentFormatLabel(content.content_format)) + '</span></h3><p>' + esc(content.caption || "Tidak ada caption.") + '</p><div class="task-subline">' + statusBadge(content.status) + '<span>' + content.files.length + ' file</span><span>Jadwal: ' + esc(contentScheduleLabel(content)) + '</span></div>' + (content.revision_note ? '<p class="revision-note-display"><strong>Catatan revisi:</strong> ' + esc(content.revision_note) + '</p>' : '') + '</div><div class="approval-actions">' + (content.status === "in_review" ? '<button class="btn btn-warning btn-small content-quick-revision" data-id="' + esc(content.content_group_id) + '">Revisi</button><button class="btn btn-approve btn-small content-quick-approve" data-id="' + esc(content.content_group_id) + '">Approval · Done</button>' : '<button class="btn btn-secondary btn-small" data-view="content">Buka content</button>') + '</div></article>').join("");
  const total = candidates.length + contentCandidates.length;
  return '<div class="page-heading"><div><h2>Approval & revisi</h2><p>Tugas dan content yang sudah diajukan masuk ke sini. Approval akan mengubah status menjadi Done.</p></div></div><section class="panel"><div class="panel-header"><div><h3>Menunggu approval atau perlu revisi</h3><p>' + total + ' item perlu perhatian</p></div></div>' +
    (total ? taskCards + contentCards : emptyState("Tidak ada approval tertunda", "Klik Sudah beres pada tugas atau content untuk mengirimkannya ke review.")) + '</section>';
}
function renderFiles() {
  const items = state.attachments.slice().sort((a, b) => b.created_at.localeCompare(a.created_at));
  return '<div class="page-heading"><div><h2>Arsip & file</h2><p>Lampiran File, Contoh, dan Hasil Sudah Dikerjakan yang terkait dengan tugas.</p></div><div class="heading-actions"><button class="btn btn-secondary" data-backup-export>Backup terenkripsi</button><button class="btn btn-secondary" data-backup-restore>Pulihkan backup</button></div></div><div class="file-warning"><strong>Penyimpanan privat:</strong><span>File baru disimpan langsung di Supabase Storage. File akan dibersihkan otomatis setelah melewati 14 hari.</span></div><div class="file-warning"><strong>Perhatian:</strong><span>Hanya unggah file non-rahasia yang memang boleh disimpan di layanan cloud ini.</span></div><section class="panel"><div class="panel-header"><div><h3>Semua lampiran</h3><p>Lampiran dipisahkan menjadi tiga kategori: Lampiran File, Contoh, dan Hasil Sudah Dikerjakan.</p></div><span class="role-badge">' + items.length + ' file</span></div>' +
    (items.length ? items.map((file) => {
      const task = taskById(file.task_id);
      const ext = (file.file_name.split(".").pop() || "FILE").slice(0, 5).toUpperCase();
      const canSubmit = task && !["in_review", "approved", "done", "archived"].includes(task.status);
      return '<div class="file-row"><div class="file-type-icon">' + esc(ext) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(attachmentTypeLabel(file.attachment_type)) + ' · ' + esc(task ? task.title : "Tugas") + ' · ' + esc(fmtDateTime(file.created_at)) + ' · ' + esc(formatBytes(file.size_bytes)) + '</p></div><div class="file-row-actions"><button class="btn btn-secondary btn-small preview-file" data-kind="attachment" data-id="' + esc(file.id) + '">Preview</button><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button>' + (canSubmit ? '<button class="btn btn-primary btn-small submit-task-file" data-id="' + esc(task.id) + '">Ajukan approval</button>' : '') + '<button class="btn btn-ghost btn-small delete-task-file" data-id="' + esc(file.id) + '">Hapus</button></div></div>';
    }).join("") : emptyState("Belum ada lampiran", "Buka detail tugas untuk menambahkan Lampiran File, Contoh, atau Hasil Sudah Dikerjakan.")) + '</section>';
}
function renderContent() {
  const items = groupContentAssets().sort((a, b) => {
    if (a.scheduled_date && b.scheduled_date) {
      const diff = (a.scheduled_date + "T" + (a.scheduled_time || "23:59:59")).localeCompare(b.scheduled_date + "T" + (b.scheduled_time || "23:59:59"));
      if (diff) return diff;
    }
    if (a.scheduled_date && !b.scheduled_date) return -1;
    if (!a.scheduled_date && b.scheduled_date) return 1;
    return b.created_at.localeCompare(a.created_at);
  });
  const rows = items.length ? items.map((item) => {
    const fileRows = item.files.map((file) => '<div class="content-file-row"><span class="file-type-icon">' + esc((file.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()) + '</span><span class="content-file-name">' + esc(file.file_name) + ' · ' + esc(formatBytes(file.size_bytes)) + '</span><button class="btn btn-secondary btn-small preview-file" data-kind="content" data-id="' + esc(file.id) + '">Preview</button><button class="btn btn-secondary btn-small download-content" data-id="' + esc(file.id) + '">Unduh</button></div>').join("");
    return '<article class="content-item"><div class="content-item-main"><div class="content-item-copy"><h3>' + esc(item.title) + ' <span class="role-badge">' + esc(contentFormatLabel(item.content_format)) + '</span></h3><p class="content-caption">' + esc(item.caption || "Belum ada caption.") + '</p><div class="content-item-meta"><span>◷ ' + esc(contentScheduleLabel(item)) + '</span><span>' + item.files.length + ' file</span><span>Status: ' + esc(STATUS[item.status] || item.status) + '</span></div>' + (item.revision_note ? '<p class="revision-note-display"><strong>Catatan revisi:</strong> ' + esc(item.revision_note) + '</p>' : '') + '</div></div><div class="content-files-list">' + fileRows + '</div><div class="content-item-actions"><button class="btn btn-secondary btn-small copy-caption" data-id="' + esc(item.content_group_id) + '">Copy caption</button>' + (["todo", "changes_requested"].includes(item.status) ? '<button class="btn btn-primary btn-small content-mark-done" data-id="' + esc(item.content_group_id) + '">Sudah beres</button>' : '') + (item.status === "in_review" ? '<span class="section-note">Menunggu approval</span>' : '') + (item.status === "done" ? '<span class="section-note">Sudah Done</span>' : '') + '<button class="btn btn-ghost btn-small delete-content" data-id="' + esc(item.content_group_id) + '">Hapus content</button></div></article>';
  }).join("") : emptyState("Belum ada content", "Upload beberapa file sekaligus, tambahkan caption, format, dan jadwal publikasi.");
  return '<div class="page-heading"><div><h2>Content</h2><p>Kelola file Reels, Feed, dan Carousel; caption bisa disalin dan item dikirim untuk approval.</p></div><span class="role-badge">' + items.length + ' content</span></div>' +
    '<section class="panel content-upload-panel"><div class="panel-header"><div><h3>Upload content</h3><p>Satu item content bisa memiliki banyak lampiran.</p></div></div><div class="panel-body"><form id="content-upload-form" class="form-stack"><div class="form-grid"><div class="field field-span"><label for="content-title-input">Judul content *</label><input id="content-title-input" name="title" required maxlength="160" placeholder="Contoh: Video promo Oktober"></div><div class="field"><label for="content-format-input">Format content *</label><select id="content-format-input" name="content_format" required><option value="reels">Reels</option><option value="feed">Feed</option><option value="carousel">Carousel</option></select></div><div class="field"><label for="content-date-input">Tanggal content</label><input id="content-date-input" name="scheduled_date" type="date"></div><div class="field"><label for="content-time-input">Jam content</label><input id="content-time-input" name="scheduled_time" type="time"></div><div class="field field-span"><label for="content-caption-input">Caption / catatan</label><textarea id="content-caption-input" name="caption" maxlength="5000" rows="3" placeholder="Tulis caption final, hashtag, atau catatan…"></textarea></div><div class="field field-span"><label>File content *</label><div id="content-file-list" data-file-list data-file-class="content-file-input" data-file-name="files"></div><p class="field-help">Pilih satu per satu. Setelah memilih file, kolom lampiran berikutnya muncul otomatis; file tetap privat.</p><p class="field-help">Maksimal 800 MiB per file sebagai batas aplikasi; kuota total gratis tetap berlaku.</p></div></div><div class="heading-actions"><button class="btn btn-primary" type="submit">＋ Upload content</button></div></form></div></section>' +
    '<section class="panel content-list-panel"><div class="panel-header"><div><h3>Content tim</h3><p>Caption, status approval, jadwal, dan semua file content.</p></div><span class="role-badge">' + items.length + ' content</span></div><div class="content-list">' + rows + '</div></section>';
}
function visitFieldsHTML(prefix, visit) {
  const v = visit || {};
  return '<div class="field"><label for="' + prefix + '-visit-title">Judul visit *</label><input id="' + prefix + '-visit-title" name="title" required maxlength="160" value="' + esc(v.title || "") + '" placeholder="Contoh: Meeting calon klien"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-city">Kota *</label><input id="' + prefix + '-visit-city" name="city" required maxlength="120" value="' + esc(v.city || "") + '" placeholder="Contoh: Bandung"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-date">Tanggal mulai *</label><input id="' + prefix + '-visit-date" name="visit_date" type="date" required value="' + esc(v.visit_date || "") + '"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-start">Jam mulai *</label><input id="' + prefix + '-visit-start" name="start_time" type="time" required value="' + esc(fmtClock(v.start_time) || "") + '"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-end-date">Sampai tanggal *</label><input id="' + prefix + '-visit-end-date" name="end_date" type="date" required value="' + esc(v.end_date || v.visit_date || "") + '"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-end-time">Sampai jam *</label><input id="' + prefix + '-visit-end-time" name="end_time" type="time" required value="' + esc(fmtClock(v.end_time) || "") + '"></div>' +
    '<div class="field"><label for="' + prefix + '-visit-status">Status schedule *</label><select id="' + prefix + '-visit-status" name="status">' +
    Object.keys(VISIT_STATUS).map((key) => '<option value="' + key + '"' + ((v.status || "planned") === key ? " selected" : "") + '>' + esc(VISIT_STATUS[key]) + '</option>').join("") +
    '</select></div>' +
    '<div class="field field-span"><label for="' + prefix + '-visit-job">Deskripsi job</label><textarea id="' + prefix + '-visit-job" name="job_description" maxlength="8000" rows="4" placeholder="Agenda, pihak yang ditemui, hasil yang ditargetkan, dan catatan lokasi…">' + esc(v.job_description || "") + '</textarea></div>';
}
function renderVisits() {
  const visits = state.visitSchedules.slice().sort((a, b) => {
    const dateDiff = String(a.visit_date).localeCompare(String(b.visit_date));
    return dateDiff || String(a.start_time).localeCompare(String(b.start_time));
  });
  const rows = visits.map((visit) => '<tr><td><strong>' + esc(visit.title) + '</strong><span class="table-description">' + esc(visit.job_description || "Tidak ada deskripsi job") + '</span></td><td>' + esc(visit.city) + '</td><td class="visit-date-cell">' + esc(visitWindowLabel(visit)) + '</td><td><select class="filter-select visit-status-select" data-visit-status="' + esc(visit.id) + '" aria-label="Status visit">' +
    Object.keys(VISIT_STATUS).map((key) => '<option value="' + key + '"' + (visit.status === key ? " selected" : "") + '>' + esc(VISIT_STATUS[key]) + '</option>').join("") +
    '</select></td><td><div class="visit-row-actions"><button class="btn btn-secondary btn-small" data-edit-visit="' + esc(visit.id) + '">Edit</button><button class="btn btn-ghost btn-small" data-delete-visit="' + esc(visit.id) + '">Hapus</button></div></td></tr>').join("");
  return '<div class="page-heading"><div><h2>Schedule visit offline</h2><p>Catat rencana kunjungan, lokasi kota, durasi, pekerjaan, dan status; perubahan akan dikirim ke Telegram.</p></div></div>' +
    '<section class="panel visit-create-panel"><div class="panel-header"><div><h3>Tambah schedule visit</h3><p>Isi judul, kota, tanggal/jam mulai sampai selesai, dan deskripsi job.</p></div></div><div class="panel-body"><form id="visit-create-form" class="form-stack"><div class="form-grid">' + visitFieldsHTML("create", null) + '</div><div class="heading-actions"><button class="btn btn-primary" type="submit">＋ Simpan schedule</button></div></form></div></section>' +
    '<section class="panel visit-list-panel"><div class="panel-header"><div><h3>Daftar schedule visit</h3><p>Fix, masih rencana, atau batal. Gunakan dropdown untuk mengganti status dengan cepat.</p></div><span class="role-badge">' + visits.length + ' visit</span></div>' +
    (visits.length ? '<div class="task-table-wrap"><table class="task-table visit-table"><thead><tr><th>Judul / deskripsi job</th><th>Kota</th><th>Tanggal & waktu</th><th>Status</th><th>Aksi</th></tr></thead><tbody>' + rows + '</tbody></table></div>' : emptyState("Belum ada schedule visit", "Tambahkan rencana kunjungan offline melalui form di atas.")) +
    '</section>';
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


function formatMetric(value) {
  if (value === null || value === undefined || value === "") return "—";
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("id-ID").format(number) : "—";
}
function instagramMetricCard(label, value, caption) {
  return '<article class="ig-metric-card"><span>' + esc(label) + '</span><strong>' + formatMetric(value) + '</strong><small>' + esc(caption) + '</small></article>';
}
function parseInstagramPostUrl(raw) {
  let parsed;
  try { parsed = new URL(String(raw || "").trim()); }
  catch { throw new Error("Masukkan link postingan Instagram yang valid."); }
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
  if (host !== "instagram.com") throw new Error("Link harus berasal dari instagram.com.");
  const match = parsed.pathname.match(/^\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)\/?/i);
  if (!match) throw new Error("Link harus menuju postingan, Reel, atau IGTV (contoh: instagram.com/p/KODE/).");
  const shortcode = match[2];
  const type = match[1].toLowerCase() === "reels" ? "reel" : match[1].toLowerCase();
  return { shortcode, url: "https://www.instagram.com/" + type + "/" + encodeURIComponent(shortcode) + "/" };
}
function saveInstagramPosts() {
  try {
    localStorage.setItem("ruang-kerja-instagram-posts", JSON.stringify(state.instagramReport.posts.slice(0, 30)));
  } catch {
    toast("Browser tidak bisa menyimpan tabel Instagram. Pastikan penyimpanan situs diizinkan.", "error");
  }
}
function instagramKnownTotal(post) {
  const values = [post.likes, post.comments, post.shares, post.reposts]
    .map((value) => value === null || value === undefined || value === "" ? null : Number(value))
    .filter((value) => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
function instagramSum(key) {
  const values = state.instagramReport.posts
    .map((post) => post[key] === null || post[key] === undefined || post[key] === "" ? null : Number(post[key]))
    .filter((value) => value !== null && Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}
function renderInstagramReport() {
  const report = state.instagramReport;
  const posts = Array.isArray(report.posts) ? report.posts : [];
  const tableRows = posts.map((post) => {
    const status = post.lookup_status === "loading" ? "Membaca metrik…"
      : post.lookup_status === "error" ? "Auto-read belum berhasil"
      : post.lookup_status === "partial" ? "Instagram tidak membuka metrik"
      : post.fetched_at ? "Diperbarui " + fmtDateTime(post.fetched_at)
      : "Data bisa diedit";
    const rowTotal = instagramKnownTotal(post);
    const coverMarkup = '<div class="ig-cover-static" title="' + (post.image_url ? 'Cover postingan' : 'Cover tidak tersedia dari data publik Instagram') + '">' +
      '<span class="ig-cover-frame"><span class="ig-cover-fallback" aria-hidden="true">' + (post.image_url ? 'Memuat cover…' : 'Cover belum tersedia') + '</span>' +
      (post.image_url ? '<img class="ig-cover-image" src="' + esc(post.image_url) + '" alt="Cover postingan Instagram" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove();">' : '') +
      '</span></div>';
    const metricInput = (field, label) => '<input class="ig-metric-edit" data-post-id="' + esc(post.id) + '" data-field="' + field + '" type="number" min="0" step="1" inputmode="numeric" aria-label="' + label + '" value="' + (post[field] === null || post[field] === undefined ? "" : esc(post[field])) + '" placeholder="—">';
    return '<tr data-instagram-post-row="' + esc(post.id) + '"><td class="ig-cover-cell">' + coverMarkup + '</td><td><div class="ig-post-title">' +
      esc((post.caption || "Post Instagram").slice(0, 160)) + '</div><div class="ig-post-meta"><a href="' + esc(post.url) + '" target="_blank" rel="noopener noreferrer">Buka postingan ↗</a>' +
      (post.timestamp ? ' · ' + esc(fmtDateTime(post.timestamp)) : '') +
      '</div><div class="ig-row-status ' + (post.lookup_status === "error" ? "is-error" : post.lookup_status === "loading" ? "is-loading" : post.lookup_status === "partial" ? "is-partial" : "") + '">' + esc(status) + '</div>' +
      (post.lookup_error ? '<p class="ig-row-error">' + esc(post.lookup_error) + '</p>' : '') +
      '</td><td>' + metricInput("likes", "Jumlah like") + '</td><td>' + metricInput("comments", "Jumlah komentar") +
      '</td><td>' + metricInput("shares", "Jumlah share") + '</td><td>' + metricInput("reposts", "Jumlah repost") +
      '</td><td class="ig-row-total"><strong>' + formatMetric(rowTotal) + '</strong></td><td><button type="button" class="btn btn-ghost btn-small ig-refresh-one" data-id="' + esc(post.id) + '"' + (post.lookup_status === "loading" || report.loading ? ' disabled' : '') + '>↻</button><button type="button" class="btn btn-ghost btn-small ig-delete-post" data-id="' + esc(post.id) + '">Hapus</button></td></tr>';
  }).join("");
  const errorText = report.error
    ? '<div class="ig-setup-notice"><strong>Catatan pembacaan otomatis</strong><p>' + esc(report.error) + '</p></div>' : "";
  const totalEngagement = posts.map(instagramKnownTotal).filter((value) => value !== null).reduce((sum, value) => sum + value, 0);
  const updated = report.lastFetched ? fmtDateTime(report.lastFetched) : "Belum ada sinkronisasi";
  return '<div class="page-heading"><div><h2>Instagram Engagement Report</h2><p>Masukkan link postingan; metrik yang tersedia akan dibaca otomatis dan total engagement dihitung per post serta keseluruhan.</p></div><div class="heading-actions"><button class="btn btn-secondary" type="button" data-instagram-refresh-all' + (report.loading || !posts.length ? ' disabled' : '') + '>' + (report.loading ? 'Memperbarui…' : '↻ Perbarui semua') + '</button></div></div>' +
    '<form class="ig-lookup-form" id="instagram-post-form"><label for="instagram-post-url">Link postingan Instagram<input id="instagram-post-url" name="post_url" type="url" inputmode="url" autocomplete="url" spellcheck="false" placeholder="https://www.instagram.com/p/..." required></label><button class="btn btn-primary" type="submit"' + (report.loading || posts.length >= 30 ? ' disabled' : '') + '>' + (report.loading ? 'Memproses…' : 'Tambah & baca engagement') + '</button></form>' +
    errorText +
    '<div class="ig-account-strip"><div><span class="ig-strip-label">Daftar postingan</span><strong>' + formatMetric(posts.length) + ' link tersimpan</strong><small>Update terakhir: ' + esc(updated) + ' · tersimpan di browser ini</small></div><span class="role-badge">' + (report.loading ? 'Sedang membaca' : posts.length ? 'Report per post' : 'Belum ada post') + '</span></div>' +
    '<div class="ig-metric-grid ig-metric-grid-five">' +
      instagramMetricCard("Total likes", instagramSum("likes"), "Jumlah dari semua baris yang terisi") +
      instagramMetricCard("Total komentar", instagramSum("comments"), "Jumlah dari semua baris yang terisi") +
      instagramMetricCard("Total share", instagramSum("shares"), "Auto jika tersedia, atau input manual") +
      instagramMetricCard("Total repost", instagramSum("reposts"), "Auto jika tersedia, atau input manual") +
      instagramMetricCard("Total engagement", posts.length ? totalEngagement : null, "Like + komentar + share + repost") +
    '</div>' +
    '<section class="panel ig-posts-panel"><div class="panel-header"><div><h3>Tabel engagement per postingan</h3><p>' + (posts.length ? 'Kamu bisa mengedit kolom angka. Total dan ringkasan akan dihitung ulang otomatis.' : 'Tambahkan link pertama untuk mulai membuat report.') + '</p></div><span class="role-badge">' + formatMetric(posts.length) + ' post</span></div>' +
    (posts.length ? '<div class="ig-report-table-wrap"><table class="ig-report-table ig-editable-table"><thead><tr><th>Cover</th><th>Postingan</th><th>Like</th><th>Komentar</th><th>Share</th><th>Repost</th><th>Total engagement</th><th>Aksi</th></tr></thead><tbody>' + tableRows + '</tbody></table></div><p class="ig-report-footnote">Tanda — berarti angka belum tersedia. Share/repost dapat tidak diberikan oleh Instagram publik; masukkan sendiri di kolomnya bila kamu memiliki angkanya. Total engagement menjumlahkan nilai yang terisi.</p>' :
    '<div class="ig-empty"><strong>Belum ada link postingan.</strong><p>Tempel link Instagram di atas, lalu tekan Tambah & baca engagement.</p></div>') +
    '</section><p class="ig-report-footnote">Maksimal 30 postingan per browser. Link dan angka yang diinput disimpan di browser ini, tidak otomatis tersinkron antarperangkat atau pengguna tim.</p>';
}
function openInstagramPostPreview(postId) {
  const post = state.instagramReport.posts.find((item) => item.id === postId);
  if (!post) return;
  const permalink = esc(post.url);
  $("#modal-root").innerHTML =
    '<div class="modal-backdrop" data-backdrop><section class="modal-card ig-post-preview-modal" role="dialog" aria-modal="true" aria-labelledby="ig-post-preview-title">' +
      '<div class="modal-header"><div><h2 id="ig-post-preview-title">Pratinjau postingan Instagram</h2><p>Pratinjau menggunakan embed Instagram; data metrik belum tentu tersedia secara publik.</p></div>' +
      '<button class="icon-button close-modal" type="button" aria-label="Tutup">×</button></div>' +
      '<div class="ig-post-preview-body"><div class="ig-post-preview-embed">' +
      '<blockquote class="instagram-media" data-instgrm-permalink="' + permalink + '" data-instgrm-version="14" style="background:#fff;border:0;border-radius:3px;box-shadow:0 0 1px 0 rgba(0,0,0,0.5),0 1px 10px 0 rgba(0,0,0,0.15);margin:0 auto;max-width:540px;min-width:280px;padding:0;width:calc(100% - 2px);">' +
      '<a href="' + permalink + '" target="_blank" rel="noopener noreferrer">Lihat postingan di Instagram</a></blockquote>' +
      '</div><p class="ig-post-preview-link"><a href="' + permalink + '" target="_blank" rel="noopener noreferrer">Buka postingan langsung di Instagram ↗</a></p></div>' +
    '</section></div>';
  const processEmbed = () => {
    try { window.instgrm?.Embeds?.process?.(); } catch { /* preview remains linked to Instagram */ }
  };
  if (window.instgrm?.Embeds?.process) {
    processEmbed();
    return;
  }
  let script = document.querySelector("script[data-instagram-embed-script]");
  if (!script) {
    script = document.createElement("script");
    script.src = "https://www.instagram.com/embed.js";
    script.async = true;
    script.dataset.instagramEmbedScript = "true";
    script.addEventListener("load", processEmbed, { once: true });
    document.body.appendChild(script);
  } else {
    script.addEventListener("load", processEmbed, { once: true });
  }
}
function createInstagramPostId() {
  return "ig-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2, 9));
}
async function requestInstagramPostMetrics(postUrl) {
  const { data, error } = await supabase.functions.invoke("instagram-engagement-report", { body: { post_url: postUrl } });
  if (error) {
    let message = error.message || "Backend pembacaan Instagram belum bisa dihubungi.";
    try {
      if (error.context && typeof error.context.clone === "function") {
        const details = await error.context.clone().json();
        if (details && details.error) message = details.error;
      }
    } catch { /* keep transport error */ }
    if (/404|not found|failed to send a request/i.test(message)) {
      message = "Pembacaan otomatis belum aktif di server. Baris tetap bisa dipakai dan kolom angka bisa diisi manual.";
    }
    throw new Error(message);
  }
  if (!data || data.error) throw new Error(data?.error || "Instagram tidak mengembalikan metrik.");
  return data.post || data;
}
async function readInstagramPostMetrics(postId) {
  const report = state.instagramReport;
  const post = report.posts.find((item) => item.id === postId);
  if (!post || post.lookup_status === "loading") return;
  post.lookup_status = "loading";
  post.lookup_error = "";
  post.last_attempt_at = Date.now();
  saveInstagramPosts();
  if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  try {
    if (!supabase || !state.user) throw new Error("Masuk ke Ruang Kerja terlebih dahulu.");
    const result = await requestInstagramPostMetrics(post.url);
    const current = report.posts.find((item) => item.id === postId);
    if (!current) return;
    let metricReturned = false;
    for (const field of ["likes", "comments", "shares", "reposts"]) {
      const value = result[field];
      if (value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0) {
        current[field] = Number(value);
        metricReturned = true;
      }
    }
    current.caption = String(result.caption || current.caption || "Post Instagram");
    current.image_url = String(result.image_url || result.thumbnail_url || current.image_url || "");
    current.timestamp = result.timestamp || current.timestamp || null;
    current.lookup_status = metricReturned ? "ready" : "partial";
    current.lookup_error = result.note || (metricReturned ? "" : "Instagram belum memberikan angka engagement. Klik cover untuk mencoba melihat postingannya.");
    current.fetched_at = result.fetched_at || new Date().toISOString();
    report.lastFetched = current.fetched_at;
    report.error = "";
  } catch (error) {
    const current = report.posts.find((item) => item.id === postId);
    if (current) {
      current.lookup_status = "error";
      current.lookup_error = (error.message || "Pembacaan otomatis gagal.") + " Angka tetap bisa diedit manual.";
    }
  } finally {
    saveInstagramPosts();
    if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  }
}
async function addInstagramPost(postUrl) {
  const report = state.instagramReport;
  let parsed;
  try { parsed = parseInstagramPostUrl(postUrl); }
  catch (error) { toast(error.message, "error"); return; }
  const existing = report.posts.find((post) => post.shortcode === parsed.shortcode);
  if (existing) {
    toast("Link ini sudah ada di tabel. Mencoba memperbarui metrik.", "success");
    await refreshInstagramPosts([existing.id]);
    return;
  }
  if (report.posts.length >= 30) return toast("Batas 30 postingan per browser sudah tercapai.", "error");
  const post = {
    id: createInstagramPostId(),
    url: parsed.url,
    shortcode: parsed.shortcode,
    caption: "Post Instagram",
    timestamp: null,
    likes: null, comments: null, shares: null, reposts: null,
    lookup_status: "saved",
    lookup_error: "",
    last_attempt_at: 0,
    fetched_at: null
  };
  report.posts.unshift(post);
  saveInstagramPosts();
  if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  await refreshInstagramPosts([post.id]);
}
async function refreshInstagramPosts(postIds = null) {
  const report = state.instagramReport;
  if (report.loading) return;
  const ids = Array.isArray(postIds) ? postIds : report.posts.map((post) => post.id);
  if (!ids.length) return;
  report.loading = true;
  report.error = "";
  if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  try {
    for (const id of ids) {
      const post = report.posts.find((item) => item.id === id);
      if (post && post.lookup_status !== "loading") await readInstagramPostMetrics(id);
    }
  } finally {
    report.loading = false;
    report.lastFetched = new Date().toISOString();
    if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  }
}
function maybeRefreshInstagramPosts() {
  const report = state.instagramReport;
  if (state.view !== "instagram" || report.loading || !report.posts.length) return;
  const stale = report.posts.filter((post) =>
    post.lookup_status !== "loading" && (!post.last_attempt_at || Date.now() - post.last_attempt_at > 30 * 60 * 1000)
  );
  if (stale.length) void refreshInstagramPosts(stale.map((post) => post.id));
}

function renderPage() {
  $("#page-title").textContent = PAGE_TITLE[state.view] || "Ruang Kerja";
  $$(".nav-item").forEach((btn) => btn.classList.toggle("active", btn.dataset.view === state.view));
  $("#nav-task-count").textContent = state.tasks.filter((t) => !isClosed(t)).length;
  $("#nav-approval-count").textContent = state.tasks.filter((t) => t.status === "in_review" || t.status === "changes_requested").length + groupContentAssets().filter((c) => c.status === "in_review" || c.status === "changes_requested").length;
  if (state.view === "dashboard") $("#page-content").innerHTML = renderDashboard();
  else if (state.view === "tasks") $("#page-content").innerHTML = renderTasks();
  else if (state.view === "approvals") $("#page-content").innerHTML = renderApprovals();
  else if (state.view === "files") $("#page-content").innerHTML = renderFiles();
  else if (state.view === "content") $("#page-content").innerHTML = renderContent();
  else if (state.view === "instagram") $("#page-content").innerHTML = renderInstagramReport();
  else if (state.view === "visits") $("#page-content").innerHTML = renderVisits();
  else $("#page-content").innerHTML = renderActivity();
  initializeFilePickers($("#page-content"));
  if (state.view === "instagram") maybeRefreshInstagramPosts();
}

function attachmentTypeLabel(type) {
  if (type === "example") return "Contoh";
  if (type === "result") return "Hasil Sudah Dikerjakan";
  return "Lampiran File";
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
  const [profileRes, profilesRes, tasksRes, commentsRes, attachmentsRes, contentRes, activityRes, visitsRes] = await Promise.all([
    supabase.from("profiles").select("id,display_name,role,access_label,access_color,created_at").eq("id", state.user.id).maybeSingle(),
    supabase.from("profiles").select("id,display_name,role,access_label,access_color,created_at").order("display_name"),
    supabase.from("tasks").select("*").order("created_at", { ascending: false }),
    supabase.from("task_comments").select("id,task_id,user_id,comment,created_at").order("created_at", { ascending: true }),
    supabase.from("task_attachments").select("id,task_id,path,storage_parts,storage_provider,storage_uploaded_at,file_name,content_type,size_bytes,uploaded_by,created_at,attachment_type").order("created_at", { ascending: false }),
    supabase.from("content_assets").select("id,title,caption,scheduled_date,scheduled_time,path,storage_parts,storage_provider,storage_uploaded_at,file_name,content_type,size_bytes,uploaded_by,created_at,content_group_id,status,revision_note,content_format").order("created_at", { ascending: false }),
    supabase.from("activity_log").select("id,task_id,actor_id,action,details,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("visit_schedules").select("*").order("visit_date", { ascending: true }).order("start_time", { ascending: true })
  ]);
  if (profileRes.error || !profileRes.data) {
    const wasAnonymous = Boolean(state.user?.is_anonymous);
    state.loading = false;
    await supabase.auth.signOut();
    showAuth(
      wasAnonymous ? "Masukkan kode akses untuk membuka ruang kerja." : "Profil tidak ditemukan. Coba masuk kembali dengan kode akses.",
      wasAnonymous ? "" : "error"
    );
    return;
  }
  state.profile = profileRes.data;
  state.profiles = profilesRes.data || [profileRes.data];
  state.tasks = tasksRes.data || [];
  state.comments = commentsRes.data || [];
  state.attachments = attachmentsRes.data || [];
  state.contentAssets = contentRes.data || [];
  await cleanupExpiredFiles();
  state.activities = activityRes.data || [];
  state.visitSchedules = visitsRes.data || [];
  state.loading = false;
  $("#profile-name").textContent = state.profile.access_label || state.profile.display_name;
  $("#profile-role").textContent = (state.profile.access_label || "Kode akses") + " · " + profileColorLabel(state.profile);
  $("#profile-avatar").textContent = initials(state.profile.access_label || state.profile.display_name);
  $("#profile-avatar").classList.remove("avatar-code-red", "avatar-code-pink");
  $("#profile-avatar").classList.add("avatar-code-" + profileColorToken(state.profile));
  $("#today-label").textContent = fmtDate(new Date().toISOString().slice(0, 10), { weekday: "short", day: "numeric", month: "short" });
  $("#auth-shell").hidden = true;
  $("#app-shell").hidden = false;
  renderPage();
}

function initializeFilePickers(root = document) {
  $$("[data-file-list]", root).forEach((container) => {
    const addRow = () => {
      const row = document.createElement("div");
      row.className = "dynamic-file-row";
      const input = document.createElement("input");
      input.type = "file";
      input.className = "dynamic-file-input " + (container.dataset.fileClass || "");
      input.name = container.dataset.fileName || "files";
      input.setAttribute("aria-label", "Pilih file");
      if (container.dataset.accept) input.accept = container.dataset.accept;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn btn-ghost btn-small remove-file-picker";
      remove.textContent = "×";
      remove.setAttribute("aria-label", "Hapus pilihan file");
      input.addEventListener("change", () => {
        if (!input.files || !input.files.length) return;
        const inputs = Array.from(container.querySelectorAll("input[type=file]"));
        if (inputs[inputs.length - 1] === input) addRow();
      });
      remove.addEventListener("click", () => {
        const rows = container.querySelectorAll(".dynamic-file-row");
        if (rows.length <= 1) { input.value = ""; return; }
        row.remove();
      });
      row.append(input, remove);
      container.appendChild(row);
    };
    if (!container.querySelector("input[type=file]")) addRow();
  });
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
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="create-task-title"><div class="modal-header"><div><h2 id="create-task-title">Buat pekerjaan baru</h2><p>Jelaskan hasil yang dibutuhkan dan kapan harus selesai.</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="create-task-form"><div class="modal-body"><div class="form-grid"><div class="field field-span"><label for="task-title-input">Judul pekerjaan *</label><input id="task-title-input" name="title" required maxlength="140" placeholder="Contoh: Siapkan laporan bulanan"></div><div class="field field-span"><label for="task-description-input">Deskripsi dan hasil yang diharapkan</label><textarea id="task-description-input" name="description" maxlength="8000" placeholder="Tuliskan brief, langkah kerja, dan kriteria selesai…"></textarea></div><div class="field"><label for="task-due-input">Tanggal deadline</label><input id="task-due-input" name="due_date" type="date"></div><div class="field"><label for="task-due-time-input">Jam deadline</label><input id="task-due-time-input" name="due_time" type="time"></div><div class="field"><label for="task-priority-input">Prioritas</label><select id="task-priority-input" name="priority"><option value="normal">Normal</option><option value="high">Tinggi</option><option value="urgent">Urgent</option><option value="low">Rendah</option></select></div><div class="field field-span"><label for="task-assignee-input">Penanggung jawab (PIC)</label><select id="task-assignee-input" name="assigned_to">' + people + '</select><p class="field-help">Semua pengguna kode akses memiliki hak yang sama.</p></div></div></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-primary">Simpan pekerjaan</button></div></form></section></div>';
  $("#task-title-input")?.focus();
}
function taskActionButtons(task) {
  let html = "";
  if (task.status === "todo" || task.status === "changes_requested") {
    html += '<button class="btn btn-secondary" data-task-status="in_progress" data-id="' + esc(task.id) + '">Mulai dikerjakan</button>';
  }
  if (["todo", "in_progress", "changes_requested"].includes(task.status)) {
    html += '<button class="btn btn-primary" data-task-status="in_review" data-id="' + esc(task.id) + '">Sudah beres · ajukan approval</button>';
  }
  if (task.status === "in_review") {
    html += '<button class="btn btn-warning" data-show-revision="' + esc(task.id) + '">Revisi</button>';
    html += '<button class="btn btn-approve" data-task-status="done" data-id="' + esc(task.id) + '">Approval · tandai Done</button>';
  }
  if (task.status === "approved") {
    html += '<button class="btn btn-approve" data-task-status="done" data-id="' + esc(task.id) + '">Tandai Done</button>';
  }
  if (task.status === "done") html += '<span class="section-note">Status final: Done</span>';
  return html;
}
function openTaskModal(taskId) {
  const task = taskById(taskId);
  if (!task) return;
  state.selectedTaskId = taskId;
  const comments = state.comments.filter((item) => item.task_id === taskId);
  const allTaskFiles = state.attachments.filter((item) => item.task_id === taskId);
  const approvalView = ["in_review", "changes_requested"].includes(task.status);
  const files = approvalView ? allTaskFiles.filter((item) => item.attachment_type === "result") : allTaskFiles;
  const actions = taskActionButtons(task);
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="detail-task-title"><div class="modal-header"><div><div class="task-subline">' + statusBadge(task.status) + deadlineStatusBadge(task) + '<span class="priority-' + esc(task.priority) + '"><span class="priority-dot"></span>' + esc(PRIORITY[task.priority] || task.priority) + '</span></div><h2 id="detail-task-title" style="margin-top:7px">' + esc(task.title) + '</h2><p>Dibuat ' + esc(fmtDateTime(task.created_at)) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><div class="modal-body"><div class="detail-metadata"><div class="detail-meta"><span>Penanggung jawab</span><strong>' + esc(profileName(task.assigned_to)) + '</strong></div><div class="detail-meta"><span>Deadline</span><strong class="' + (isLate(task) ? "due-overdue" : "") + '">' + esc(deadlineLabel(task, "Belum diatur")) + '</strong></div><div class="detail-meta"><span>Dibuat oleh</span><strong>' + esc(profileName(task.created_by)) + '</strong></div></div><h3 class="section-subtitle" style="margin-top:15px">Deskripsi pekerjaan</h3><div class="detail-description">' + esc(task.description || "Belum ada deskripsi.") + '</div><div class="heading-actions" style="margin-top:14px">' + actions + '</div><div id="revision-box" class="modal-form-note" hidden><form id="revision-form"><label class="field-label" for="revision-note">Deskripsi revisi</label><textarea id="revision-note" name="comment" required maxlength="3000" style="display:block;width:100%;margin:8px 0;border:1px solid #e3d2a9;border-radius:8px;padding:10px;font:inherit;min-height:75px" placeholder="Jelaskan apa yang harus diperbaiki…"></textarea><button type="submit" class="btn btn-warning btn-small">Kirim revisi</button></form></div><h3 class="section-subtitle">' + (approvalView ? "Lampiran untuk approval — hasil saja" : "Lampiran") + ' <span class="role-badge">' + files.length + '</span></h3><div class="file-warning"><strong>Privasi:</strong><span>Unggah hanya file yang diizinkan untuk penyimpanan cloud.</span></div>' +

    (files.length ? ["work", "example", "result"].map((type) => {
      const groupedFiles = files.filter((file) => (file.attachment_type || "work") === type);
      if (!groupedFiles.length) return "";
      return '<section class="task-attachment-group"><div class="task-attachment-group-header"><h4>' + esc(attachmentTypeLabel(type)) + '</h4><span class="role-badge">' + groupedFiles.length + '</span></div>' +
        groupedFiles.map((file) => '<div class="file-row"><div class="file-type-icon">' + esc((file.file_name.split(".").pop() || "FILE").slice(0, 4).toUpperCase()) + '</div><div class="file-info"><strong>' + esc(file.file_name) + '</strong><p>' + esc(formatBytes(file.size_bytes)) + ' · ' + esc(fmtDateTime(file.created_at)) + '</p></div><div class="file-row-actions"><button class="btn btn-secondary btn-small preview-file" data-kind="attachment" data-id="' + esc(file.id) + '">Preview</button><button class="btn btn-secondary btn-small download-file" data-id="' + esc(file.id) + '">Unduh</button>' + (!["in_review", "approved", "done", "archived"].includes(task.status) ? '<button class="btn btn-primary btn-small submit-task-file" data-id="' + esc(task.id) + '">Ajukan approval</button>' : '') + '<button class="btn btn-ghost btn-small delete-task-file" data-id="' + esc(file.id) + '">Hapus</button></div></div>').join("") +
        '</section>';
    }).join("") : '<div class="empty-inline">' + (approvalView ? "Belum ada hasil yang dilampirkan untuk approval." : "Belum ada lampiran pada tugas ini.") + '</div>') +
    '<form id="upload-form" class="form-stack" style="gap:10px;margin-top:12px"><div class="field task-attachment-upload-section"><label>Lampiran File</label><div id="task-work-file-list" data-file-list data-file-class="task-file-work-input" data-file-name="work_files"></div><p class="field-help">File kerja, brief, atau dokumen yang terkait dengan tugas.</p></div><div class="field task-attachment-upload-section"><label>Contoh</label><div id="task-example-file-list" data-file-list data-file-class="task-file-example-input" data-file-name="example_files"></div><p class="field-help">File referensi, template, atau contoh yang dapat dijadikan acuan.</p></div><div class="field task-attachment-upload-section"><label>Hasil Sudah Dikerjakan</label><div id="task-result-file-list" data-file-list data-file-class="task-file-result-input" data-file-name="result_files"></div><p class="field-help">Unggah hasil akhir pekerjaan yang sudah dikerjakan untuk diperiksa dan diajukan ke approval.</p></div><p class="field-help">Maksimal 800 MiB per file sebagai batas aplikasi. Batas total penyimpanan gratis tetap berlaku.</p><button class="btn btn-secondary" type="submit">Unggah lampiran terpilih</button></form><h3 class="section-subtitle">Komentar & catatan <span class="role-badge">' + comments.length + '</span></h3><div class="comment-list">' + (comments.length ? comments.map((c) => {
      const author = state.profiles.find((p) => p.id === c.user_id);
      return '<article class="comment"><div class="comment-top"><strong>' + esc(author ? author.display_name : "Anggota tim") + '</strong><time>' + esc(fmtDateTime(c.created_at)) + '</time></div><p>' + esc(c.comment) + '</p></article>';
    }).join("") : '<div class="empty-inline">Belum ada komentar. Gunakan bagian ini untuk koordinasi.</div>') + '</div><form id="comment-form" class="comment-form"><textarea name="comment" rows="2" required maxlength="3000" placeholder="Tulis komentar atau update singkat…"></textarea><button type="submit" class="btn btn-primary btn-small">Kirim</button></form></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Tutup</button></div></section></div>';
  initializeFilePickers($("#modal-root"));
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
    title, description: String(data.get("description") || "").trim(),
    due_date: String(data.get("due_date") || "") || null,
    due_time: String(data.get("due_time") || "") || null,
    priority: String(data.get("priority") || "normal"), status: "todo",
    created_by: state.user.id, assigned_to: String(data.get("assigned_to") || state.user.id)
  };
  const button = $('button[type="submit"]', form);
  button.disabled = true; button.textContent = "Menyimpan…";
  const { data: task, error } = await supabase.from("tasks").insert(payload).select("*").single();
  button.disabled = false; button.textContent = "Simpan pekerjaan";
  if (error) return toast("Tugas belum tersimpan: " + error.message, "error");
  $("#modal-root").innerHTML = "";
  toast("Pekerjaan berhasil dibuat.");
  await notifyTelegram("task_created", task.title, STATUS[task.status], "Deadline: " + deadlineLabel(task, "belum diatur") + " · PIC: " + profileName(task.assigned_to));
  await loadWorkspace();
  openTaskModal(task.id);
}
async function changeTaskStatus(taskId, newStatus) {
  if (!STATUS[newStatus]) return;
  const task = taskById(taskId);
  if (!task) return;
  if (newStatus === "in_review") {
    const resultFiles = state.attachments.filter((file) => file.task_id === taskId && file.attachment_type === "result");
    if (!resultFiles.length) return toast("Sebelum minta approval, unggah minimal satu file di kategori Hasil Sudah Dikerjakan. Lampiran File dan Contoh tidak ikut dikirim.", "error");
  }
  const { error } = await supabase.from("tasks").update({ status: newStatus }).eq("id", taskId);
  if (error) return toast("Status belum berubah: " + error.message, "error");
  const actionLabel = newStatus === "done" ? "Status berubah menjadi Done" :
    newStatus === "in_review" ? "Pekerjaan dikirim ke Menunggu approval" :
    newStatus === "in_progress" ? "Pekerjaan dimulai" : "Status diperbarui";
  toast(actionLabel);
  await notifyTelegram("task_status", task.title, STATUS[newStatus] || newStatus, "Deadline: " + deadlineLabel(task, "belum diatur"));
  await loadWorkspace();
  if ($("#modal-root").innerHTML) openTaskModal(taskId);
}
async function sendRevision(form) {
  const data = new FormData(form);
  const comment = String(data.get("comment") || "").trim();
  const taskId = state.selectedTaskId;
  const task = taskById(taskId);
  if (!comment || !taskId || !task) return toast("Deskripsi revisi wajib diisi.", "error");
  const { error: statusError } = await supabase.from("tasks").update({ status: "changes_requested" }).eq("id", taskId);
  if (statusError) return toast("Permintaan revisi belum tersimpan: " + statusError.message, "error");
  const { error: commentError } = await supabase.from("task_comments").insert({ task_id: taskId, user_id: state.user.id, comment });
  if (commentError) toast("Status revisi tersimpan, tetapi catatan gagal tersimpan: " + commentError.message, "error");
  else toast("Revisi dan deskripsinya berhasil dikirim.");
  await notifyTelegram("task_revision", task.title, STATUS.changes_requested, comment);
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
async function notifyTelegram(eventType, title, status, details = "") {
  if (!supabase) return false;
  try {
    const { data, error } = await supabase.functions.invoke("notify-telegram", {
      body: {
        event_type: eventType,
        title: String(title || "").slice(0, 180),
        status: String(status || "").slice(0, 80),
        details: String(details || "").slice(0, 1200)
      }
    });
    if (error) {
      let message = error.message || "Permintaan notifikasi gagal.";
      const response = error.context;
      if (response && typeof response.clone === "function") {
        try {
          const body = await response.clone().json();
          if (body?.error) message = body.error;
        } catch { /* response did not contain JSON */ }
      }
      console.warn("Notifikasi Telegram gagal:", message);
      toast("Notifikasi Telegram gagal: " + message, "error");
      return false;
    }
    if (data?.ok === false) {
      const message = data.error || "Periksa token bot dan Chat ID.";
      console.warn("Notifikasi Telegram gagal:", message);
      toast("Notifikasi Telegram gagal: " + message, "error");
      return false;
    }
    console.info("Notifikasi Telegram terkirim:", eventType);
    return true;
  } catch (error) {
    const message = error?.message || "Kesalahan yang tidak diketahui.";
    console.warn("Notifikasi Telegram gagal:", message);
    toast("Notifikasi Telegram gagal: " + message, "error");
    return false;
  }
}

function safeFilename(name) {
  return String(name || "file").normalize("NFKC").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^[.]+/, "").slice(0, 100) || "file";
}
async function invokeBackblaze(action, payload = {}) {
  const { data, error } = await supabase.functions.invoke("b2-storage", { body: { action, ...payload } });
  if (error) {
    let message = error.message || "Permintaan Backblaze gagal.";
    try {
      if (error.context && typeof error.context.clone === "function") {
        const body = await error.context.clone().json();
        if (body && body.error) message = body.error;
      }
    } catch { /* keep SDK message */ }
    throw new Error(message);
  }
  if (data && data.error) throw new Error(String(data.error));
  return data || {};
}
async function invokeGoogleDrive(action, payload = {}) {
  if (!supabase) throw new Error("Supabase belum siap.");
  const { data, error } = await supabase.functions.invoke("google-drive-storage", { body: { action, ...payload } });
  if (error) {
    let message = error.message || "Permintaan Google Drive gagal.";
    try {
      if (error.context && typeof error.context.clone === "function") {
        const body = await error.context.clone().json();
        if (body && body.error) message = body.error;
      }
    } catch { /* keep SDK message */ }
    throw new Error(message);
  }
  if (data && data.error) throw new Error(String(data.error));
  return data || {};
}
async function connectGoogleDrive() {
  const button = $("[data-connect-google-drive]");
  if (button) { button.disabled = true; button.textContent = "Membuka Google…"; }
  try {
    const result = await invokeGoogleDrive("start-oauth");
    if (!result.url) throw new Error("Google tidak mengembalikan alamat otorisasi.");
    window.location.assign(result.url);
  } catch (error) {
    toast(error.message || "Google Drive belum bisa dihubungkan.", "error");
    if (button) { button.disabled = false; button.textContent = state.googleDriveConnected ? "Hubungkan ulang Google Drive" : "Hubungkan Google Drive"; }
  }
}

async function uploadPrivateFile(taskId, file, onPart = () => {}) {
  if (!file || file.size < 1) throw new Error("File kosong.");
  if (file.size > MAX_STORAGE_FILE_SIZE) throw new Error("File " + file.name + " melebihi batas aplikasi 800 MiB.");
  if (!supabase) throw new Error("Penyimpanan belum siap.");
  const rootPath = taskId === "content"
    ? "content/" + state.user.id + "/" + crypto.randomUUID()
    : taskId + "/" + state.user.id + "/" + crypto.randomUUID();
  const totalParts = Math.ceil(file.size / STORAGE_CHUNK_SIZE);
  if (totalParts > 100) throw new Error("File ini membutuhkan lebih dari 100 bagian upload.");
  const uploadedPaths = [];
  try {
    for (let part = 0; part < totalParts; part++) {
      const start = part * STORAGE_CHUNK_SIZE;
      const end = Math.min(start + STORAGE_CHUNK_SIZE, file.size);
      const partKey = rootPath + "/part-" + String(part + 1).padStart(4, "0");
      const mimeType = file.type || "application/octet-stream";
      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(
        partKey,
        file.slice(start, end),
        { contentType: mimeType, cacheControl: "3600", upsert: false }
      );
      if (error) throw error;
      uploadedPaths.push(partKey);
      onPart(part + 1, totalParts);
    }
    return { path: rootPath, storage_parts: uploadedPaths, size: file.size, storage_provider: "supabase" };
  } catch (error) {
    if (uploadedPaths.length) await removeStorageObjects(uploadedPaths, "supabase").catch(() => {});
    throw error;
  }
}
async function removeStorageObjects(paths, provider = "supabase") {
  const uniquePaths = [...new Set((paths || []).filter((path) => typeof path === "string" && path))];
  for (let start = 0; start < uniquePaths.length; start += 100) {
    const batch = uniquePaths.slice(start, start + 100);
    if (provider === "google_drive") {
      await invokeGoogleDrive("delete-objects", { ids: batch });
    } else if (provider === "backblaze") {
      await invokeBackblaze("delete-objects", { keys: batch });
    } else {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).remove(batch);
      if (error) throw error;
    }
  }
}
async function cleanupExpiredFiles() {
  const retentionMs = 14 * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - retentionMs;
  const oldFiles = [
    ...state.attachments.map((item) => ({ ...item, _table: "task_attachments" })),
    ...state.contentAssets.map((item) => ({ ...item, _table: "content_assets" }))
  ].filter((item) => {
    const uploadedAt = Date.parse(item.storage_uploaded_at || item.created_at || "");
    return Number.isFinite(uploadedAt) && uploadedAt <= cutoff;
  });
  let removed = 0;
  for (const item of oldFiles) {
    try {
      await removeStorageObjects(getStoredPaths(item), item.storage_provider || "supabase");
      const { error } = await supabase.from(item._table).delete().eq("id", item.id);
      if (error) throw error;
      if (item._table === "task_attachments") {
        state.attachments = state.attachments.filter((row) => row.id !== item.id);
      } else {
        state.contentAssets = state.contentAssets.filter((row) => row.id !== item.id);
      }
      removed++;
    } catch (error) {
      console.warn("Retensi 14 hari belum bisa membersihkan file:", item.file_name, error);
    }
  }
  if (removed) toast(removed + " file yang sudah melewati retensi 14 hari dihapus.");
}
async function downloadStoredFile(item, returnBlob = false) {
  const paths = getStoredPaths(item);
  if (!paths.length) throw new Error("Bagian file tidak ditemukan.");
  const pieces = [];
  for (let index = 0; index < paths.length; index++) {
    if (item.storage_provider === "google_drive") {
      const grant = await invokeGoogleDrive("download-token", { fileId: paths[index] });
      if (!grant.url || !grant.accessToken) throw new Error("Google Drive tidak memberikan akses unduhan.");
      const response = await fetch(grant.url, { headers: { Authorization: "Bearer " + grant.accessToken } });
      if (!response.ok) throw new Error("Google Drive gagal mengirim bagian " + (index + 1) + " (HTTP " + response.status + ").");
      pieces.push(await response.blob());
    } else if (item.storage_provider === "backblaze") {
      const signed = await invokeBackblaze("presign-download", { key: paths[index] });
      const response = await fetch(signed.url);
      if (!response.ok) throw new Error("Backblaze gagal mengirim bagian " + (index + 1) + " (HTTP " + response.status + ").");
      pieces.push(await response.blob());
    } else {
      const { data, error } = await supabase.storage.from(STORAGE_BUCKET).download(paths[index]);
      if (error) throw error;
      pieces.push(data);
    }
    if (paths.length > 1 && !returnBlob) toast("Mengunduh bagian " + (index + 1) + " dari " + paths.length + "…");
  }
  const blob = new Blob(pieces, { type: item.content_type || "application/octet-stream" });
  if (returnBlob) return blob;
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl; link.rel = "noopener"; link.download = item.file_name || "unduhan";
  document.body.appendChild(link); link.click(); link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
}
async function uploadTaskFile(form) {
  const task = taskById(state.selectedTaskId);
  const workFiles = $$(".task-file-work-input", form).flatMap((input) => Array.from(input.files || [])).map((file) => ({ file, attachment_type: "work" }));
  const exampleFiles = $$(".task-file-example-input", form).flatMap((input) => Array.from(input.files || [])).map((file) => ({ file, attachment_type: "example" }));
  const resultFiles = $$(".task-file-result-input", form).flatMap((input) => Array.from(input.files || [])).map((file) => ({ file, attachment_type: "result" }));
  const selected = [...workFiles, ...exampleFiles, ...resultFiles];
  if (!task || !selected.length) return toast("Pilih setidaknya satu file pada kategori Lampiran File, Contoh, atau Hasil Sudah Dikerjakan.", "error");
  const oversized = selected.find(({ file }) => file.size < 1 || file.size > MAX_STORAGE_FILE_SIZE);
  if (oversized) return toast("File " + oversized.file.name + " kosong atau lebih besar dari 800 MiB.", "error");
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  const uploaded = [];
  try {
    for (const entry of selected) {
      const saved = await uploadPrivateFile(task.id, entry.file, (part, total) => {
        button.textContent = "Mengunggah " + entry.file.name + " (" + part + "/" + total + ")…";
      });
      uploaded.push({ ...saved, ...entry });
    }
    const rows = uploaded.map(({ path, storage_parts, storage_provider, file, attachment_type }) => ({
      task_id: task.id, path, storage_parts, storage_provider: storage_provider || "google_drive", file_name: file.name.slice(0, 255),
      content_type: file.type || "application/octet-stream", size_bytes: file.size,
      uploaded_by: state.user.id, attachment_type
    }));
    const { error } = await supabase.from("task_attachments").insert(rows);
    if (error) throw error;
    toast(uploaded.length + " lampiran berhasil diunggah.");
    await notifyTelegram("task_files_uploaded", task.title, STATUS[task.status], uploaded.length + " lampiran baru: " + uploaded.map((x) => x.file.name).join(", "));
    await refreshTaskDetail(task.id);
  } catch (error) {
    for (const item of uploaded) {
      await removeStorageObjects(item.storage_parts || [item.path], item.storage_provider || "google_drive").catch(() => {});
    }
    button.disabled = false;
    button.textContent = "Unggah lampiran terpilih";
    toast("Upload belum selesai: " + (error.message || "periksa koneksi dan kapasitas penyimpanan"), "error");
  }
}

async function downloadFile(attachmentId) {
  const file = state.attachments.find((item) => item.id === attachmentId);
  if (!file) return toast("Lampiran tidak ditemukan.", "error");
  try { await downloadStoredFile(file); }
  catch (error) { toast("File tidak dapat diunduh: " + (error.message || "kesalahan tidak diketahui"), "error"); }
}

async function deleteTaskAttachment(attachmentId) {
  const file = state.attachments.find((item) => item.id === attachmentId);
  if (!file) return toast("Lampiran tidak ditemukan.", "error");
  if (!window.confirm('Hapus file "' + file.file_name + '" dari semua pengguna?')) return;
  try { await removeStorageObjects(getStoredPaths(file), file.storage_provider || "supabase"); }
  catch (error) { return toast("File belum dapat dihapus: " + (error.message || ""), "error"); }
  const { error } = await supabase.from("task_attachments").delete().eq("id", attachmentId);
  if (error) return toast("File terhapus dari storage, tetapi catatan belum terhapus: " + error.message, "error");
  toast("Lampiran berhasil dihapus.");
  const taskId = file.task_id;
  await loadWorkspace();
  if ($("#modal-root").innerHTML && taskId) openTaskModal(taskId);
}
async function deleteTask(taskId) {
  const task = taskById(taskId);
  if (!task) return toast("Tugas tidak ditemukan.", "error");
  const files = state.attachments.filter((item) => item.task_id === taskId);
  if (!window.confirm('Hapus tugas "' + task.title + '" beserta ' + files.length + ' catatan lampiran? Penghapusan berlaku untuk kedua kode login dan tidak dapat dibatalkan.')) return;
  try {
    for (const file of files) await removeStorageObjects(getStoredPaths(file), file.storage_provider || "supabase");
  } catch (error) { return toast("Tugas belum dihapus karena file gagal dibersihkan: " + (error.message || ""), "error"); }
  const { error } = await supabase.from("tasks").delete().eq("id", taskId);
  if (error) return toast("Tugas belum dapat dihapus: " + error.message, "error");
  $("#modal-root").innerHTML = "";
  toast("Tugas dan lampirannya berhasil dihapus.");
  await loadWorkspace();
  state.view = "tasks";
  renderPage();
}

async function uploadContent(form) {
  const data = new FormData(form);
  const title = String(data.get("title") || "").trim();
  const caption = String(data.get("caption") || "").trim();
  const scheduledDate = String(data.get("scheduled_date") || "") || null;
  const scheduledTime = String(data.get("scheduled_time") || "") || null;
  const contentFormat = String(data.get("content_format") || "feed");
  const files = $$(".content-file-input", form).flatMap((input) => Array.from(input.files || []));
  if (!title) return toast("Judul content wajib diisi.", "error");
  if (!files.length) return toast("Pilih setidaknya satu file content.", "error");
  const oversized = files.find((file) => file.size < 1 || file.size > MAX_STORAGE_FILE_SIZE);
  if (oversized) return toast("Periksa ukuran file " + oversized.name + "; batas aplikasi 800 MiB per file.", "error");
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  const groupId = crypto.randomUUID();
  const uploaded = [];
  try {
    for (const file of files) {
      const saved = await uploadPrivateFile("content", file, (part, total) => {
        button.textContent = "Mengunggah " + file.name + " (" + part + "/" + total + ")…";
      });
      uploaded.push({ ...saved, file });
    }
    const rows = uploaded.map(({ path, storage_parts, storage_provider, file }) => ({
      content_group_id: groupId, title, caption, scheduled_date: scheduledDate,
      scheduled_time: scheduledTime, content_format: contentFormat, status: "todo", revision_note: "",
      path, storage_parts, storage_provider: storage_provider || "google_drive", file_name: file.name.slice(0, 255), content_type: file.type || "application/octet-stream",
      size_bytes: file.size, uploaded_by: state.user.id
    }));
    const { error: metadataError } = await supabase.from("content_assets").insert(rows);
    if (metadataError) throw metadataError;
    form.reset();
    $("#content-file-list").innerHTML = "";
    initializeFilePickers(form);
    toast("Content dan " + uploaded.length + " file berhasil diunggah.");
    await notifyTelegram("content_created", title, "Belum diserahkan", contentFormatLabel(contentFormat) + " · " + uploaded.length + " file · Jadwal: " + (scheduledDate || "belum diatur") + (scheduledTime ? " " + scheduledTime : ""));
    state.view = "content";
    await loadWorkspace();
  } catch (error) {
    for (const item of uploaded) {
      await removeStorageObjects(item.storage_parts || [item.path], item.storage_provider || "google_drive").catch(() => {});
    }
    button.disabled = false;
    button.textContent = "＋ Upload content";
    toast("Content belum tersimpan: " + (error.message || "periksa koneksi dan kapasitas penyimpanan"), "error");
  }
}

async function downloadContentFile(contentId) {
  const item = state.contentAssets.find((asset) => asset.id === contentId);
  if (!item) return toast("File content tidak ditemukan.", "error");
  try { await downloadStoredFile(item); }
  catch (error) { toast("Content tidak bisa diunduh: " + (error.message || "kesalahan tidak diketahui"), "error"); }
}


function previewTypeForFile(item) {
  const mime = String(item.content_type || "").toLowerCase().split(";")[0].trim();
  const name = String(item.file_name || "").toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|avif|bmp|svg)$/i.test(name)) return "image";
  if (mime === "application/pdf" || /\.pdf$/i.test(name)) return "pdf";
  if (/\.(pptx|ppt)$/i.test(name) || /application\/vnd\.openxmlformats-officedocument\.presentationml\.presentation|application\/vnd\.ms-powerpoint/.test(mime)) return "pptx";
  if (mime.startsWith("video/") || /\.(mp4|webm|ogv|mov|m4v)$/i.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/i.test(name)) return "audio";
  if (mime.startsWith("text/") || /\.(txt|md|csv|json|xml|log|yaml|yml|ini)$/i.test(name)) return "text";
  return "unsupported";
}
function closeFilePreview() {
  state.previewRequestId += 1;
  const overlay = $(".file-preview-backdrop", $("#modal-root"));
  if (overlay) overlay.remove();
  if (state.previewObjectUrl) URL.revokeObjectURL(state.previewObjectUrl);
  state.previewObjectUrl = null;
}

async function renderPowerPointPreview(blob, stage, meta, requestId) {
  meta.textContent = "Memuat renderer presentasi…";
  stage.innerHTML = '<div class="file-preview-loading">Membaca slide PowerPoint…</div>';
  // Presentation data stays in this browser tab; only the renderer code is loaded from the CDN.
  const { parse, renderSlideToSvg } = await import("https://esm.sh/@web-ppt/core@0.4.5");
  const presentation = await parse(blob);
  if (requestId !== state.previewRequestId || !stage.isConnected) return;
  const slides = Array.isArray(presentation.slides) ? presentation.slides : [];
  if (!slides.length) throw new Error("Presentasi tidak memiliki slide yang dapat ditampilkan.");
  stage.innerHTML =
    '<div class="pptx-preview-toolbar">' +
      '<button type="button" class="btn btn-secondary btn-small pptx-slide-prev" disabled>← Sebelumnya</button>' +
      '<span class="pptx-slide-indicator" aria-live="polite">Slide 1 dari ' + slides.length + '</span>' +
      '<button type="button" class="btn btn-secondary btn-small pptx-slide-next"' + (slides.length < 2 ? ' disabled' : '') + '>Berikutnya →</button>' +
    '</div><div class="pptx-slide-frame"><div class="pptx-slide-content" aria-label="Slide PowerPoint"></div></div>';
  const content = $(".pptx-slide-content", stage);
  const prev = $(".pptx-slide-prev", stage);
  const next = $(".pptx-slide-next", stage);
  const indicator = $(".pptx-slide-indicator", stage);
  let currentIndex = 0;
  async function paintCurrentSlide() {
    if (requestId !== state.previewRequestId || !stage.isConnected) return;
    indicator.textContent = "Slide " + (currentIndex + 1) + " dari " + slides.length;
    prev.disabled = currentIndex === 0;
    next.disabled = currentIndex >= slides.length - 1;
    content.innerHTML = '<div class="file-preview-loading">Merender slide ' + (currentIndex + 1) + '…</div>';
    let svgMarkup = renderSlideToSvg(presentation, slides[currentIndex]);
    if (svgMarkup && typeof svgMarkup.then === "function") svgMarkup = await svgMarkup;
    if (requestId !== state.previewRequestId || !stage.isConnected) return;
    if (typeof svgMarkup !== "string" || !svgMarkup.includes("<svg")) {
      throw new Error("Renderer tidak menghasilkan gambar slide yang valid.");
    }
    content.innerHTML = svgMarkup;
    const svg = $("svg", content);
    if (svg) {
      svg.setAttribute("role", "img");
      svg.setAttribute("aria-label", "Slide " + (currentIndex + 1) + " dari " + slides.length);
    }
    meta.textContent = "PowerPoint · " + slides.length + " slide · dipreview langsung di browser. Gunakan tombol navigasi untuk berpindah slide.";
  }
  prev.addEventListener("click", async () => {
    if (currentIndex <= 0) return;
    currentIndex--;
    try { await paintCurrentSlide(); }
    catch (error) { meta.textContent = "Gagal merender slide: " + (error.message || "kesalahan tidak diketahui"); }
  });
  next.addEventListener("click", async () => {
    if (currentIndex >= slides.length - 1) return;
    currentIndex++;
    try { await paintCurrentSlide(); }
    catch (error) { meta.textContent = "Gagal merender slide: " + (error.message || "kesalahan tidak diketahui"); }
  });
  await paintCurrentSlide();
}

async function previewFile(fileId, kind = "attachment") {
  closeFilePreview();
  const requestId = ++state.previewRequestId;
  const file = kind === "content"
    ? state.contentAssets.find((item) => item.id === fileId)
    : state.attachments.find((item) => item.id === fileId);
  if (!file) return toast("File tidak ditemukan.", "error");
  const previewType = previewTypeForFile(file);
  const sizeLabel = formatBytes(file.size_bytes);
  $("#modal-root").insertAdjacentHTML("beforeend",
    '<div class="file-preview-backdrop" data-preview-backdrop><section class="modal-card file-preview-modal" role="dialog" aria-modal="true" aria-labelledby="file-preview-title">' +
    '<div class="modal-header"><div><h2 id="file-preview-title">' + esc(file.file_name) + '</h2><p>' + esc(sizeLabel) + ' · ' + esc(file.content_type || "Jenis file tidak tercatat") + '</p></div><button type="button" class="icon-button file-preview-close" aria-label="Tutup preview">×</button></div>' +
    '<div class="modal-body file-preview-body"><div id="file-preview-meta" class="file-preview-meta">Menyiapkan pratinjau…</div><div id="file-preview-stage" class="file-preview-stage"><div class="file-preview-loading">Memuat file…</div></div></div>' +
    '<div class="modal-footer"><span class="section-note">Preview tidak mengubah file asli.</span><button type="button" class="btn btn-secondary file-preview-close">Tutup</button><button type="button" class="btn btn-primary file-preview-download" data-kind="' + (kind === "content" ? "content" : "attachment") + '" data-id="' + esc(file.id) + '">Unduh file</button></div>' +
    '</section></div>');
  const stage = $("#file-preview-stage", $("#modal-root"));
  const meta = $("#file-preview-meta", $("#modal-root"));
  if (previewType === "unsupported") {
    meta.textContent = "Format file ini belum didukung preview langsung di browser.";
    stage.innerHTML = '<div class="file-preview-unsupported"><strong>Preview belum tersedia untuk format ini.</strong><p>File tetap aman tersimpan. Klik “Unduh file” untuk membukanya menggunakan aplikasi yang sesuai.</p></div>';
    return;
  }
  if (Number(file.size_bytes || 0) > 150 * 1024 * 1024) {
    meta.textContent = "File berukuran besar (" + sizeLabel + "). Proses preview dapat membutuhkan waktu dan memori.";
  }
  try {
    const blob = await downloadStoredFile(file, true);
    if (requestId !== state.previewRequestId || !stage.isConnected) return;
    const objectUrl = URL.createObjectURL(blob);
    state.previewObjectUrl = objectUrl;
    if (previewType === "pptx") {
      await renderPowerPointPreview(blob, stage, meta, requestId);
    } else if (previewType === "image") {
      stage.innerHTML = '<img class="file-preview-image" src="' + esc(objectUrl) + '" alt="Preview ' + esc(file.file_name) + '">';
      const image = $(".file-preview-image", stage);
      image.addEventListener("load", () => {
        if (requestId === state.previewRequestId && meta.isConnected) {
          meta.textContent = "Resolusi asli: " + image.naturalWidth + " × " + image.naturalHeight + " px · ditampilkan proporsional tanpa crop.";
        }
      }, { once: true });
      image.addEventListener("error", () => {
        if (requestId === state.previewRequestId && stage.isConnected) {
          stage.innerHTML = '<div class="file-preview-unsupported"><strong>Gambar tidak dapat ditampilkan.</strong><p>File mungkin rusak atau formatnya tidak didukung browser.</p></div>';
        }
      }, { once: true });
    } else if (previewType === "pdf") {
      meta.textContent = "PDF ditampilkan lewat viewer browser. Gunakan zoom di viewer untuk mengatur pembesaran.";
      stage.innerHTML = '<iframe class="file-preview-pdf" src="' + esc(objectUrl) + '" title="Preview PDF ' + esc(file.file_name) + '"></iframe>';
    } else if (previewType === "video") {
      meta.textContent = "Video ditampilkan sesuai rasio aslinya; kontrol pemutar tersedia di bawah.";
      stage.innerHTML = '<video class="file-preview-video" controls playsinline preload="metadata" src="' + esc(objectUrl) + '">Browser tidak mendukung pemutaran video ini.</video>';
      const video = $(".file-preview-video", stage);
      video.addEventListener("loadedmetadata", () => {
        if (requestId === state.previewRequestId && meta.isConnected && video.videoWidth && video.videoHeight) meta.textContent = "Resolusi video: " + video.videoWidth + " × " + video.videoHeight + " px · rasio asli dipertahankan.";
      }, { once: true });
    } else if (previewType === "audio") {
      meta.textContent = "Gunakan kontrol pemutar audio di bawah.";
      stage.innerHTML = '<audio class="file-preview-audio" controls preload="metadata" src="' + esc(objectUrl) + '">Browser tidak mendukung pemutaran audio ini.</audio>';
    } else if (previewType === "text") {
      const textContent = await blob.text();
      if (requestId !== state.previewRequestId || !stage.isConnected) return;
      const maxChars = 500000;
      stage.innerHTML = '<pre class="file-preview-text">' + esc(textContent.slice(0, maxChars)) + '</pre>';
      meta.textContent = textContent.length > maxChars
        ? "Tampilan teks dibatasi pada 500.000 karakter pertama agar halaman tetap responsif."
        : "Pratinjau teks · " + textContent.length.toLocaleString("id-ID") + " karakter.";
    }
  } catch (error) {
    if (requestId === state.previewRequestId && stage.isConnected) {
      stage.innerHTML = '<div class="file-preview-unsupported"><strong>File gagal dimuat untuk preview.</strong><p>' + esc(error.message || "Periksa akses penyimpanan dan coba lagi.") + '</p><p>File asli tidak diubah. Kamu masih bisa mencoba tombol Unduh file.</p></div>';
      meta.textContent = "Preview gagal dimuat.";
    }
  }
}


async function deleteContent(contentGroupId) {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  if (!window.confirm("Hapus content “" + group.title + "” beserta " + group.files.length + " file untuk semua pengguna?")) return;
  try {
    for (const file of group.files) await removeStorageObjects(getStoredPaths(file), file.storage_provider || "supabase");
  } catch (error) { return toast("File belum dapat dihapus: " + (error.message || ""), "error"); }
  const { error } = await supabase.from("content_assets").delete().eq("content_group_id", contentGroupId);
  if (error) return toast("File terhapus, tetapi data content belum terhapus: " + error.message, "error");
  toast("Content dan semua lampirannya berhasil dihapus.");
  await loadWorkspace();
}

async function changeContentStatus(contentGroupId, status, revisionNote = "") {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  const { error } = await supabase.from("content_assets").update({ status, revision_note: revisionNote }).eq("content_group_id", contentGroupId);
  if (error) return toast("Status content belum berubah: " + error.message, "error");
  const label = status === "in_review" ? "Content masuk Menunggu approval" : status === "done" ? "Content disetujui dan menjadi Done" : "Content diminta revisi";
  toast(label);
  await notifyTelegram("content_status", group.title, STATUS[status] || status, revisionNote || (contentFormatLabel(group.content_format) + " · " + group.files.length + " file"));
  await loadWorkspace();
}
function openContentRevision(contentGroupId) {
  const group = groupContentAssets().find((asset) => asset.content_group_id === contentGroupId);
  if (!group) return toast("Content tidak ditemukan.", "error");
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card" role="dialog" aria-modal="true" aria-labelledby="content-revision-title"><div class="modal-header"><div><h2 id="content-revision-title">Revisi content</h2><p>' + esc(group.title) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="content-revision-form"><div class="modal-body"><input type="hidden" name="content_group_id" value="' + esc(contentGroupId) + '"><label for="content-revision-note">Deskripsi revisi *</label><textarea id="content-revision-note" name="comment" required maxlength="3000" rows="5" placeholder="Jelaskan bagian yang harus diperbaiki…"></textarea></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-warning">Kirim revisi</button></div></form></section></div>';
}
async function sendContentRevision(form) {
  const data = new FormData(form);
  const groupId = String(data.get("content_group_id") || "");
  const note = String(data.get("comment") || "").trim();
  if (!groupId || !note) return toast("Deskripsi revisi wajib diisi.", "error");
  $("#modal-root").innerHTML = "";
  await changeContentStatus(groupId, "changes_requested", note);
}
function openVisitEditor(visitId) {
  const visit = state.visitSchedules.find((item) => item.id === visitId);
  if (!visit) return toast("Schedule visit tidak ditemukan.", "error");
  $("#modal-root").innerHTML = '<div class="modal-backdrop" data-backdrop><section class="modal-card modal-wide" role="dialog" aria-modal="true" aria-labelledby="visit-edit-title"><div class="modal-header"><div><h2 id="visit-edit-title">Edit schedule visit</h2><p>' + esc(visit.title) + '</p></div><button class="icon-button close-modal" aria-label="Tutup">×</button></div><form id="visit-edit-form"><input type="hidden" name="id" value="' + esc(visit.id) + '"><div class="modal-body"><div class="form-grid">' + visitFieldsHTML("edit", visit) + '</div></div><div class="modal-footer"><button type="button" class="btn btn-secondary close-modal">Batal</button><button type="submit" class="btn btn-primary">Simpan perubahan</button></div></form></section></div>';
}
function visitPayload(form) {
  const data = new FormData(form);
  return {
    title: String(data.get("title") || "").trim(),
    city: String(data.get("city") || "").trim(),
    visit_date: String(data.get("visit_date") || ""),
    start_time: String(data.get("start_time") || ""),
    end_date: String(data.get("end_date") || ""),
    end_time: String(data.get("end_time") || ""),
    job_description: String(data.get("job_description") || "").trim(),
    status: String(data.get("status") || "planned")
  };
}
async function saveVisitSchedule(form) {
  const data = new FormData(form);
  const id = String(data.get("id") || "");
  const payload = visitPayload(form);
  if (!payload.title || !payload.city || !payload.visit_date || !payload.start_time || !payload.end_date || !payload.end_time) {
    return toast("Judul, kota, tanggal dan jam mulai/selesai wajib diisi.", "error");
  }
  const start = new Date(payload.visit_date + "T" + payload.start_time);
  const end = new Date(payload.end_date + "T" + payload.end_time);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) return toast("Waktu selesai tidak boleh lebih awal daripada waktu mulai.", "error");
  if (!VISIT_STATUS[payload.status]) return toast("Pilih status visit yang tersedia.", "error");
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  button.textContent = id ? "Menyimpan…" : "Membuat schedule…";
  let saved, error;
  if (id) {
    ({ data: saved, error } = await supabase.from("visit_schedules").update({ ...payload, updated_at: new Date().toISOString() }).eq("id", id).select("*").single());
  } else {
    ({ data: saved, error } = await supabase.from("visit_schedules").insert({ ...payload, created_by: state.user.id }).select("*").single());
  }
  if (error) {
    button.disabled = false;
    button.textContent = id ? "Simpan perubahan" : "＋ Simpan schedule";
    return toast("Schedule visit belum tersimpan: " + error.message, "error");
  }
  $("#modal-root").innerHTML = "";
  toast(id ? "Schedule visit berhasil diperbarui." : "Schedule visit berhasil dibuat.");
  const prefix = id ? "Jadwal diperbarui" : "Jadwal baru";
  await notifyTelegram("visit_schedule", saved.title, VISIT_STATUS[saved.status], prefix + " · Kota: " + saved.city + " · " + visitWindowLabel(saved) + " · Job: " + (saved.job_description || "tanpa deskripsi"));
  state.view = "visits";
  await loadWorkspace();
}
async function changeVisitStatus(visitId, newStatus) {
  if (!VISIT_STATUS[newStatus]) return;
  const visit = state.visitSchedules.find((item) => item.id === visitId);
  if (!visit) return;
  const { data, error } = await supabase.from("visit_schedules").update({ status: newStatus, updated_at: new Date().toISOString() }).eq("id", visitId).select("*").single();
  if (error) {
    toast("Status visit belum berubah: " + error.message, "error");
    renderPage();
    return;
  }
  toast("Status visit diubah menjadi " + VISIT_STATUS[newStatus] + ".");
  await notifyTelegram("visit_schedule", visit.title, VISIT_STATUS[newStatus], "Status visit diperbarui · Kota: " + visit.city + " · " + visitWindowLabel(data));
  await loadWorkspace();
}
async function deleteVisitSchedule(visitId) {
  const visit = state.visitSchedules.find((item) => item.id === visitId);
  if (!visit) return toast("Schedule visit tidak ditemukan.", "error");
  if (!window.confirm('Hapus schedule "' + visit.title + '" di ' + visit.city + '? Penghapusan berlaku untuk kedua kode login.')) return;
  const { error } = await supabase.from("visit_schedules").delete().eq("id", visitId);
  if (error) return toast("Schedule visit belum dapat dihapus: " + error.message, "error");
  toast("Schedule visit berhasil dihapus.");
  await notifyTelegram("visit_deleted", visit.title, "Dihapus", "Kota: " + visit.city + " · " + visitWindowLabel(visit));
  await loadWorkspace();
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
  const passphrase = window.prompt("Buat password backup minimal 16 karakter. Simpan di tempat aman; tanpa password ini backup tidak bisa dipulihkan.");
  if (!passphrase) return;
  if (passphrase.length < 16) return toast("Password backup harus minimal 16 karakter.", "error");
  const confirmation = window.prompt("Ketik ulang password backup untuk konfirmasi.");
  if (confirmation !== passphrase) return toast("Konfirmasi password tidak cocok. Backup dibatalkan.", "error");
  toast("Menyiapkan data, schedule, dan lampiran untuk backup…", "success");
  try {
    const [tasksRes, commentsRes, attachmentsRes, contentRes, visitsRes, activitiesRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at"),
      supabase.from("task_comments").select("*").order("created_at"),
      supabase.from("task_attachments").select("*").order("created_at"),
      supabase.from("content_assets").select("*").order("created_at"),
      supabase.from("visit_schedules").select("*").order("visit_date"),
      supabase.from("activity_log").select("*").order("created_at")
    ]);
    for (const result of [tasksRes, commentsRes, attachmentsRes, contentRes, visitsRes, activitiesRes]) {
      if (result.error) throw result.error;
    }
    const attachments = attachmentsRes.data || [];
    const contentAssets = contentRes.data || [];
    const allFileBytes = [...attachments, ...contentAssets].reduce((sum, item) => sum + Number(item.size_bytes || 0), 0);
    if (allFileBytes > 300 * 1024 * 1024) {
      throw new Error("Total lampiran dan content melebihi 300 MiB. Backup terenkripsi berbasis browser belum aman untuk paket sebesar ini; simpan file berukuran besar di media cadangan terenkripsi terpisah.");
    }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = new JSZip();
    const manifest = {
      format: "ruang-kerja-encrypted-backup",
      version: 2,
      created_at: new Date().toISOString(),
      profiles: state.profiles.map((p) => ({
        id: p.id, display_name: p.display_name, access_label: p.access_label || p.display_name,
        access_color: p.access_color || "#dc2626", role: p.role
      })),
      tasks: tasksRes.data || [],
      comments: commentsRes.data || [],
      attachments,
      contentAssets,
      visitSchedules: visitsRes.data || [],
      activities: activitiesRes.data || []
    };
    zip.file("backup.json", JSON.stringify(manifest));
    for (let i = 0; i < attachments.length; i++) {
      const item = attachments[i];
      const blob = await downloadStoredFile(item, true);
      zip.file("files/" + item.id, blob);
      if ((i + 1) % 5 === 0 || i === attachments.length - 1) toast("Menyiapkan lampiran tugas " + (i + 1) + "/" + attachments.length + "…", "success");
    }
    for (let i = 0; i < contentAssets.length; i++) {
      const item = contentAssets[i];
      const blob = await downloadStoredFile(item, true);
      zip.file("content-files/" + item.id, blob);
      if ((i + 1) % 5 === 0 || i === contentAssets.length - 1) toast("Menyiapkan file content " + (i + 1) + "/" + contentAssets.length + "…", "success");
    }
    const archive = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 5 } });
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveBackupKey(passphrase, salt, ["encrypt"]);
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, archive));
    const envelope = new Uint8Array(36 + encrypted.length);
    envelope.set([82, 75, 87, 49, 0, 0, 0, 2], 0);
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
  if (!file || file.size < 64 || file.size > 400 * 1024 * 1024) return toast("File backup tidak valid atau melebihi batas 400 MiB.", "error");
  const passphrase = window.prompt("Masukkan password yang dipakai saat membuat backup.");
  if (!passphrase) return;
  toast("Memverifikasi dan membuka backup…", "success");
  try {
    const envelope = new Uint8Array(await file.arrayBuffer());
    const magic = [82, 75, 87, 49, 0, 0, 0, envelope[7]];
    if (![1, 2].includes(envelope[7]) || !magic.every((value, index) => envelope[index] === value)) throw new Error("Format file backup tidak dikenali.");
    const version = envelope[7];
    const salt = envelope.slice(8, 24);
    const iv = envelope.slice(24, 36);
    const encrypted = envelope.slice(36);
    const key = await deriveBackupKey(passphrase, salt, ["decrypt"]);
    let archive;
    try { archive = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, encrypted)); }
    catch (_) { throw new Error("Password salah atau file backup rusak."); }
    const { default: JSZip } = await import("https://cdn.jsdelivr.net/npm/jszip@3.10.1/+esm");
    const zip = await JSZip.loadAsync(archive);
    const manifestFile = zip.file("backup.json");
    if (!manifestFile) throw new Error("Isi backup.json tidak ditemukan.");
    const backup = JSON.parse(await manifestFile.async("string"));
    if (backup.format !== "ruang-kerja-encrypted-backup" || backup.version !== version ||
        !Array.isArray(backup.tasks) || !Array.isArray(backup.comments) ||
        !Array.isArray(backup.attachments) || !Array.isArray(backup.activities) ||
        !Array.isArray(backup.profiles)) throw new Error("Struktur backup tidak valid.");
    const contentAssets = Array.isArray(backup.contentAssets) ? backup.contentAssets : [];
    const visitSchedules = Array.isArray(backup.visitSchedules) ? backup.visitSchedules : [];
    const profileMap = {};
    backup.profiles.forEach((oldProfile) => {
      const oldLabel = oldProfile.access_label || oldProfile.display_name || "";
      const match = state.profiles.find((p) => (p.access_label || p.display_name) === oldLabel) ||
        state.profiles.find((p) => p.display_name === oldProfile.display_name) ||
        state.profiles.find((p) => p.role === oldProfile.role) || state.profile;
      if (match) profileMap[oldProfile.id] = match.id;
    });
    const mapProfile = (id) => (id && profileMap[id]) || state.user.id;
    const { data: presentTasks, error: taskReadError } = await supabase.from("tasks").select("id");
    if (taskReadError) throw taskReadError;
    const taskIds = new Set((presentTasks || []).map((t) => t.id));
    let restoredTasks = 0;
    const statusToRestore = [];
    for (const old of backup.tasks) {
      if (taskIds.has(old.id)) continue;
      const assignedTo = mapProfile(old.assigned_to);
      const payload = {
        id: old.id, title: old.title, description: old.description || "",
        due_date: old.due_date || null, due_time: old.due_time || null, priority: old.priority || "normal",
        status: "todo", created_by: state.user.id, assigned_to: assignedTo,
        created_at: old.created_at
      };
      const { error } = await supabase.from("tasks").insert(payload);
      if (error) throw error;
      taskIds.add(old.id); restoredTasks++;
      if (old.status && old.status !== "todo") statusToRestore.push({ id: old.id, status: old.status });
    }
    for (const row of statusToRestore) {
      const staged = row.status === "in_progress" ? ["in_progress"] :
        row.status === "in_review" ? ["in_review"] :
        row.status === "changes_requested" ? ["in_progress", "in_review", "changes_requested"] :
        ["approved", "done"].includes(row.status) ? ["in_review", "done"] : [];
      for (const status of staged) {
        const { error } = await supabase.from("tasks").update({ status }).eq("id", row.id);
        if (error) throw error;
      }
    }
    const { data: presentComments, error: commentReadError } = await supabase.from("task_comments").select("id");
    if (commentReadError) throw commentReadError;
    const commentIds = new Set((presentComments || []).map((r) => r.id));
    const missingComments = backup.comments.filter((c) => !commentIds.has(c.id)).map((c) => ({
      id: c.id, task_id: c.task_id, user_id: state.user.id, comment: c.comment, created_at: c.created_at
    }));
    await insertInChunks("task_comments", missingComments);
    const { data: presentAttachments, error: attachmentReadError } = await supabase.from("task_attachments").select("id,path");
    if (attachmentReadError) throw attachmentReadError;
    const attachmentIds = new Set((presentAttachments || []).map((r) => r.id));
    const attachmentPaths = new Set((presentAttachments || []).map((r) => r.path));
    const missingMetadata = [];
    for (const item of backup.attachments) {
      if (attachmentIds.has(item.id)) continue;
      const entry = zip.file("files/" + item.id);
      if (!entry) throw new Error("Konten lampiran tidak ada di backup: " + item.file_name);
      const bytes = await entry.async("uint8array");
      const blob = new Blob([bytes], { type: item.content_type || "application/octet-stream" });
      const restoredFile = new File([blob], item.file_name, { type: item.content_type || "application/octet-stream" });
      const uploaded = await uploadPrivateFile(item.task_id, restoredFile);
      if (attachmentPaths.has(uploaded.path)) continue;
      missingMetadata.push({
        id: item.id, task_id: item.task_id, path: uploaded.path, storage_parts: uploaded.storage_parts, storage_provider: uploaded.storage_provider || "google_drive",
        file_name: item.file_name, content_type: item.content_type || "application/octet-stream",
        size_bytes: restoredFile.size, uploaded_by: state.user.id, created_at: item.created_at,
        attachment_type: item.attachment_type || "work"
      });
      attachmentIds.add(item.id); attachmentPaths.add(uploaded.path);
    }
    await insertInChunks("task_attachments", missingMetadata, 20);

    const { data: presentContent, error: contentReadError } = await supabase.from("content_assets").select("id");
    if (contentReadError) throw contentReadError;
    const contentIds = new Set((presentContent || []).map((item) => item.id));
    const missingContent = [];
    for (const item of contentAssets) {
      if (contentIds.has(item.id)) continue;
      const entry = zip.file("content-files/" + item.id);
      if (!entry) throw new Error("File content tidak ada di backup: " + item.file_name);
      const bytes = await entry.async("uint8array");
      const blob = new Blob([bytes], { type: item.content_type || "application/octet-stream" });
      const restoredFile = new File([blob], item.file_name, { type: item.content_type || "application/octet-stream" });
      const uploaded = await uploadPrivateFile("content", restoredFile);
      missingContent.push({
        id: item.id, content_group_id: item.content_group_id || crypto.randomUUID(), title: item.title,
        caption: item.caption || "", scheduled_date: item.scheduled_date || null,
        scheduled_time: item.scheduled_time || null, content_format: item.content_format || "feed",
        status: item.status || "todo", revision_note: item.revision_note || "",
        path: uploaded.path, storage_parts: uploaded.storage_parts, storage_provider: uploaded.storage_provider || "google_drive", file_name: item.file_name,
        content_type: item.content_type || "application/octet-stream", size_bytes: restoredFile.size,
        uploaded_by: state.user.id, created_at: item.created_at
      });
      contentIds.add(item.id);
    }
    await insertInChunks("content_assets", missingContent, 20);

    const { data: presentVisits, error: visitReadError } = await supabase.from("visit_schedules").select("id");
    if (visitReadError) throw visitReadError;
    const visitIds = new Set((presentVisits || []).map((item) => item.id));
    const missingVisits = visitSchedules.filter((v) => !visitIds.has(v.id)).map((v) => ({
      id: v.id, title: v.title, city: v.city, visit_date: v.visit_date, start_time: v.start_time,
      end_date: v.end_date, end_time: v.end_time, job_description: v.job_description || "",
      status: v.status || "planned", created_by: state.user.id, created_at: v.created_at, updated_at: v.updated_at || v.created_at
    }));
    await insertInChunks("visit_schedules", missingVisits, 40);

    const { data: presentActivity, error: activityReadError } = await supabase.from("activity_log").select("id");
    if (activityReadError) throw activityReadError;
    const activityIds = new Set((presentActivity || []).map((r) => r.id));
    const missingActivity = backup.activities.filter((a) => !activityIds.has(a.id)).map((a) => ({
      id: a.id, task_id: a.task_id && taskIds.has(a.task_id) ? a.task_id : null,
      actor_id: state.user.id, action: a.action, details: a.details || {}, created_at: a.created_at
    }));
    await insertInChunks("activity_log", missingActivity, 40);
    await loadWorkspace();
    toast("Pemulihan selesai. " + restoredTasks + " tugas baru dipulihkan; metadata dan file yang sudah ada tidak ditimpa.", "success");
  } catch (error) {
    toast("Pemulihan belum selesai: " + (error.message || "kesalahan yang tidak diketahui") + ". Kamu dapat mencoba lagi; catatan yang sudah ada tidak ditimpa.", "error");
  }
}

function closeModal() {
  closeFilePreview();
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
  state.contentAssets = [];
  state.activities = [];
  state.visitSchedules = [];
  showAuth("Kamu sudah keluar dari ruang kerja.", "success");
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!supabase) return;

  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  const data = new FormData(form);
  const accessCode = String(data.get("access_code") || "").trim().toUpperCase().replace(/\s+/g, "");
  if (accessCode.length < 20) {
    setAuthMessage("Masukkan kode akses yang lengkap.", "error");
    return;
  }

  button.disabled = true;
  button.textContent = "Memverifikasi kode…";
  setAuthMessage("");

  let user = null;
  try {
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) throw sessionError;

    user = sessionData.session?.user || null;
    if (!user || !user.is_anonymous) {
      if (user) await supabase.auth.signOut();
      const { data: anonymousData, error: anonymousError } = await supabase.auth.signInAnonymously();
      if (anonymousError) {
        if (/anonymous|disabled|sign.?in provider/i.test(anonymousError.message || "")) {
          throw new Error("Mode kode akses belum diaktifkan di Supabase. Aktifkan Authentication → Providers → Anonymous Sign-Ins, lalu coba lagi.");
        }
        throw anonymousError;
      }
      user = anonymousData.user || anonymousData.session?.user || null;
    }
    if (!user) throw new Error("Sesi belum terbentuk. Coba sekali lagi.");

    const { data: accepted, error: codeError } = await supabase.rpc("activate_access_code", { p_code: accessCode });
    if (codeError) throw codeError;
    if (accepted !== true) {
      await supabase.auth.signOut();
      state.user = null;
      state.profile = null;
      showAuth("Kode akses salah atau tidak aktif. Periksa kode lalu coba lagi.", "error");
      return;
    }

    form.reset();
    state.user = user;
    setAuthMessage("Kode diterima. Membuka ruang kerja…", "success");
    await enterApp(user);
  } catch (error) {
    if (user && /kode akses/i.test(error.message || "") && /belum diaktifkan/i.test(error.message || "")) {
      await supabase.auth.signOut().catch(() => {});
    }
    showAuth(error.message || "Tidak dapat masuk. Periksa koneksi dan coba lagi.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Masuk ke ruang kerja";
  }
});

document.addEventListener("click", async (event) => {
  const nav = event.target.closest("[data-view]");
  if (nav) { changeView(nav.dataset.view); return; }
  if (event.target.closest("[data-instagram-refresh-all]")) { await refreshInstagramPosts(); return; }
  const refreshInstagramOne = event.target.closest(".ig-refresh-one");
  if (refreshInstagramOne) { await refreshInstagramPosts([refreshInstagramOne.dataset.id]); return; }
  const deleteInstagramPost = event.target.closest(".ig-delete-post");
  if (deleteInstagramPost) {
    state.instagramReport.posts = state.instagramReport.posts.filter((post) => post.id !== deleteInstagramPost.dataset.id);
    saveInstagramPosts();
    renderPage();
    return;
  }
  if (event.target.closest("#test-telegram-button")) { toast("Mengirim tes notifikasi Telegram…", "success"); const sent = await notifyTelegram("task_status", "Tes notifikasi Telegram", "Tes koneksi", "Pesan percobaan dari portal Ruang Kerja."); if (sent) toast("Tes berhasil dikirim ke Telegram.", "success"); return; }
  if (event.target.closest("#new-task-top") || event.target.closest("[data-create-task]")) { openCreateModal(); return; }
  if (event.target.closest("[data-connect-google-drive]")) { await connectGoogleDrive(); return; }
  const editVisit = event.target.closest("[data-edit-visit]");
  if (editVisit) { openVisitEditor(editVisit.dataset.editVisit); return; }
  const deleteVisit = event.target.closest("[data-delete-visit]");
  if (deleteVisit) { await deleteVisitSchedule(deleteVisit.dataset.deleteVisit); return; }
  const deleteTaskButton = event.target.closest(".delete-task");
  if (deleteTaskButton) { await deleteTask(deleteTaskButton.dataset.id); return; }
  if (event.target.closest("#mobile-menu-button")) { $("#sidebar").classList.toggle("mobile-open"); return; }
  if (event.target.closest("#logout-button")) { await logout(); return; }
  const openTask = event.target.closest(".task-open");
  if (openTask) { openTaskModal(openTask.dataset.id); return; }
  const quickStatus = event.target.closest(".task-quick-status");
  if (quickStatus) { await changeTaskStatus(quickStatus.dataset.id, quickStatus.dataset.status); return; }
  const quickRevision = event.target.closest(".task-quick-revision");
  if (quickRevision) { openTaskModal(quickRevision.dataset.id); const box = $("#revision-box"); if (box) { box.hidden = false; $("#revision-note")?.focus(); } return; }
  const contentRevision = event.target.closest(".content-quick-revision");
  if (contentRevision) { openContentRevision(contentRevision.dataset.id); return; }
  const contentApprove = event.target.closest(".content-quick-approve");
  if (contentApprove) { await changeContentStatus(contentApprove.dataset.id, "done", ""); return; }
  const contentMarkDone = event.target.closest(".content-mark-done");
  if (contentMarkDone) { await changeContentStatus(contentMarkDone.dataset.id, "in_review", ""); return; }
  const copyCaption = event.target.closest(".copy-caption");
  if (copyCaption) { const content = groupContentAssets().find((item) => item.content_group_id === copyCaption.dataset.id); if (!content) return toast("Caption tidak ditemukan.", "error"); try { await navigator.clipboard.writeText(content.caption || ""); toast(content.caption ? "Caption berhasil disalin." : "Caption kosong."); } catch { toast("Clipboard tidak tersedia. Salin caption dari teks content.", "error"); } return; }
  const submitTaskFile = event.target.closest(".submit-task-file");
  if (submitTaskFile) { await changeTaskStatus(submitTaskFile.dataset.id, "in_review"); return; }
  const deleteTaskFile = event.target.closest(".delete-task-file");
  if (deleteTaskFile) { await deleteTaskAttachment(deleteTaskFile.dataset.id); return; }
  const status = event.target.closest("[data-task-status]");
  if (status) { await changeTaskStatus(status.dataset.id, status.dataset.taskStatus); return; }
  const revision = event.target.closest("[data-show-revision]");
  if (revision) { const box = $("#revision-box"); box.hidden = !box.hidden; $("#revision-note")?.focus(); return; }
  if (event.target.closest("[data-backup-export]")) { await exportEncryptedBackup(); return; }
  if (event.target.closest("[data-backup-restore]")) {
    // Backup: semua pemegang kode akses memiliki hak yang sama.
    const picker = document.createElement("input");
    picker.type = "file"; picker.accept = ".rkbak,application/octet-stream";
    picker.addEventListener("change", () => restoreEncryptedBackup(picker.files && picker.files[0]));
    picker.click(); return;
  }
  const previewButton = event.target.closest(".preview-file");
  if (previewButton) { await previewFile(previewButton.dataset.id, previewButton.dataset.kind || "attachment"); return; }
  const previewDownload = event.target.closest(".file-preview-download");
  if (previewDownload) {
    const item = previewDownload.dataset.kind === "content"
      ? state.contentAssets.find((asset) => asset.id === previewDownload.dataset.id)
      : state.attachments.find((asset) => asset.id === previewDownload.dataset.id);
    if (!item) return toast("File tidak ditemukan.", "error");
    try { await downloadStoredFile(item); }
    catch (error) { toast("File tidak dapat diunduh: " + (error.message || "kesalahan tidak diketahui"), "error"); }
    return;
  }
  if (event.target.closest(".file-preview-close") || event.target.matches("[data-preview-backdrop]")) { closeFilePreview(); return; }
  const download = event.target.closest(".download-file");
  if (download) { await downloadFile(download.dataset.id); return; }
  const contentDownload = event.target.closest(".download-content");
  if (contentDownload) { await downloadContentFile(contentDownload.dataset.id); return; }
  const contentDelete = event.target.closest(".delete-content");
  if (contentDelete) { await deleteContent(contentDelete.dataset.id); return; }
  if (event.target.closest(".close-modal")) { closeModal(); return; }
  if (event.target.matches("[data-backdrop]")) { closeModal(); }
});
document.addEventListener("input", (event) => {
  if (event.target.id === "task-search") applyTaskFilters();
  else if (event.target.matches(".ig-metric-edit")) {
    const post = state.instagramReport.posts.find((item) => item.id === event.target.dataset.postId);
    if (!post) return;
    const raw = String(event.target.value || "").trim();
    post[event.target.dataset.field] = raw === "" ? null : (Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Math.floor(Number(raw)) : null);
    saveInstagramPosts();
    const row = event.target.closest("tr");
    const total = $(".ig-row-total strong", row);
    if (total) total.textContent = formatMetric(instagramKnownTotal(post));
    const cards = $(".ig-metric-card strong");
    const fields = ["likes","comments","shares","reposts"];
    fields.forEach((field,index) => { if (cards[index]) cards[index].textContent = formatMetric(instagramSum(field)); });
    if (cards[4]) cards[4].textContent = formatMetric(state.instagramReport.posts.map(instagramKnownTotal).filter((value)=>value!==null).reduce((sum,value)=>sum+value,0));
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-visit-status]")) {
    await changeVisitStatus(event.target.dataset.visitStatus, event.target.value);
    return;
  }
  if (event.target.id === "task-status-filter" || event.target.id === "task-priority-filter") applyTaskFilters();
});
document.addEventListener("submit", async (event) => {
  if (event.target.id === "instagram-post-form") {
    event.preventDefault();
    const postUrl = new FormData(event.target).get("post_url") || "";
    event.target.reset();
    await addInstagramPost(postUrl);
  }
  else if (event.target.id === "create-task-form") { event.preventDefault(); await createTask(event.target); }
  else if (event.target.id === "revision-form") { event.preventDefault(); await sendRevision(event.target); }
  else if (event.target.id === "comment-form") { event.preventDefault(); await addComment(event.target); }
  else if (event.target.id === "upload-form") { event.preventDefault(); await uploadTaskFile(event.target); }
  else if (event.target.id === "content-upload-form") { event.preventDefault(); await uploadContent(event.target); }
  else if (event.target.id === "content-revision-form") { event.preventDefault(); await sendContentRevision(event.target); }
  else if (event.target.id === "visit-create-form" || event.target.id === "visit-edit-form") { event.preventDefault(); await saveVisitSchedule(event.target); }
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
    if (session && ["TOKEN_REFRESHED", "USER_UPDATED"].includes(event) && state.user) {
      window.setTimeout(() => enterApp(session.user), 0);
    } else if (event === "SIGNED_OUT") {
      state.user = null;
      state.profile = null;
      state.profiles = [];
      state.tasks = [];
      state.comments = [];
      state.attachments = [];
      state.contentAssets = [];
      state.activities = [];
      state.visitSchedules = [];
      showAuth();
    }
  });
}
