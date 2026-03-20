/**
 * ═══════════════════════════════════════════════════════════════
 * INKBOARD — script.js
 * All drawing logic, tool management, undo/redo, save/load,
 * cursor preview, and WebSocket (Socket.IO) real-time collab setup.
 * ═══════════════════════════════════════════════════════════════
 */

"use strict";

/* ─────────────────────────────────────────────────────────────
   1. DOM REFERENCES
───────────────────────────────────────────────────────────── */
const canvas          = document.getElementById("drawing-canvas");
const ctx             = canvas.getContext("2d");
const container       = document.getElementById("canvas-container");
const cursorPreview   = document.getElementById("cursor-preview");

// Toolbar controls
const btnPencil       = document.getElementById("btn-pencil");
const btnEraser       = document.getElementById("btn-eraser");
const colorPicker     = document.getElementById("color-picker");
const colorSwatch     = document.getElementById("color-swatch");
const presetColors    = document.querySelectorAll(".preset-color");
const brushSize       = document.getElementById("brush-size");
const sizeLabel       = document.getElementById("size-label");
const btnUndo         = document.getElementById("btn-undo");
const btnRedo         = document.getElementById("btn-redo");
const btnClear        = document.getElementById("btn-clear");
const btnSave         = document.getElementById("btn-save");
const btnLoad         = document.getElementById("btn-load");
const fileInput       = document.getElementById("file-input");

// Status bar
const statusTool      = document.getElementById("status-tool");
const statusCoords    = document.getElementById("status-coords");
const statusSize      = document.getElementById("status-size");
const statusHistory   = document.getElementById("status-history");

// Modal
const modalOverlay    = document.getElementById("modal-overlay");
const modalCancel     = document.getElementById("modal-cancel");
const modalConfirm    = document.getElementById("modal-confirm");

/* ─────────────────────────────────────────────────────────────
   2. APPLICATION STATE
───────────────────────────────────────────────────────────── */
const state = {
  tool:       "pencil",   // "pencil" | "eraser"
  color:      "#1a1a2e",
  size:       6,
  isDrawing:  false,
  lastX:      0,
  lastY:      0,
};

/** Undo / Redo stacks — each entry is a canvas ImageData snapshot */
const undoStack = [];
const redoStack = [];
const MAX_HISTORY = 40;    // cap memory usage

/* ─────────────────────────────────────────────────────────────
   3. CANVAS SETUP & RESIZE
───────────────────────────────────────────────────────────── */

/**
 * Resize the canvas to fill its container, preserving existing artwork
 * by saving/restoring the ImageData (pixel-perfect, no blurring).
 */
function resizeCanvas() {
  // Snapshot current content
  const snapshot = canvas.width > 0
    ? ctx.getImageData(0, 0, canvas.width, canvas.height)
    : null;

  canvas.width  = container.clientWidth;
  canvas.height = container.clientHeight;

  // Re-apply rendering defaults after resize (they reset on dimension change)
  applyContextDefaults();

  // Restore previous content
  if (snapshot) ctx.putImageData(snapshot, 0, 0);
}

/** Apply persistent 2D context settings */
function applyContextDefaults() {
  ctx.lineCap   = "round";
  ctx.lineJoin  = "round";
}

// Initial setup + listen for window resize
resizeCanvas();
window.addEventListener("resize", resizeCanvas);

/* ─────────────────────────────────────────────────────────────
   4. HISTORY — UNDO / REDO
───────────────────────────────────────────────────────────── */

/** Save a snapshot before starting a stroke */
function saveSnapshot() {
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  if (undoStack.length > MAX_HISTORY) undoStack.shift(); // cap size
  redoStack.length = 0;                                  // new action clears redo
  updateHistoryStatus();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  const snapshot = undoStack.pop();
  ctx.putImageData(snapshot, 0, 0);
  updateHistoryStatus();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
  const snapshot = redoStack.pop();
  ctx.putImageData(snapshot, 0, 0);
  updateHistoryStatus();
}

function updateHistoryStatus() {
  statusHistory.textContent = `History: ${undoStack.length}`;
}

/* ─────────────────────────────────────────────────────────────
   5. DRAWING LOGIC
───────────────────────────────────────────────────────────── */

/**
 * Begin a new stroke.
 * @param {number} x - canvas-relative x
 * @param {number} y - canvas-relative y
 */
