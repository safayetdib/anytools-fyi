# Spec: app-style design on phones

Status: approved by the owner on 2026-11-06 (mockups in chat).

## Goal
Most visitors will use a phone. Below 600px wide, the site should feel like a modern mobile app,
not a shrunk desktop page. Tablet and desktop keep the current design.

## Scope (phones only, `max-width: 599px`)

### 1. App shell
- Slim top bar, 56px: logo on the left, search and menu as plain icon buttons (no boxes).
- Bottom tab bar, fixed, with safe-area padding: Home, Tools, Search, Theme.
  - Current page's tab is marked with `aria-current="page"`.
  - Search opens the header search and focuses it.
  - Hidden while a task is in progress (files chosen), so the tool's own bar owns the bottom.
- The footer stays, with space below it for the tab bar.

### 2. Tool page, before files are chosen
- Breadcrumbs hidden. The title row is compact: a 40px icon, title at about 24px, a one-line lead.
- The drop zone is a solid card: icon, "Select PDF files", the limits line. "or drop files here" is hidden (no dragging on phones).
- The privacy line becomes a small chip.
- Guide sections (limits, steps, how it works, tips, privacy, questions) fold. Each heading becomes a
  button with `aria-expanded`; all start closed. Wider screens keep them open with no button.

### 3. Arranging files
- Step bar: Select, Arrange, Done, as three segments with a text label for screen readers.
- File rows are one line: grip, 32x40 thumbnail, name (ellipsis), meta, and a "More" button.
  - "More" opens a bottom sheet: Move up, Move down, Remove. Disabled moves are left out.
  - Holding and dragging the grip still reorders.
  - The arrow and remove buttons are hidden on phones (the sheet replaces them).
- The action bar is docked: full width at the bottom, safe-area padding, no floating card.

### 4. Result
- The success block is compact. The Download button sits in the docked bar.
- Page grid has 3 columns.
- The page toolbar becomes a docked icon bar (icon above label) while pages are selected.

### 5. Page view
- Full screen, edge to edge, dark backdrop in both themes.
- Top bar: close, "Page N of M", zoom buttons.
- Swipe left or right to change page when not zoomed in and not cropping.
- One row of icon buttons: Rotate, Crop, Move, Remove. Rotate left stays available in the row as well.
- Move opens a bottom sheet with the position box.

## Not in scope
- Pinch zoom with two fingers (buttons and double-tap stay).
- Any change to tablet or desktop layouts.

## Acceptance
- At 375x812 and 360x740: no horizontal scroll, every control at least 44px, axe clean in light and dark.
- The Merge PDF journey works end to end with touch on a phone viewport.
- Existing desktop tests still pass.
