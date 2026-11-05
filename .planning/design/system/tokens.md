# AnyTools.fyi design tokens

Status: approved. CSS source: `src/styles/tokens.css`.

## Colors
| Role | Token | Light | Dark | Measured contrast (light / dark) |
|------|-------|-------|------|------------------|
| Page | --color-bg | #F6F7F4 | #0E1714 | n/a |
| Card | --color-surface | #FFFFFF | #16211D | n/a |
| Text | --color-text | #14231E | #EAF1EE | 15.15 on page / 15.91 on page |
| Muted text | --color-text-muted | #52615B | #A3B2AC | 6.07 on page / 7.50 on card |
| Control border | --color-border | #8A9791 | #66756F | 3.04 on card / 3.42 on card |
| Card border (decorative) | --color-border-subtle | #D5DBD7 | #33423C | n/a |
| Accent | --color-accent | #0A6B52 | #4FD1A5 | 6.03 on page / 9.55 on page |
| Error text | --color-danger | #B42318 | #FF9B8F | 6.11 on page / 8.14 on card |
| Warning text | --color-warning | #8A5300 | #F2B654 | 5.89 on page / 9.13 on card |
| Text on accent | --color-on-accent | #FFFFFF | #07241B | 6.49 / 8.61 |

Category tiles use white icons in both themes: PDF #C2412D (5.14), Image #2563C9 (5.67), Bangla #0A6B52 (6.49), Developer #6D4AC7 (6.08), Text #A85F00 (4.88), Calculators #0E7490 (5.36).

## Typography
System font stack, with Bangla falling back to the device's Bangla font. Headings 700, body 400, body at least 16px.

## Spacing
Base 8px, with a 4px half-step: xs 4 / sm 8 / md 16 / lg 24 / xl 32 / 2xl 48.

## Radius
Card 16px, button 12px, pill 999px.

## Shadows
None by default. Cards use a 1px border, so nothing depends on costly shadows on low-end phones.

## Motion
CSS only, no animation library. Animate transform and opacity only. Durations 120 / 180 / 280ms. Everything reduces to no movement under prefers-reduced-motion. Content is never hidden until scrolled into view. Decorative movement stops within 5 seconds, per WCAG 2.2.2.

## Illustrations
Original inline or same-origin SVG, flat fills from these tokens, each file 4 KB or less, with width and height set. Never the page's largest text or a replacement for text. Decorative ones use empty alt or aria-hidden.