function startDraw(x, y) {
  saveSnapshot();               // record state before stroke
  state.isDrawing = true;
  state.lastX     = x;
  state.lastY     = y;

  // Draw a single dot for click without drag
  ctx.beginPath();
  ctx.arc(x, y, getEffectiveSize() / 2, 0, Math.PI * 2);
  ctx.fillStyle = state.tool === "eraser" ? "#f5f0ea" : state.color;
  ctx.fill();
}

/**
 * Continue the stroke.
 * @param {number} x
 * @param {number} y
 */
function draw(x, y) {
  if (!state.isDrawing) return;

  ctx.beginPath();
  ctx.moveTo(state.lastX, state.lastY);
  ctx.lineTo(x, y);
  ctx.strokeStyle = state.tool === "eraser" ? "#f5f0ea" : state.color;
  ctx.lineWidth   = getEffectiveSize();
  ctx.stroke();

  state.lastX = x;
  state.lastY = y;

  // Emit drawing data to collab peers (Socket.IO)
  emitDraw({ x0: state.lastX, y0: state.lastY, x1: x, y1: y,
             color: ctx.strokeStyle, size: ctx.lineWidth });
}

/** End the stroke */
function endDraw() {
  if (!state.isDrawing) return;
  state.isDrawing = false;
  ctx.closePath();
}

/**
 * Resolve effective brush size:
 * Eraser gets ×3 multiplier for comfortable erasure.
 */
function getEffectiveSize() {
  return state.tool === "eraser" ? state.size * 3 : state.size;
}

/* ─────────────────────────────────────────────────────────────
   6. POINTER / MOUSE / TOUCH EVENTS
───────────────────────────────────────────────────────────── */

/**
 * Extract canvas-relative coordinates from a mouse or touch event.
 * @param {MouseEvent|TouchEvent} e
 * @returns {{x: number, y: number}}
 */
function getCoords(e) {
  const rect = canvas.getBoundingClientRect();
  if (e.touches && e.touches.length) {
    return {
      x: e.touches[0].clientX - rect.left,
      y: e.touches[0].clientY - rect.top,
    };
  }
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ── Mouse events ──────────────────────────────────────────────
canvas.addEventListener("mousedown", (e) => {
  const { x, y } = getCoords(e);
  startDraw(x, y);
});

canvas.addEventListener("mousemove", (e) => {
  const { x, y } = getCoords(e);
  updateCursorPreview(e.clientX, e.clientY);
  updateCoordStatus(x, y);
  draw(x, y);
});

canvas.addEventListener("mouseup",   endDraw);
canvas.addEventListener("mouseleave", () => {
  endDraw();
  hideCursorPreview();
});
canvas.addEventListener("mouseenter", showCursorPreview);

// ── Touch events (mobile drawing) ────────────────────────────
canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const { x, y } = getCoords(e);
  startDraw(x, y);
}, { passive: false });

canvas.addEventListener("touchmove", (e) => {
  e.preventDefault();
  const { x, y } = getCoords(e);
  updateCursorPreview(e.touches[0].clientX, e.touches[0].clientY);
  draw(x, y);
}, { passive: false });

canvas.addEventListener("touchend",   endDraw);
canvas.addEventListener("touchcancel", endDraw);

/* ─────────────────────────────────────────────────────────────
   7. CURSOR PREVIEW CIRCLE
───────────────────────────────────────────────────────────── */

function updateCursorPreview(clientX, clientY) {
  const size = getEffectiveSize();
  cursorPreview.style.width   = `${size}px`;
  cursorPreview.style.height  = `${size}px`;
  cursorPreview.style.left    = `${clientX}px`;
  cursorPreview.style.top     = `${clientY}px`;
}

function showCursorPreview() {
  cursorPreview.classList.add("visible");
  cursorPreview.classList.toggle("eraser", state.tool === "eraser");
}

function hideCursorPreview() {
  cursorPreview.classList.remove("visible");
}

/* ─────────────────────────────────────────────────────────────
   8. TOOL SELECTION
───────────────────────────────────────────────────────────── */

function setTool(tool) {
  state.tool = tool;

  // Update ARIA pressed states
  btnPencil.setAttribute("aria-pressed", tool === "pencil");
  btnEraser.setAttribute("aria-pressed", tool === "eraser");
  btnPencil.classList.toggle("active", tool === "pencil");
  btnEraser.classList.toggle("active", tool === "eraser");

  // Update container class for cursor theming
  container.className = `tool-${tool}`;

  // Update status bar
  const label = tool === "pencil" ? "✏ Pencil" : "◻ Eraser";
  statusTool.textContent = label;

  // Update cursor preview ring colour
  cursorPreview.classList.toggle("eraser", tool === "eraser");
}

