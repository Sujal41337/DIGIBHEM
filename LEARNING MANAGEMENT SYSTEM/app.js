/**
 * EduNexus LMS — Application Logic
 * Handles: navigation, modals, tabs, chip filters
 */

// ── All registered view names ──
const VIEWS = [
  'dashboard', 'courses', 'assignments',
  'gradebook', 'announcements', 'library',
  'profile', 'settings'
];

const VIEW_LABELS = {
  dashboard:     'Dashboard',
  courses:       'My Courses',
  assignments:   'Assignments',
  gradebook:     'Gradebook',
  announcements: 'Announcements',
  library:       'Library',
  profile:       'Profile',
  settings:      'Settings'
};

// ── Navigation ──
function navigate(view) {
  // Hide all views
  VIEWS.forEach(v => {
    document.getElementById('view-' + v)?.classList.remove('active');
  });

  // Remove active from all nav items
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));

  // Show target view
  const target = document.getElementById('view-' + view);
  if (target) target.classList.add('active');

  // Update topbar title & breadcrumb
  const label = VIEW_LABELS[view] || view;
  const titleEl = document.getElementById('pageTitle');
  const breadEl = document.getElementById('breadcrumbCurrent');
  if (titleEl) titleEl.textContent = label;
  if (breadEl) breadEl.textContent = label;

  // Highlight matching nav item
  document.querySelectorAll('.nav-item').forEach(n => {
    if (n.textContent.trim().toLowerCase().includes(view)) {
      n.classList.add('active');
    }
  });
}

// ── Modals ──
function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.add('open');
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

// Close modal when clicking outside
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.remove('open');
  });
});

// Close modal on Escape key
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  }
});

// ── Chip Filters (single-select per group) ──
document.querySelectorAll('.chip-filter').forEach(group => {
  group.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', () => {
      group.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
});

// ── Tabs (single-select per group) ──
document.querySelectorAll('.tabs').forEach(tabs => {
  tabs.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });
});

// ── Toggle switches (settings page) ──
document.querySelectorAll('.toggle-switch').forEach(toggle => {
  toggle.addEventListener('click', () => {
    toggle.classList.toggle('on');
  });
});

// ── Init: load dashboard on start ──
document.addEventListener('DOMContentLoaded', () => {
  navigate('dashboard');
});
