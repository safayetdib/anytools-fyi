import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { fromScreen, isFullPage, toScreen, type CropRect } from "./crop";
import { isChanged, movePage, movePageTo, moveSelectedTo } from "./page-order";
import type { ConfirmOptions } from "./confirm";
import type { OutputPreview, PagePlan, PageSize, ToolDefinition, ToolOutput } from "./types";

const t = en.shell;
const PREVIEW_BATCH = 12;
const PAGE_THUMBNAIL_WIDTH = 288;

interface Hooks {
  announce(message: string): void;
  // Asks before throwing work away, and resolves true if the visitor agrees.
  confirm(options: ConfirmOptions): Promise<boolean>;
  // Called when the page plan starts or stops differing from the result file.
  onChange(changed: boolean): void;
  // Called with the rebuilt result after the visitor applies their changes, which then downloads it.
  onApplied(output: ToolOutput): void;
}

function el<T extends HTMLElement>(root: HTMLElement, name: string): T {
  return root.querySelector(`[data-el="${name}"]`) as T;
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : fill(many, { count }));

// The result's page grid: previews in batches and a larger viewer. When the tool can rebuild its result,
// pages can be selected, then rotated, moved or removed from one toolbar, before the visitor applies the plan.
export function createOutputPages(root: HTMLElement, tool: ToolDefinition, hooks: Hooks) {
  const section = el(root, "preview");
  const note = el(root, "preview-note");
  const grid = el<HTMLOListElement>(root, "pages");
  const count = el(root, "preview-count");
  const pageCount = el(root, "page-count");
  const progress = el(root, "preview-progress");
  const more = el<HTMLButtonElement>(root, "more");
  const all = el<HTMLButtonElement>(root, "all");
  const less = el<HTMLButtonElement>(root, "less");
  const apply = el<HTMLButtonElement>(root, "apply");
  const undo = el<HTMLButtonElement>(root, "undo");
  const toolbar = el(root, "page-toolbar");
  const status = el(root, "selection-status");
  const tip = el(root, "page-tip");
  const idleActions = el(root, "idle-actions");
  const selectionActions = el(root, "selection-actions");
  const sizeMenu = el<HTMLDetailsElement>(root, "size-menu");
  const sizeLabel = el(root, "size-label");
  const pageSizeSelect = el<HTMLSelectElement>(root, "page-size");
  const moveMenu = el<HTMLDetailsElement>(root, "move-menu");
  const removeSelected = el<HTMLButtonElement>(root, "remove-selected");
  const movePosition = el<HTMLInputElement>(root, "move-position");
  const viewer = el<HTMLDialogElement>(root, "viewer");
  const viewerTitle = el(root, "viewer-title");
  const viewerImage = el<HTMLImageElement>(root, "viewer-image");
  const viewerPrev = el<HTMLButtonElement>(root, "viewer-prev");
  const viewerNext = el<HTMLButtonElement>(root, "viewer-next");
  const viewerEdit = el(root, "viewer-edit");
  const viewerPosition = el<HTMLInputElement>(root, "viewer-position");
  const viewerScroll = el(root, "viewer-scroll");
  const viewerCanvas = el(root, "viewer-canvas");
  const zoomIn = el<HTMLButtonElement>(root, "zoom-in");
  const zoomOut = el<HTMLButtonElement>(root, "zoom-out");
  const zoomFit = el<HTMLButtonElement>(root, "zoom-fit");
  const zoomLevel = el(root, "zoom-level");
  const cropButton = el<HTMLButtonElement>(root, "viewer-crop");
  const cropBoxEl = el(root, "crop-box");
  const cropTools = el(root, "crop-tools");
  const cropReset = el<HTMLButtonElement>(root, "crop-reset");
  const editable = Boolean(tool.rearrangeOutput);

  let preview: OutputPreview | null = null;
  let file: { name: string; blob: Blob } | null = null;
  let order: number[] = [];
  let shown = 0;
  let token = 0;
  let viewerIndex = 0;
  let viewerToken = 0;
  let applying = false;
  let dragFrom = -1;
  let anchor = -1;
  let pageSize: PageSize = "original";
  const selected = new Set<number>();
  const tiles = new Map<number, HTMLLIElement>();
  // Extra clockwise turns and crops, by page number, not yet applied to the file.
  const rotations = new Map<number, number>();
  const crops = new Map<number, CropRect>();
  const images = new Map<number, { key: string; url: string }>();
  const rendering = new Set<number>();

  note.textContent = editable ? t.previewNoteEditable : t.previewNote;
  viewerEdit.hidden = !editable;
  toolbar.hidden = !editable;

  const rotationOf = (page: number) => rotations.get(page) ?? 0;
  // What a thumbnail shows, so it's redrawn whenever its rotation or crop changes.
  const lookOf = (page: number) => `${rotationOf(page)}:${JSON.stringify(crops.get(page) ?? null)}`;

  function changed() {
    return (
      preview !== null &&
      (isChanged(order, preview.pageCount) ||
        order.some((page) => rotationOf(page) !== 0 || crops.has(page)) ||
        pageSize !== "original")
    );
  }

  function plan(): PagePlan {
    return {
      pages: order.map((page) => ({ page, rotate: rotationOf(page) as 0 | 90 | 180 | 270, crop: crops.get(page) })),
      pageSize,
    };
  }

  // --- Toolbar ---

  function renderToolbar() {
    for (const page of selected) if (!order.includes(page)) selected.delete(page);
    const picking = selected.size > 0;
    // With every page selected, moving changes nothing and removing isn't allowed, so only Rotate and Clear show.
    const everything = picking && selected.size === order.length;
    status.textContent = everything
      ? fill(t.selectedAll, { count: order.length })
      : picking
        ? plural(selected.size, t.selectedOne, t.selectedMany)
        : t.selectPrompt;
    moveMenu.hidden = everything;
    removeSelected.hidden = everything;
    if (everything) moveMenu.open = false;
    tip.hidden = picking;
    idleActions.hidden = picking;
    selectionActions.hidden = !picking;
    if (!picking) moveMenu.open = false;
    else sizeMenu.open = false;
    movePosition.max = String(order.length);
    sizeLabel.textContent = (t.pageSizes as Record<string, string>)[pageSize];
  }

  // --- Grid ---

  function createTile(page: number) {
    const item = document.createElement("li");
    item.className = "shell-page-item";
    item.dataset.page = String(page);
    if (editable) {
      item.draggable = true;
      const check = document.createElement("label");
      check.className = "shell-page-check";
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.select = "";
      const label = document.createElement("span");
      label.className = "shell-page-caption";
      check.append(box, label);
      item.append(check);
    }
    const open = document.createElement("button");
    open.type = "button";
    open.className = "shell-page";
    open.dataset.open = "";
    // The frame keeps every tile the same size, so wide pages show as wide and tall ones as tall.
    const frame = document.createElement("span");
    frame.className = "shell-page-frame";
    const holder = document.createElement("span");
    holder.className = "shell-page-blank";
    frame.append(holder);
    open.append(frame);
    if (!editable) {
      const caption = document.createElement("span");
      caption.className = "shell-page-caption";
      caption.setAttribute("aria-hidden", "true");
      open.append(caption);
    }
    item.append(open);
    return item;
  }

  function updateTile(item: HTMLLIElement, page: number, index: number) {
    const position = index + 1;
    const open = item.querySelector<HTMLButtonElement>("[data-open]") as HTMLButtonElement;
    open.setAttribute("aria-label", fill(t.openPage, { page: position }));
    (item.querySelector(".shell-page-caption") as HTMLElement).textContent = fill(t.pageLabel, { page: position });
    const box = item.querySelector<HTMLInputElement>("[data-select]");
    if (box) {
      box.checked = selected.has(page);
      box.setAttribute("aria-label", fill(t.selectPage, { page: position }));
      item.classList.toggle("is-selected", box.checked);
    }
  }

  function renderGrid() {
    renderToolbar();
    const items = order.slice(0, shown).map((page, index) => {
      let item = tiles.get(page);
      if (!item) {
        item = createTile(page);
        tiles.set(page, item);
      }
      updateTile(item, page, index);
      return item;
    });
    grid.replaceChildren(...items);
    renderPageCount();
    hooks.onChange(changed());
    void renderThumbnails();
  }

  // Each button says exactly how many pages it will show. Show all appears only when it does more than Show more.
  function renderPageCount() {
    const total = order.length;
    const next = Math.min(PREVIEW_BATCH, total - shown);
    pageCount.hidden = total <= PREVIEW_BATCH;
    count.textContent = shown >= total ? fill(t.showingAll, { total }) : fill(t.showing, { shown, total });
    progress.style.width = `${total ? Math.round((shown / total) * 100) : 0}%`;
    more.hidden = next <= 0;
    (more.querySelector("[data-el=more-label]") as HTMLElement).textContent =
      next === 1 ? t.showMoreOne : fill(t.showMoreCount, { count: next });
    all.hidden = total - shown <= PREVIEW_BATCH;
    (all.querySelector("[data-el=all-label]") as HTMLElement).textContent = fill(t.showAllCount, { total });
    less.hidden = shown <= PREVIEW_BATCH;
    (less.querySelector("[data-el=less-label]") as HTMLElement).textContent = fill(t.showLess, { count: PREVIEW_BATCH });
  }

  async function renderThumbnails() {
    const current = preview;
    const run = token;
    if (!current) return;
    for (const page of order.slice(0, shown)) {
      const look = lookOf(page);
      if (images.get(page)?.key === look || rendering.has(page)) continue;
      rendering.add(page);
      try {
        const { blob } = await current.renderPage(page, PAGE_THUMBNAIL_WIDTH, rotationOf(page), crops.get(page));
        if (run !== token) return;
        const url = URL.createObjectURL(blob);
        const old = images.get(page);
        if (old) URL.revokeObjectURL(old.url);
        images.set(page, { key: look, url });
        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        tiles.get(page)?.querySelector(".shell-page-blank, img")?.replaceWith(img);
        // The page may have been turned or cropped again while it was drawing.
        if (lookOf(page) !== look) void renderThumbnails();
      } catch {
        // A page that can't be drawn keeps its blank tile, and the file itself is still fine.
      } finally {
        rendering.delete(page);
      }
    }
  }

  function focusTile(index: number, selector = "[data-select]") {
    const item = grid.children[Math.min(index, grid.children.length - 1)] as HTMLElement | undefined;
    (item?.querySelector<HTMLElement>(selector) ?? item?.querySelector<HTMLElement>("[data-open]"))?.focus();
  }

  // --- Editing ---

  function moveTo(index: number, position: number) {
    order = movePageTo(order, index, position);
    const target = Math.min(Math.max(Math.round(position) - 1, 0), order.length - 1);
    shown = Math.max(shown, target + 1);
    renderGrid();
    hooks.announce(fill(t.pageMoved, { position: target + 1 }));
    return target;
  }

  function rotatePages(pages: number[], step: 90 | -90) {
    for (const page of pages) rotations.set(page, (rotationOf(page) + step + 360) % 360);
    renderGrid();
  }

  // A PDF needs at least one page, so removing every page is refused.
  function removePages(pages: number[]) {
    if (pages.length >= order.length) {
      hooks.announce(t.lastPage);
      return false;
    }
    const first = order.findIndex((page) => pages.includes(page));
    order = order.filter((page) => !pages.includes(page));
    pages.forEach((page) => selected.delete(page));
    shown = Math.min(Math.max(shown, PREVIEW_BATCH), order.length);
    renderGrid();
    hooks.announce(fill(t.pagesRemoved, { count: order.length }));
    focusTile(first);
    return true;
  }

  grid.addEventListener("click", (event) => {
    const target = event.target as HTMLElement;
    const item = target.closest<HTMLLIElement>(".shell-page-item");
    if (!item) return;
    const index = Array.from(grid.children).indexOf(item);
    if (target.matches("[data-select]")) {
      const box = target as HTMLInputElement;
      // Shift-click selects every page between this one and the last one picked.
      if ((event as MouseEvent).shiftKey && anchor >= 0) {
        const [from, to] = [Math.min(anchor, index), Math.max(anchor, index)];
        order.slice(from, to + 1).forEach((page) => (box.checked ? selected.add(page) : selected.delete(page)));
      } else if (box.checked) selected.add(order[index]);
      else selected.delete(order[index]);
      anchor = index;
      renderGrid();
      box.focus();
      return;
    }
    if (target.closest("[data-open]")) openViewer(index);
  });

  // Alt with an arrow key moves the focused page, for anyone who can't drag.
  grid.addEventListener("keydown", (event) => {
    if (!editable || !event.altKey) return;
    const back = event.key === "ArrowLeft" || event.key === "ArrowUp";
    const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
    const item = (event.target as HTMLElement).closest<HTMLLIElement>(".shell-page-item");
    if ((!back && !forward) || !item) return;
    event.preventDefault();
    const step = back ? -1 : 1;
    const index = Array.from(grid.children).indexOf(item);
    const next = movePage(order, index, step);
    if (next === order) return;
    order = next;
    shown = Math.max(shown, index + step + 1);
    renderGrid();
    hooks.announce(fill(t.pageMoved, { position: index + step + 1 }));
    focusTile(index + step, (event.target as HTMLElement).matches("[data-open]") ? "[data-open]" : "[data-select]");
  });

  // Dragging is an extra for mouse users. Selecting and Move to do the same job for everyone.
  grid.addEventListener("dragstart", (event) => {
    const item = (event.target as HTMLElement).closest<HTMLLIElement>(".shell-page-item");
    if (!item || !editable) return;
    dragFrom = Array.from(grid.children).indexOf(item);
    event.dataTransfer?.setData("text/plain", String(dragFrom));
    item.classList.add("is-dragging");
  });
  grid.addEventListener("dragover", (event) => {
    if (dragFrom < 0) return;
    event.preventDefault();
    const item = (event.target as HTMLElement).closest<HTMLLIElement>(".shell-page-item");
    grid.querySelectorAll(".is-drop-target").forEach((tile) => tile.classList.remove("is-drop-target"));
    item?.classList.add("is-drop-target");
  });
  grid.addEventListener("drop", (event) => {
    if (dragFrom < 0) return;
    event.preventDefault();
    const item = (event.target as HTMLElement).closest<HTMLLIElement>(".shell-page-item");
    const to = item ? Array.from(grid.children).indexOf(item) : -1;
    if (to >= 0 && to !== dragFrom) moveTo(dragFrom, to + 1);
  });
  grid.addEventListener("dragend", () => {
    dragFrom = -1;
    grid.querySelectorAll(".is-dragging, .is-drop-target").forEach((tile) => {
      tile.classList.remove("is-dragging", "is-drop-target");
    });
  });

  more.addEventListener("click", () => {
    shown = Math.min(order.length, shown + PREVIEW_BATCH);
    renderGrid();
  });

  all.addEventListener("click", () => {
    shown = order.length;
    renderGrid();
    less.focus();
  });

  // Going back to the first batch shrinks the page, so focus and scroll follow the Show more button.
  less.addEventListener("click", () => {
    shown = Math.min(PREVIEW_BATCH, order.length);
    renderGrid();
    more.focus({ preventScroll: true });
    more.scrollIntoView({
      block: "center",
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
    });
  });

  el(root, "select-all").addEventListener("click", () => {
    order.forEach((page) => selected.add(page));
    shown = order.length;
    renderGrid();
    el(root, "rotate-selected").focus();
  });

  el(root, "rotate-all").addEventListener("click", () => {
    rotatePages(order, 90);
    hooks.announce(t.allRotated);
  });

  el(root, "rotate-selected").addEventListener("click", () => {
    rotatePages([...selected], 90);
    hooks.announce(plural(selected.size, t.rotatedOne, t.rotatedMany));
  });

  el(root, "move-selected").addEventListener("click", () => {
    const position = Number(movePosition.value);
    if (!movePosition.value || !Number.isFinite(position) || position < 1) return movePosition.focus();
    order = moveSelectedTo(order, selected, position);
    const target = order.findIndex((page) => selected.has(page));
    shown = Math.max(shown, target + selected.size);
    moveMenu.open = false;
    movePosition.value = "";
    renderGrid();
    hooks.announce(fill(t.selectionMoved, { count: selected.size, position: target + 1 }));
    focusTile(target);
  });
  movePosition.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    el(root, "move-selected").click();
  });
  moveMenu.addEventListener("toggle", () => {
    if (moveMenu.open) movePosition.focus();
  });

  el(root, "remove-selected").addEventListener("click", () => {
    removePages([...selected]);
  });

  el(root, "clear-selection").addEventListener("click", () => {
    selected.clear();
    anchor = -1;
    renderGrid();
    el(root, "select-all").focus();
  });

  pageSizeSelect.addEventListener("change", () => {
    pageSize = pageSizeSelect.value as PageSize;
    renderGrid();
  });

  // Menus close on Escape or a click elsewhere, like other menus on the page.
  for (const menu of [sizeMenu, moveMenu]) {
    menu.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !menu.open) return;
      event.stopPropagation();
      menu.open = false;
      menu.querySelector("summary")?.focus();
    });
  }
  document.addEventListener("click", (event) => {
    for (const menu of [sizeMenu, moveMenu]) {
      if (menu.open && !menu.contains(event.target as Node)) menu.open = false;
    }
  });

  undo.addEventListener("click", async () => {
    if (!preview) return;
    const confirmed = await hooks.confirm({ question: t.undoQuestion, yes: t.undoYes, no: t.undoNo, returnFocus: undo });
    if (!confirmed || !preview) return;
    rotations.clear();
    crops.clear();
    selected.clear();
    pageSize = "original";
    pageSizeSelect.value = "original";
    order = Array.from({ length: preview.pageCount }, (_, i) => i + 1);
    shown = Math.min(Math.max(shown, PREVIEW_BATCH), order.length);
    renderGrid();
    hooks.announce(t.changesUndone);
    root.querySelector<HTMLElement>('[data-el="downloads"] a')?.focus();
  });

  apply.addEventListener("click", async () => {
    if (!tool.rearrangeOutput || !file || applying) return;
    applying = true;
    const label = el(root, "apply-label");
    label.textContent = t.applying;
    apply.setAttribute("aria-busy", "true");
    try {
      const output = await tool.rearrangeOutput(file, plan(), {
        signal: new AbortController().signal,
        onProgress: () => {},
      });
      hooks.onApplied(output);
    } catch {
      hooks.announce(t.applyFailed);
    } finally {
      applying = false;
      el(root, "apply-label").textContent = t.apply;
      apply.removeAttribute("aria-busy");
    }
  });

  // --- Larger view: zoom and crop ---

  const ZOOM_LEVELS = [1, 1.5, 2, 3, 4];
  const MIN_CROP = 0.05;
  let zoom = 1;
  let zoomTimer = 0;
  let pageAspect = 0.75;
  let pageTurn = 0;
  let cropping = false;
  let cropBox: CropRect = { x: 0, y: 0, width: 1, height: 1 };
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

  // Sizes the page to fit the view at 100%, or larger when zoomed, and returns its width in CSS pixels.
  function layoutViewer() {
    const area = viewerScroll.getBoundingClientRect();
    const fitWidth = Math.max(40, Math.min(area.width - 32, (area.height - 32) * pageAspect));
    const width = fitWidth * zoom;
    viewerCanvas.style.width = `${width}px`;
    viewerCanvas.style.height = `${width / pageAspect}px`;
    viewer.classList.toggle("is-zoomed", zoom > 1);
    zoomLevel.textContent = `${Math.round(zoom * 100)}%`;
    zoomOut.disabled = zoom <= ZOOM_LEVELS[0] || cropping;
    zoomIn.disabled = zoom >= ZOOM_LEVELS[ZOOM_LEVELS.length - 1] || cropping;
    zoomFit.disabled = zoom === 1 || cropping;
    return width;
  }

  async function renderViewerImage() {
    const current = preview;
    if (!current) return;
    const page = order[viewerIndex];
    const run = ++viewerToken;
    const scale = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.round(layoutViewer() * scale);
    try {
      const result = await current.renderPage(page, width, rotationOf(page), cropping ? undefined : crops.get(page));
      if (run !== viewerToken) return;
      if (viewerImage.src) URL.revokeObjectURL(viewerImage.src);
      viewerImage.src = URL.createObjectURL(result.blob);
      pageAspect = result.width / result.height;
      pageTurn = result.turn;
      layoutViewer();
    } catch {
      // The thumbnail is still there to look at, so a failed large render needs no message.
    }
  }

  // On phones, Move opens the position box above the tools.
  const moveToggle = el<HTMLButtonElement>(root, "viewer-move-toggle");
  function setMoveOpen(open: boolean) {
    viewerEdit.toggleAttribute("data-move-open", open);
    moveToggle.setAttribute("aria-expanded", String(open));
    // The tools grow or shrink, so the page is fitted to the new space.
    if (viewer.open) layoutViewer();
  }
  moveToggle.addEventListener("click", () => {
    const open = !viewerEdit.hasAttribute("data-move-open");
    setMoveOpen(open);
    if (open) viewerPosition.focus();
  });

  async function showViewerPage(index: number) {
    if (!preview) return;
    if (cropping) endCrop();
    setMoveOpen(false);
    viewerIndex = index;
    zoom = 1;
    viewerTitle.textContent = fill(t.pageOf, { page: index + 1, total: order.length });
    viewerPosition.value = String(index + 1);
    viewerPosition.max = String(order.length);
    viewerPrev.disabled = index <= 0;
    viewerNext.disabled = index >= order.length - 1;
    // A disabled button drops keyboard focus, so hand it to the button that still works.
    if (viewerPrev.disabled && document.activeElement === viewerPrev) viewerNext.focus();
    if (viewerNext.disabled && document.activeElement === viewerNext) viewerPrev.focus();
    await renderViewerImage();
  }

  // Zooms around the middle of what's in view, then redraws the page sharply at the new size.
  function setZoom(next: number) {
    if (cropping) return;
    const target = clamp(next, ZOOM_LEVELS[0], ZOOM_LEVELS[ZOOM_LEVELS.length - 1]);
    const centreX = (viewerScroll.scrollLeft + viewerScroll.clientWidth / 2) / Math.max(viewerScroll.scrollWidth, 1);
    const centreY = (viewerScroll.scrollTop + viewerScroll.clientHeight / 2) / Math.max(viewerScroll.scrollHeight, 1);
    zoom = target;
    layoutViewer();
    viewerScroll.scrollLeft = centreX * viewerScroll.scrollWidth - viewerScroll.clientWidth / 2;
    viewerScroll.scrollTop = centreY * viewerScroll.scrollHeight - viewerScroll.clientHeight / 2;
    hooks.announce(fill(t.zoomedTo, { percent: Math.round(zoom * 100) }));
    window.clearTimeout(zoomTimer);
    zoomTimer = window.setTimeout(() => void renderViewerImage(), 150);
  }

  const zoomStep = (direction: 1 | -1) => {
    const index = ZOOM_LEVELS.findIndex((level) => level >= zoom - 0.001);
    setZoom(ZOOM_LEVELS[clamp(index + direction, 0, ZOOM_LEVELS.length - 1)]);
  };

  zoomIn.addEventListener("click", () => zoomStep(1));
  zoomOut.addEventListener("click", () => zoomStep(-1));
  zoomFit.addEventListener("click", () => setZoom(1));

  // Dragging a zoomed page moves around it, like a map.
  let pan: { x: number; y: number; left: number; top: number } | null = null;
  viewerScroll.addEventListener("pointerdown", (event) => {
    if (zoom <= 1 || cropping || event.button > 0) return;
    viewerScroll.setPointerCapture(event.pointerId);
    pan = { x: event.clientX, y: event.clientY, left: viewerScroll.scrollLeft, top: viewerScroll.scrollTop };
  });
  viewerScroll.addEventListener("pointermove", (event) => {
    if (!pan) return;
    viewerScroll.scrollLeft = pan.left - (event.clientX - pan.x);
    viewerScroll.scrollTop = pan.top - (event.clientY - pan.y);
  });
  viewerScroll.addEventListener("pointerup", () => (pan = null));
  viewerScroll.addEventListener("pointercancel", () => (pan = null));

  // On a touch screen, a sideways swipe on an unzoomed page turns to the next or previous page.
  const SWIPE_DISTANCE = 60;
  let swipe: { x: number; y: number } | null = null;
  viewerScroll.addEventListener("pointerdown", (event) => {
    swipe = event.pointerType === "touch" && zoom <= 1 && !cropping ? { x: event.clientX, y: event.clientY } : null;
  });
  viewerScroll.addEventListener("pointerup", (event) => {
    if (!swipe) return;
    const dx = event.clientX - swipe.x;
    const dy = event.clientY - swipe.y;
    swipe = null;
    if (Math.abs(dx) < SWIPE_DISTANCE || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    if (dx < 0 && viewerIndex < order.length - 1) void showViewerPage(viewerIndex + 1);
    if (dx > 0 && viewerIndex > 0) void showViewerPage(viewerIndex - 1);
  });
  viewerScroll.addEventListener("pointercancel", () => (swipe = null));

  function drawCropBox() {
    cropBoxEl.style.left = `${cropBox.x * 100}%`;
    cropBoxEl.style.top = `${cropBox.y * 100}%`;
    cropBoxEl.style.width = `${cropBox.width * 100}%`;
    cropBoxEl.style.height = `${cropBox.height * 100}%`;
  }

  async function startCrop() {
    const page = order[viewerIndex];
    cropping = true;
    zoom = 1;
    viewer.classList.add("is-cropping");
    viewerEdit.hidden = true;
    cropTools.hidden = false;
    cropReset.hidden = !crops.has(page);
    // The box appears and takes focus at once, so keys work straight away. The whole page is redrawn behind it.
    const existing = crops.get(page);
    cropBox = existing ? toScreen(existing, pageTurn) : { x: 0.05, y: 0.05, width: 0.9, height: 0.9 };
    drawCropBox();
    cropBoxEl.hidden = false;
    cropBoxEl.focus();
    await renderViewerImage();
  }

  function endCrop() {
    cropping = false;
    viewer.classList.remove("is-cropping");
    cropBoxEl.hidden = true;
    cropTools.hidden = true;
    viewerEdit.hidden = !editable;
  }

  function finishCrop(message: string) {
    endCrop();
    renderGrid();
    hooks.announce(fill(message, { page: viewerIndex + 1 }));
    void renderViewerImage();
    cropButton.focus();
  }

  cropButton.addEventListener("click", () => void startCrop());
  el(root, "crop-apply").addEventListener("click", () => {
    const page = order[viewerIndex];
    const crop = fromScreen(cropBox, pageTurn);
    if (isFullPage(crop)) crops.delete(page);
    else crops.set(page, crop);
    finishCrop(crops.has(page) ? t.pageCropped : t.cropRemoved);
  });
  el(root, "crop-cancel").addEventListener("click", () => {
    endCrop();
    void renderViewerImage();
    cropButton.focus();
  });
  cropReset.addEventListener("click", () => {
    crops.delete(order[viewerIndex]);
    finishCrop(t.cropRemoved);
  });

  // The crop box moves when dragged, and its corners resize it. Arrow keys do the same for keyboard users.
  let cropDrag: { handle: string; x: number; y: number; start: CropRect } | null = null;
  cropBoxEl.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    cropBoxEl.setPointerCapture(event.pointerId);
    const handle = (event.target as HTMLElement).dataset.handle ?? "move";
    cropDrag = { handle, x: event.clientX, y: event.clientY, start: { ...cropBox } };
  });
  cropBoxEl.addEventListener("pointermove", (event) => {
    if (!cropDrag) return;
    const area = viewerCanvas.getBoundingClientRect();
    const dx = (event.clientX - cropDrag.x) / area.width;
    const dy = (event.clientY - cropDrag.y) / area.height;
    const { handle, start } = cropDrag;
    const right = start.x + start.width;
    const bottom = start.y + start.height;
    let { x, y, width, height } = start;
    if (handle === "move") {
      x = clamp(start.x + dx, 0, 1 - width);
      y = clamp(start.y + dy, 0, 1 - height);
    } else {
      if (handle.includes("w")) {
        x = clamp(start.x + dx, 0, right - MIN_CROP);
        width = right - x;
      }
      if (handle.includes("e")) width = clamp(start.width + dx, MIN_CROP, 1 - start.x);
      if (handle.includes("n")) {
        y = clamp(start.y + dy, 0, bottom - MIN_CROP);
        height = bottom - y;
      }
      if (handle.includes("s")) height = clamp(start.height + dy, MIN_CROP, 1 - start.y);
    }
    cropBox = { x, y, width, height };
    drawCropBox();
  });
  cropBoxEl.addEventListener("pointerup", () => (cropDrag = null));
  cropBoxEl.addEventListener("pointercancel", () => (cropDrag = null));
  cropBoxEl.addEventListener("keydown", (event) => {
    const step = 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    if (event.key === "Enter") {
      event.preventDefault();
      el(root, "crop-apply").click();
      return;
    }
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    const [dx, dy] = move;
    if (event.shiftKey) {
      cropBox.width = clamp(cropBox.width + dx, MIN_CROP, 1 - cropBox.x);
      cropBox.height = clamp(cropBox.height + dy, MIN_CROP, 1 - cropBox.y);
    } else {
      cropBox.x = clamp(cropBox.x + dx, 0, 1 - cropBox.width);
      cropBox.y = clamp(cropBox.y + dy, 0, 1 - cropBox.height);
    }
    drawCropBox();
  });

  function openViewer(index: number) {
    viewer.showModal();
    void showViewerPage(index);
  }

  function rotateInViewer(step: 90 | -90) {
    const page = order[viewerIndex];
    rotatePages([page], step);
    hooks.announce(fill(t.pageRotated, { page: viewerIndex + 1, angle: rotationOf(page) }));
    void showViewerPage(viewerIndex);
  }

  viewerPrev.addEventListener("click", () => void showViewerPage(viewerIndex - 1));
  viewerNext.addEventListener("click", () => void showViewerPage(viewerIndex + 1));
  el(root, "viewer-close").addEventListener("click", () => viewer.close());
  el(root, "viewer-move").addEventListener("click", () => {
    const position = Number(viewerPosition.value);
    if (!Number.isFinite(position) || position < 1) return;
    void showViewerPage(moveTo(viewerIndex, position));
  });
  viewerPosition.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    el(root, "viewer-move").click();
  });
  el(root, "viewer-rotate-left").addEventListener("click", () => rotateInViewer(-90));
  el(root, "viewer-rotate-right").addEventListener("click", () => rotateInViewer(90));
  el(root, "viewer-remove").addEventListener("click", () => {
    if (removePages([order[viewerIndex]])) void showViewerPage(Math.min(viewerIndex, order.length - 1));
  });
  document.addEventListener("keydown", (event) => {
    if (!viewer.open || cropping || (event.target as HTMLElement).closest("input")) return;
    if (event.key === "ArrowLeft" && viewerIndex > 0) void showViewerPage(viewerIndex - 1);
    if (event.key === "ArrowRight" && viewerIndex < order.length - 1) void showViewerPage(viewerIndex + 1);
    if (event.key === "+" || event.key === "=") zoomStep(1);
    if (event.key === "-") zoomStep(-1);
    if (event.key === "0") setZoom(1);
  });
  window.addEventListener("resize", () => {
    if (viewer.open) layoutViewer();
  });
  viewer.addEventListener("click", (event) => {
    if (event.target === viewer) viewer.close();
  });
  // Escape while cropping cancels the crop instead of closing the view.
  viewer.addEventListener("cancel", (event) => {
    if (!cropping) return;
    event.preventDefault();
    el(root, "crop-cancel").click();
  });
  viewer.addEventListener("close", () => {
    viewerToken++;
    if (cropping) endCrop();
    shown = Math.max(shown, viewerIndex + 1);
    renderGrid();
    focusTile(viewerIndex, "[data-open]");
  });

  return {
    async load(result: { name: string; blob: Blob }) {
      const run = ++token;
      try {
        const opened = await tool.previewOutput?.(result.blob);
        if (!opened) return;
        if (run !== token) return opened.close();
        preview = opened;
        file = result;
        order = Array.from({ length: opened.pageCount }, (_, i) => i + 1);
        shown = Math.min(PREVIEW_BATCH, order.length);
        section.hidden = false;
        renderGrid();
      } catch {
        if (run === token) hooks.announce(t.previewFailed);
      }
    },

    close() {
      token++;
      preview?.close();
      preview = null;
      file = null;
      order = [];
      shown = 0;
      anchor = -1;
      tiles.clear();
      selected.clear();
      rotations.clear();
      crops.clear();
      viewer.classList.remove("is-cropping", "is-zoomed");
      pageSize = "original";
      pageSizeSelect.value = "original";
      images.forEach(({ url }) => URL.revokeObjectURL(url));
      images.clear();
      if (viewerImage.src) URL.revokeObjectURL(viewerImage.src);
      viewerImage.removeAttribute("src");
      grid.replaceChildren();
      section.hidden = true;
      if (viewer.open) viewer.close();
      hooks.onChange(false);
    },
  };
}