btnPencil.addEventListener("click", () => setTool("pencil"));
btnEraser.addEventListener("click", () => setTool("eraser"));

/* ─────────────────────────────────────────────────────────────
   9. COLOR MANAGEMENT
───────────────────────────────────────────────────────────── */

/** Apply a hex color string as the active stroke color */
function applyColor(hex) {
  state.color = hex;
  colorPicker.value   = hex;
  colorSwatch.style.background = hex;

  // Highlight the matching preset dot (if any)
  presetColors.forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.color === hex);
  });

  // Auto-switch to pencil when a color is picked
  if (state.tool === "eraser") setTool("pencil");
}

// Native color picker input
colorPicker.addEventListener("input", (e) => applyColor(e.target.value));

// Preset swatch clicks
presetColors.forEach(btn => {
  btn.addEventListener("click", () => applyColor(btn.dataset.color));
});

// Initialise swatch to default color
applyColor(state.color);

/* ─────────────────────────────────────────────────────────────
   10. BRUSH SIZE
───────────────────────────────────────────────────────────── */

brushSize.addEventListener("input", (e) => {
  state.size = parseInt(e.target.value, 10);
  sizeLabel.textContent = state.size;
  statusSize.textContent = `Size: ${state.size} px`;
  // Update cursor preview to reflect new size immediately
  cursorPreview.style.width  = `${getEffectiveSize()}px`;
  cursorPreview.style.height = `${getEffectiveSize()}px`;
});

/* ─────────────────────────────────────────────────────────────
   11. CLEAR CANVAS (with confirmation modal)
───────────────────────────────────────────────────────────── */

btnClear.addEventListener("click", () => {
  modalOverlay.hidden = false;
  modalConfirm.focus();
});

modalCancel.addEventListener("click", () => {
  modalOverlay.hidden = true;
});

modalConfirm.addEventListener("click", () => {
  saveSnapshot();                       // allow undo of clear
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  modalOverlay.hidden = true;
});

// Close modal on backdrop click
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) modalOverlay.hidden = true;
});

// Close modal with Escape key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !modalOverlay.hidden) {
    modalOverlay.hidden = true;
  }
});

/* ─────────────────────────────────────────────────────────────
   12. SAVE — download as PNG
───────────────────────────────────────────────────────────── */

btnSave.addEventListener("click", () => {
  /**
   * We need to composite the canvas content onto a white background
   * so transparent areas save as white (expected for a drawing app).
   */
  const offscreen = document.createElement("canvas");
  offscreen.width  = canvas.width;
  offscreen.height = canvas.height;
  const offCtx = offscreen.getContext("2d");

  // Fill white background
  offCtx.fillStyle = "#f5f0ea";
  offCtx.fillRect(0, 0, offscreen.width, offscreen.height);

  // Draw the main canvas on top
  offCtx.drawImage(canvas, 0, 0);

  const link = document.createElement("a");
  link.download = `inkboard-${Date.now()}.png`;
  link.href = offscreen.toDataURL("image/png");
  link.click();
});

/* ─────────────────────────────────────────────────────────────
   13. LOAD — place an image onto the canvas
───────────────────────────────────────────────────────────── */

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file || !file.type.startsWith("image/")) return;

  saveSnapshot();  // allow undo after load

  const reader = new FileReader();
  reader.onload = (evt) => {
    const img = new Image();
    img.onload = () => {
      // Scale image to fit the canvas while preserving aspect ratio
      const scale = Math.min(
        canvas.width  / img.width,
        canvas.height / img.height,
        1             // never upscale
      );
      const w = img.width  * scale;
      const h = img.height * scale;
      const dx = (canvas.width  - w) / 2;
      const dy = (canvas.height - h) / 2;

      ctx.drawImage(img, dx, dy, w, h);
    };
    img.src = evt.target.result;
  };
  reader.readAsDataURL(file);

  // Reset the input so the same file can be reloaded
  fileInput.value = "";
});

/* ─────────────────────────────────────────────────────────────
   14. KEYBOARD SHORTCUTS
───────────────────────────────────────────────────────────── */

document.addEventListener("keydown", (e) => {
  const tag = document.activeElement.tagName;
  // Don't intercept when user is focused on a text input
  if (tag === "INPUT" && document.activeElement.type === "text") return;

  switch (e.key) {
    case "p": case "P":
      if (!e.ctrlKey && !e.metaKey) setTool("pencil");
      break;

    case "e": case "E":
      if (!e.ctrlKey && !e.metaKey) setTool("eraser");
      break;

    case "c": case "C":
      if (!e.ctrlKey && !e.metaKey) colorPicker.click();
      break;

    case "z": case "Z":
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      break;

    case "y": case "Y":
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); redo(); }
      break;

    case "s": case "S":
      if (e.ctrlKey || e.metaKey) { e.preventDefault(); btnSave.click(); }
      break;

    // [ and ] adjust brush size
    case "[":
      brushSize.value = Math.max(1, state.size - 2);
      brushSize.dispatchEvent(new Event("input"));
      break;
    case "]":
      brushSize.value = Math.min(60, state.size + 2);
      brushSize.dispatchEvent(new Event("input"));
      break;
  }
});

/* ─────────────────────────────────────────────────────────────
   15. UNDO / REDO BUTTONS
───────────────────────────────────────────────────────────── */

btnUndo.addEventListener("click", undo);
btnRedo.addEventListener("click", redo);

/* ─────────────────────────────────────────────────────────────
   16. STATUS BAR — coordinates
───────────────────────────────────────────────────────────── */

function updateCoordStatus(x, y) {
  statusCoords.textContent = `x: ${Math.round(x)}  y: ${Math.round(y)}`;
}

/* ─────────────────────────────────────────────────────────────
   17. REAL-TIME COLLABORATION — Socket.IO
   Frontend-only setup. Connect this to a Socket.IO server to
   enable live drawing across multiple users.
───────────────────────────────────────────────────────────── */

let socket = null;

/**
 * Attempt to connect to the Socket.IO server.
 * Falls back gracefully if the server is unavailable (offline / local use).
 *
 * To enable collab:
 *   1. Run a Node.js Socket.IO server (e.g. on port 3000).
 *   2. Update SERVER_URL below to match.
 *   3. The server should relay "draw" events to all other clients in the room.
 */
const SERVER_URL = "http://localhost:3000";  // ← change for your server

try {
  // socket.io is loaded from CDN via <script defer> — check for availability
  if (typeof io !== "undefined") {
    socket = io(SERVER_URL, {
      transports: ["websocket"],
      reconnectionAttempts: 3,
      timeout: 3000,
    });

    socket.on("connect", () => {
      console.log("[Inkboard] Connected to collab server:", socket.id);
      document.querySelector(".collab-dot").style.background = "#2a9d8f";
    });

    socket.on("disconnect", () => {
      console.log("[Inkboard] Disconnected from collab server.");
      document.querySelector(".collab-dot").style.background = "#e63946";
    });

    /**
     * Receive drawing data from remote peers and render it.
     * Each event carries { x0, y0, x1, y1, color, size }.
     */
    socket.on("draw", (data) => {
      renderRemoteDraw(data);
    });
  }
} catch (err) {
  // Silently suppress connection errors — app works offline too
  console.warn("[Inkboard] Collab server not available (offline mode).", err.message);
}

/**
 * Emit a draw event to the server.
 * No-ops gracefully if socket is not connected.
 * @param {Object} data
 */
function emitDraw(data) {
  if (socket && socket.connected) {
    socket.emit("draw", data);
  }
}

/**
 * Render a stroke segment received from a remote peer.
 * @param {{x0,y0,x1,y1,color,size}} data
 */
function renderRemoteDraw({ x0, y0, x1, y1, color, size }) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth   = size;
  ctx.lineCap     = "round";
  ctx.lineJoin    = "round";
  ctx.stroke();
  ctx.closePath();
}

/* ─────────────────────────────────────────────────────────────
   18. INITIALISATION
───────────────────────────────────────────────────────────── */

// Apply initial tool class to container
container.className = `tool-${state.tool}`;

// Set initial status bar values
statusTool.textContent  = "✏ Pencil";
statusSize.textContent  = `Size: ${state.size} px`;
updateHistoryStatus();

console.log(
  "%c🎨 Inkboard ready!  " +
  "%cP = pencil | E = eraser | C = color | [ ] = size | Ctrl+Z/Y = undo/redo | Ctrl+S = save",
  "color:#e63946;font-weight:bold;font-size:14px;",
  "color:#2a9d8f;font-size:11px;"
);
