# Free Browser Tools Platform: Build Blueprint

Nov 5, 2026 · @Safayet Alam

## Purpose and goals

The platform is a free website of everyday tools that run fully inside the visitor's browser, with no signup, no file uploads and no watermarks.

**Who it is for.** People who need a quick job done on a phone or laptop: compressing a photo for a form, merging PDFs, formatting JSON, converting a date. There are two audiences: English speakers worldwide, and Bangla speakers in Bangladesh and abroad.

**What makes it different.** Files never leave the device, pages load fast on low-end phones, and the site works for everyone, including people who use screen readers or only a keyboard.

**Targets for the first 12 months**

| Area | Target |
| --- | --- |
| Tools | 20 live at launch, 50 by month 6 |
| Speed | Mobile Lighthouse performance 95+ and Core Web Vitals rated "good" on every page |
| Accessibility | WCAG 2.2 AA on every page, zero critical axe issues |
| Traffic | 10,000 to 20,000 monthly visits by month 12 |
| AI visibility | Cited in AI answers for at least 5 tracked prompts by month 9 |

**Non-goals.** No accounts or login. No server-side file processing. No mass-produced near-duplicate pages. No pop-ups, interstitials or auto-playing media.

## Core principles

Six rules decide every build choice. When two options conflict, the one higher on this list wins.

| Principle | Rule | How it is enforced |
| --- | --- | --- |
| Privacy by design | Tool code never sends user files or text to any server | A lint rule bans fetch, XMLHttpRequest, sendBeacon and WebSocket inside tool modules, plus code review |
| Fast by default | Ship the minimum: static HTML, tiny JavaScript, heavy libraries loaded only on demand | Performance budget checked in CI (see Performance budget) |
| Accessible to all | Every page meets WCAG 2.2 AA | Automated axe checks in CI plus manual keyboard and screen reader tests |
| Answer first | Each page puts the working tool and a one-line answer in the first screen | The tool page template (see Tool page template) |
| Honest claims | Say only what is true and can be checked by the visitor | Wording review against Privacy, trust and legal pages |
| Boring technology | Prefer standard browser APIs over frameworks and plugins | Every new dependency needs a reason and a size check |

## Tech stack and architecture

The site is pre-rendered static HTML on a CDN, and each tool is a small script that runs in the visitor's browser with no server involved.

&#91;embedded content: architecture · 2 zones, 6 parts\]

Visitors download the page and the tool's code once. After that, every file stays in the browser, and a Web Worker does the heavy work with libraries served from the same site.

**Stack**

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | Astro with TypeScript | Static HTML by default, JavaScript only where a tool needs it, built-in routing for /bn/ |
| Tool UI | Vanilla TypeScript, or Preact for complex tools, loaded as an island | Small bundles, no framework cost on simple tools |
| Styling | Plain CSS with custom properties, or Tailwind with unused styles removed | Small CSS, easy light and dark themes |
| Heavy processing | Web Workers plus WASM libraries, loaded on demand | Keeps the page responsive |
| Content | One Markdown file per tool for intro, steps, FAQ and metadata | Text can be edited without touching code |
| Hosting | Cloudflare Pages (free tier) or similar static hosting | Global CDN, with custom headers for caching, security and cross-origin isolation |
| Quality checks | GitHub Actions running lint, Vitest, Playwright, axe and Lighthouse CI | Budgets and accessibility are enforced on every change |

**Folder structure**

```
/src
  /pages           routes for English and for /bn/
  /content/tools   one Markdown file per tool: title, description, steps, FAQ, related tools
  /tools           one folder per tool: ui.ts, worker.ts, sample files, tests
  /components      header, footer, ad slot, tool shell
  /lib             file reading, downloads, live region announcer
  /i18n            en.json and bn.json strings
/public            robots.txt, llms.txt, static images
```

**Tool module contract**

- Each tool lives in its own folder with a UI module, an optional worker, sample test files and tests.
- A shared tool shell component provides the label, file input, drop zone, progress bar, result, download button, error message and live region. Every tool gets the same accessibility and behavior from it.
- Tool code makes no network requests. Libraries and models are bundled and self-hosted.
- One page template generates each page from the tool's Markdown file and its module.
- Adding a tool means adding a folder and a content file, with no routing changes.

The multi-threaded build of ffmpeg.wasm needs the COOP and COEP headers, which static hosts such as Cloudflare Pages let you set in a headers file. The single-threaded build does not need them.

## Performance budget

Every page must pass Core Web Vitals on a mid-range Android phone over slow 4G, and the budget below is enforced automatically on every change.

**Targets**

| Metric | Must pass | Aim for |
| --- | --- | --- |
| Largest Contentful Paint (LCP) | 2.5 s or less | 1.8 s |
| Interaction to Next Paint (INP) | 200 ms or less | 100 ms |
| Cumulative Layout Shift (CLS) | 0.1 or less | 0 |
| Time to First Byte (TTFB) | 0.8 s or less | 0.3 s |
| Lighthouse mobile performance | 95 or more | 98 |

**Weight limits for the first load** (compressed, excluding ads and on-demand libraries)

| Asset | Limit |
| --- | --- |
| HTML | 30 KB |
| CSS | 20 KB |
| JavaScript | 50 KB |
| Total | 150 KB |

**Rules that keep the budget**

- Content is static HTML. Nothing the visitor or a crawler needs to read is rendered by JavaScript.
- Heavy libraries (pdf-lib, pdf.js, ffmpeg.wasm, model files) load only after the visitor picks a file or presses the tool's main button. Prefetch them on hover or focus of the main button.
- All heavy processing runs in a Web Worker so the page stays responsive. Pass large buffers as transferable objects instead of copying them.
- Use the system font stack by default. If a custom font is needed, use one self-hosted variable WOFF2 subset with font-display: swap. Check Bangla text renders well on Android and iOS defaults before adding a Bangla font.
- Icons are inline SVG. Images are AVIF or WebP with width and height set. No decorative raster hero images. Small original SVG illustrations are allowed at 4 KB or less each, with width and height set, and must never be the page's largest element.
- Hashed asset files get a one-year immutable cache. HTML gets a short cache. Serve Brotli.
- Ads and analytics load after the first interaction or when the browser is idle. Measure the budget with them switched on. If an ad script breaks the budget, remove an ad slot rather than relaxing the budget.
- Large files: show a size warning before processing, catch out-of-memory errors, and tell the visitor what to do instead of freezing.

**Enforcement.** Run Lighthouse CI on the homepage, a category page and three tool pages on every pull request, and fail the build when a target or weight limit is missed. After launch, watch real-user data in Search Console's Core Web Vitals report.

## Accessibility standards

Every page meets WCAG 2.2 Level AA, so the tools can be used with a keyboard, a screen reader, a zoomed screen or a phone.

**Structure**

- Use semantic HTML: one h1 per page, headings in order, and landmarks (header, nav, main, footer).
- Set the lang attribute on the page (en or bn) and mark any inline language change.
- The first focusable element is a "Skip to tool" link.
- Every page has a unique, descriptive title.

**Inputs and controls**

- Every field has a visible label connected with for and id. A placeholder is never the label.
- Use real button and a elements. Do not build buttons from divs.
- File upload uses a native file input. Drag and drop is an extra, never the only way (WCAG 2.5.7).
- Touch and click targets are at least 24 by 24 CSS pixels (WCAG 2.5.8). Aim for 44 by 44.
- Errors are written in text, linked to the field with aria-describedby, say how to fix the problem, and never rely on color alone. Never clear what the visitor typed.

**Results and feedback**

- Announce progress and results in an aria-live="polite" region, for example "Done. 3 files merged, 2.1 MB."
- Long tasks show a labelled progress bar and a Cancel button.
- The download control names the file and its size.

**Visual**

- Contrast of at least 4.5:1 for normal text and 3:1 for large text, input borders and focus outlines.
- A clear focus outline (2 px or more) on every interactive element. Sticky headers, cookie banners and ads must never cover the focused element (WCAG 2.4.11).
- The layout reflows at 320 CSS pixels wide with no sideways scrolling, works at 200% zoom, and survives user text spacing changes.
- Never block pinch zoom. Do not use maximum-scale or user-scalable=no.
- Respect prefers-reduced-motion and prefers-color-scheme (light and dark themes).
- Put the contact link in the same place on every page (WCAG 3.2.6).

**Ads**

- Label every ad slot "Advertisement". No auto-playing sound or video, no ad inside the tool's input or output area, and no ad that traps keyboard focus.

**Testing**

- Automated: run axe-core through Playwright on the homepage, a category page and every tool template in CI. Automated tools find only part of the problems, so they are a floor and not proof.
- Manual, before each new tool ships: complete the whole task with the keyboard only, at 200% zoom, and in dark mode.
- Screen readers: NVDA on Windows, VoiceOver on iPhone, TalkBack on Android. Run each on the five most used tools at least.
- Publish an accessibility statement page with a contact address for reports, and fix reported issues first.

## Responsive design and UX

Design for a 360 px wide Android phone first, then add enhancements for larger screens.

**Layout**

- Write mobile first CSS with min-width media queries. Breakpoints: 600 px, 900 px and 1200 px.
- Use container queries when a tool panel's layout depends on its own width.
- Fluid type with clamp(). Body text is 16 px or larger, with lines of 60 to 75 characters.
- On phones a tool is one column: input, options, main button, result. From 900 px wide, show input and result side by side when the tool benefits.
- One primary action per screen, full width on mobile and within thumb reach.
- No hover-only interactions and no sideways page scroll. Wide tables sit in a scrollable container with a visible cue.

**Mobile friendly inputs**

- Use native controls so phones show the right keyboard: input type, inputmode, accept on file inputs, and autocomplete where it applies.
- Set per-tool file size limits and test them on a phone with about 3 GB of RAM.
- Respect the Save-Data hint by skipping prefetching when it is on.

**Finding tools quickly**

- A simple top bar with the logo, a category menu and a search box.
- Search runs in the browser against a small JSON index that loads when the search box is focused.
- Every tool page links to related tools, and the homepage lists the most used tools first.

**Optional, after launch**

- Make the site installable and usable offline after the first visit, with a service worker that caches the tool and its libraries. Keep this out of the first release to avoid caching bugs.

**Device test matrix**

| Device | Browser | Condition |
| --- | --- | --- |
| Low-end Android phone | Chrome | Real device, mobile data |
| Recent iPhone | Safari | Real device |
| Tablet | Safari or Chrome | Portrait and landscape |
| Laptop | Chrome, Firefox, Safari, Edge | Latest versions |
| Any | Chrome DevTools | Slow 4G and 4x CPU slowdown |

## Site structure and URL design

Tool pages sit at short, flat URLs and are grouped into six category hubs, so every tool is two clicks from the homepage.

&#91;embedded content: site structure · 1 homepage, 6 hubs\]

Tool URLs stay flat and short, while the breadcrumb on each page still shows Home, category, tool. The Bangla site mirrors the English one under /bn/.

**URL rules**

- Tool pages sit at the top level with short, keyword-first slugs such as /merge-pdf/ and /compress-image/. The breadcrumb still shows Home, category, tool.
- Variant pages get their own slug, for example /compress-image-to-20kb/.
- Category hubs: /pdf-tools/, /image-tools/, /developer-tools/, /text-tools/, /calculators/ and /bangla-tools/.
- Guides live under /guides/.
- Bangla pages mirror the English ones under /bn/ with the same slug.
- Lowercase letters and hyphens only. No underscores, dates, IDs or query strings on content pages.
- Never change a published URL. If one must move, use a single 301 redirect.

**Internal linking rules**

- The homepage links to every live hub and to every tool, with the most used tools first. All links are in the static HTML.
- Category filter pills are real links to the hubs, so they work without JavaScript and crawlers can follow them.
- Each hub lists all of its tools with a one-line description.
- Each tool links to four to six related tools and, through the breadcrumb, to its hub.
- Guides link to the tools they mention, and those tools link back to the guide.

**Launch route map**

| Hub | Tools |
| --- | --- |
| /pdf-tools/ | /merge-pdf/, /split-pdf/, /jpg-to-pdf/, /pdf-to-jpg/ |
| /image-tools/ | /compress-image/, /compress-image-to-20kb/, /compress-image-to-50kb/, /compress-image-to-100kb/, /resize-image/, /convert-image/, /heic-to-jpg/, /remove-image-metadata/, /photo-signature-resizer/, /qr-code-generator/ |
| /bangla-tools/ | /bijoy-to-unicode/, /number-to-bangla-words/, /bangla-date-converter/. Also lists /word-counter/ and /photo-signature-resizer/ |
| /developer-tools/ | /json-formatter/, /base64-encode-decode/, /password-generator/ |
| No hub yet | /word-counter/, /age-calculator/ |

Other routes: /tools/ (every tool, grouped by category), /guides/, /about/, /contact/, /privacy/, /terms/, /cookies/, /accessibility/, /how-we-protect-your-privacy/ and /credits/.

**Route rules**

- A hub goes live once it has at least three tools of its own, so no hub is a thin page. /text-tools/ and /calculators/ wait for Phase 2. Until then, /word-counter/ and /age-calculator/ use the breadcrumb Home, tool, and appear on the homepage and /tools/.
- Each tool has one primary hub, used for its breadcrumb. Other hubs may also list it, but it keeps one URL.
- Check every slug against keyword data before publishing, because published URLs do not change.
- Add a separate format page such as /png-to-pdf/ only when Search Console shows real demand and the page can serve a distinct need.

**One source for routes**

- Keep one tool registry with each tool's slug, primary hub, also-listed hubs, related tools and search aliases, including Bangla and Roman-letter terms.
- Generate pages, hub lists, breadcrumbs, the sitemap, the search index, JSON-LD and llms.txt from it, so they cannot drift apart.
- A test fails the build if a slug is duplicated or badly formed, a related tool does not exist, or a tool has fewer than four related tools.

## Tool page template

Every tool page uses one template: the working tool appears in the first screen, and enough real text sits below it for search engines and AI assistants to understand and quote the page.

**Page blocks, top to bottom**

1. Breadcrumb: Home, category, tool.
2. H1: the tool's name in plain words, for example "Merge PDF Files".
3. A one or two sentence answer under the H1 that says what the tool does, that it is free, and that it runs in the browser. Keep it under 40 words.
4. The tool itself, with its input visible without scrolling on a phone.
5. Trust line: "Your files stay on your device. Nothing is uploaded." with a link to the privacy explanation.
6. Limits and notes: supported formats, maximum file size, supported browsers.
7. How to use: three to five numbered steps.
8. Short explainer of 150 to 300 words on when to use the tool and what to watch for. Write it from real knowledge of the task, not filler.
9. FAQ with four to six real questions and short answers. Always include "Does this upload my file?" and "Does it work offline?"
10. Related tools: four to six links with descriptive anchor text.
11. Footer line: last updated date.

**Metadata rules**

| Element | Rule | Example for a PDF merger |
| --- | --- | --- |
| URL | Lowercase, hyphens, keyword first, no dates | /merge-pdf/ |
| Title tag | 60 characters or fewer, main keyword first | Merge PDF Online Free, No Upload \| \[Site name\] |
| Meta description | 155 characters or fewer, states the benefit | Combine PDF files in your browser. Free, no signup, and your files never leave your device. |
| H1 | One per page, matches the search intent | Merge PDF Files |
| Social image | Static, small, one design per category | /og/pdf-tools.png |

**Quality rules**

- Each page must be useful on its own. Variant pages such as "compress image to 20KB" need their own intro, preset, examples and FAQ, not a copy of the base page with a changed heading.
- Write the Bangla version natively. Do not machine translate it.
- Do not publish a tool page until it passes the accessibility and performance checks.

## Technical SEO checklist

The site is pre-rendered static HTML, so most technical SEO is getting the basics exactly right and checking them before launch.

**Crawling and indexing**

- [ ] HTTPS everywhere with HSTS. Pick one host (www or non-www), redirect the other with a 301, and keep trailing slashes consistent.
- [ ] robots.txt allows all public pages and lists the sitemap. Check that production builds contain no stray noindex tags.
- [ ] XML sitemap lists every indexable URL. Set lastmod only when the content really changes.
- [ ] Every page has a self-referencing canonical URL.
- [ ] A custom 404 page returns a real 404 status and offers search and popular tools. Moved pages get a single 301, with no redirect chains.
- [ ] Verify the site in Google Search Console (domain property through DNS) and Bing Webmaster Tools, and submit the sitemap to both.
- [ ] Ping IndexNow when a page is published or changed. It covers Bing and some other engines, but not Google.

**On-page**

- [ ] Unique title and meta description on every page. One H1. Headings written as the real questions people ask.
- [ ] Internal links: homepage to categories to tools, breadcrumbs, and related tools. Every page is reachable within three clicks and no page is an orphan.
- [ ] Open Graph and Twitter card tags on every page.
- [ ] Alt text on informative images. Decorative images have empty alt.
- [ ] One URL per tool. No duplicate pages competing for the same search.

**Bangla and English**

- [ ] Bangla pages live under /bn/ and use the same slug as the English page.
- [ ] Add hreflang tags: each page references itself and its translation, plus x-default for the English page. The references must be reciprocal.
- [ ] Never redirect visitors by IP address or browser language. Offer a visible language switcher instead.
- [ ] Research Bangla keywords in Bangla script and in Roman letters, and write titles the way people actually search.

**Rendering and experience**

- [ ] Open view source on a tool page and confirm the main text is in the HTML. Confirm again with the URL Inspection live test in Search Console.
- [ ] Mobile and desktop show the same content, because Google indexes the mobile version.
- [ ] Core Web Vitals pass on all templates.
- [ ] No pop-ups or interstitials that cover content.

**Spam policy guardrail.** Do not publish large numbers of thin, near-duplicate pages. Google's spam policies target scaled content that adds little value, so add a page only when it helps someone with a distinct need.

## Structured data

Use JSON-LD on every page with a small set of schema types that describe the site accurately, and never mark up anything that is not visible on the page or not true.

| Page type | Schema types | Notes |
| --- | --- | --- |
| Homepage | WebSite, Organization | Organization includes name, url, logo and sameAs links to real profiles |
| Category page | CollectionPage, BreadcrumbList | List the tools in the category |
| Tool page | WebApplication, BreadcrumbList, FAQPage (optional) | See the example below |
| Guide or article | Article | headline, datePublished, dateModified and a named author |
| About page | AboutPage | Links to the Organization entity |

**Rules**

- Generate JSON-LD at build time from the same data that renders the page, using one helper, so markup and visible text can never drift apart.
- Do not add ratings or reviews unless they come from real visitors and are shown on the page. Fake ratings risk a manual action.
- FAQPage markup no longer produces rich results for most sites, and Google has retired HowTo rich results. Keep FAQ markup only because it is cheap and structures the content for machines.
- Validate with Google's Rich Results Test and the Schema Markup Validator, and add a JSON validity check to CI.

**Example for a tool page**

```json
{
  "@context": "https://schema.org",
  "@type": "WebApplication",
  "name": "Merge PDF Files",
  "url": "https://example.com/merge-pdf/",
  "description": "Combine PDF files in your browser. Free, no signup, and your files never leave your device.",
  "applicationCategory": "UtilitiesApplication",
  "operatingSystem": "Any",
  "browserRequirements": "Requires JavaScript",
  "inLanguage": "en",
  "offers": {
    "@type": "Offer",
    "price": "0",
    "priceCurrency": "USD"
  }
}
```

## AI search readiness

No one can buy or guarantee a top recommendation from an AI assistant, but the site can be easy to find, easy to quote and easy to trust, and those are the things these systems reward. Behavior differs between assistants and changes often, so treat this section as a practice to review every quarter.

**1. Make every page easy for machines to read**

- Keep the main answer in static HTML. Many crawlers do not run JavaScript.
- Put a direct definition under the H1, and write H2 headings as questions with a one to three sentence answer first.
- Put facts in tables and lists: supported formats, size limits, steps. These are easy to extract and quote.
- Use descriptive link text and accurate last updated dates.

**2. Let the right crawlers in**

Decide in robots.txt on purpose. Allow search and retrieval crawlers so assistants can cite the site. Training crawlers are a separate choice.

| Purpose | Crawlers | Suggested |
| --- | --- | --- |
| Search and citation | Googlebot, Bingbot, OAI-SearchBot, PerplexityBot, Claude-SearchBot | Allow |
| Fetching on a user's request | ChatGPT-User, Claude-User | Allow |
| Model training | GPTBot, ClaudeBot, Google-Extended, Applebot-Extended, CCBot | Your choice. Allowing may help models learn the brand. Blocking opts out of training. |

Check each vendor's documentation for current crawler names before launch, because they change. Also check the CDN settings: Cloudflare can block AI crawlers by default on new domains, which would hide the site from AI search without any robots.txt rule.

**3. Build trust and brand signals**

- Use one consistent brand name everywhere. The About page says who runs the site, why it exists and how to contact them.
- Add Organization schema with sameAs links to real profiles (GitHub, LinkedIn, Product Hunt).
- Publish a privacy explanation page with a way for visitors to verify the no-upload claim, plus a public changelog.
- Consider publishing the tool code on GitHub. Open code is a strong proof for a privacy claim and a citation source in itself.

**4. Earn mentions off the site**

Assistants lean on what the wider web says about a product, so a good site with no outside mentions is easy to overlook.

- Launch on Product Hunt and AlternativeTo, post a Show HN, and share in relevant Reddit and developer communities following each community's rules.
- Join Bangla tech and student groups where people ask for tools like form photo resizers and Bijoy converters.
- Publish a few honest guides, for example "Is it safe to upload your passport photo to online image compressors?" and short video walkthroughs on YouTube.
- Publish original, useful facts that others cite, such as photo size requirements for common Bangladeshi forms.

**5. Optional low-cost extras**

- Add an llms.txt file at the root with a short list of the main pages. No major AI provider has confirmed that it relies on this file, so treat it as cheap and unproven.
- Ping IndexNow on every publish so Bing-based systems see changes quickly.

**6. Measure**

- Keep a list of 20 target prompts, for example "private PDF merger that does not upload files" and "compress image to 20KB online". Each month, run them in ChatGPT, Claude, Gemini, Perplexity and Google AI Mode, and record in a sheet whether the site is cited or recommended.
- In analytics, track referral visits from chatgpt.com, perplexity.ai, gemini.google.com, claude.ai and copilot.microsoft.com.
- The target is to be cited for at least 5 tracked prompts by month 9.

## Content strategy and tool roadmap

Launch with 20 tools chosen for low risk of being replaced by AI chat and low competition, then grow to 50 by month 6 using real search data.

**How to choose a tool**

- It works on a real file or needs the browser, so a chatbot cannot simply answer it.
- Privacy matters to the user, which makes the no-upload promise a reason to choose it.
- It serves Bangladesh or Bangla speakers, where competition is thinner.
- It matches a specific search such as "compress image to 20KB", not a vague category.

**Phase 1: the 20 launch tools**

| Tool | Why it is on the list | Browser approach |
| --- | --- | --- |
| Merge PDF | High volume, real file task | pdf-lib, with a clear error for password-protected PDFs. Bookmarks may be lost, so say so on the page |
| Split PDF | High volume, real file task | pdf-lib, with a clear error for password-protected PDFs |
| Images to PDF | Common form and document task | pdf-lib for JPG and PNG. Convert other formats through Canvas first |
| PDF to images | Common, pairs with the tools above | pdf.js, with a resolution cap to stay within phone memory and canvas limits |
| Compress image | High volume, real file task | Canvas re-encode for JPG and WebP. For PNG, use a WASM optimizer, or offer JPG or WebP when there is no transparency |
| Compress image to a target size (20 KB, 50 KB, 100 KB) | Form uploads with strict limits | Same engine, searching quality first and reducing dimensions if needed, one page per preset |
| Resize image | Common, privacy sensitive | Canvas |
| Convert image format (PNG, JPG, WebP) | Steady demand | Canvas, plus a WASM WebP encoder where the browser cannot create WebP. Test on a real iPhone, because Safari may not support it |
| HEIC to JPG | iPhone photos often fail on websites | WASM decoder, loaded on demand. Check its license and the HEVC patent position before shipping |
| Remove image metadata (EXIF) | Privacy is the whole point | Strip metadata from the file bytes without re-encoding, and keep the photo's rotation correct |
| Photo and signature resizer for forms | Bangladesh form and job application niche | Canvas with size presets checked against each form's official requirements |
| QR code generator | Steady demand | QR library |
| Bijoy to Unicode converter | Bangla niche, low competition | Character mapping with vowel reordering and conjunct handling, tested against a real set of Bangla text |
| Number to Bangla words | Bangla niche, low competition | Plain JavaScript with a full word table for 1 to 99, plus lakh and crore |
| Bangla and English date converter | Bangla niche, low competition | Plain JavaScript using the Bangladesh calendar, stated on the page because the West Bengal calendar differs |
| JSON formatter and validator | Developer audience, repeat use | A parser that preserves original values, or JSON.parse with a warning, because JSON.parse changes very large numbers and drops duplicate keys |
| Base64 encoder and decoder | Developer audience, repeat use | Built-in browser functions with TextEncoder and TextDecoder, because btoa fails on Bangla text |
| Password generator | Steady demand, trust fits the brand | crypto.getRandomValues, with rejection sampling to avoid modulo bias |
| Word and character counter (Bangla and English) | Steady demand, Bangla variant is thin | Plain JavaScript with Intl.Segmenter, so Bangla characters and words count correctly |
| Age and date difference calculator | Steady demand | Plain JavaScript |

**Phase 2: months 2 to 4 (up to 35 tools)**

- Media: video trim and compress, audio trim and convert, voice and screen recorder, background remover, OCR for images (including Bangla).
- Bangla: Unicode to Bijoy, Bangla typing tool, Bangla word counter.
- Developer: regex tester, JWT decoder, hash generator, UUID generator, timestamp converter, text diff.
- Calculators: EMI, GPA and CGPA, percentage, unit converter.

**Phase 3: months 4 to 6 (up to 50 tools)**

- Add tools and preset pages that Search Console shows people already looking for.
- Add Bangla versions of the best performing English tools.
- Improve the five tools with the most visits before adding new ones.

**Tool brief.** Before building any tool, write down: the target search query, who searches it and why, the top three competing pages and what they lack, the library and the file size limit, the privacy note, and the five FAQ questions. If the brief cannot name a real gap, skip the tool.

## Privacy, trust and legal pages

State the privacy promise in exact words a visitor can check, and back it with a policy that openly discloses ads and analytics.

**Claim wording**

| Use | Avoid |
| --- | --- |
| Your files are processed in your browser and are not uploaded to our servers. | 100% secure, completely anonymous, or "we collect no data" while ads or analytics run |
| We use Google Analytics to count visits and see which tools are used. It and our ad partners may set cookies and collect data about your visit, but never the contents of your files. | Any claim that is broader than what the site really does |

**Make the claim verifiable**

- Publish a "How we protect your privacy" page that shows two checks: open the browser's Network tab while using a tool and see no upload, or disconnect from the internet after the page loads and see the tool still works.
- Keep the lint rule that bans network calls in tool code (see Core principles).
- Set a Content-Security-Policy that limits connect-src to the site itself plus the named analytics and ad domains, so tool code cannot send data anywhere else.
- Self-host every library and model file. Do not load tool code from third-party CDNs.
- When a tool downloads a model on first use (OCR, background remover), say so on the page and explain that the file still stays on the device.

**Pages required before launch**

- Privacy Policy, Terms of Use, About, Contact
- Cookie and consent settings page
- Accessibility statement
- Privacy explanation page with the verification steps
- Short disclaimer on calculators: for information only, not financial, legal or medical advice
- Credits page listing library licenses

**Consent and licensing**

- If ads are shown to visitors in the EEA or UK, use a Google-certified consent management platform and show the banner only where it is required. Declining must be as easy as accepting.
- Check the license of every library before shipping. Some, such as certain ffmpeg builds, carry copyleft terms that affect how you must distribute them.
- This is a build plan, not legal advice. Have the policies reviewed before launch.

## Security and protection

Every security control here is paired with a safeguard, because a control that blocks real visitors, search crawlers or AI crawlers costs more than the attack it prevents.

**What is actually at risk.** The site has no server code, database, login or file storage, so the realistic risks are third-party scripts and ads, dependencies, account or domain takeover, abusive bots and clones. No site is unhackable, so the aim is to cover these cheaply and to test every change.

**Controls and safeguards**

| Control | Protects against | Safeguard for usability, SEO and AI search |
| --- | --- | --- |
| Cloudflare proxy, DDoS protection and managed WAF rules | Attack floods and scraping | Keep verified bots allowed. Turn off any setting that blocks AI crawlers or adds robots.txt rules you did not choose. Never leave "Under Attack" mode on. |
| Bot Fight Mode and rate limits | Abusive bots | Set limits high and apply them only to the contact form and any API-like paths. Exempt verified bots. No country blocking. |
| Cloudflare Turnstile and a honeypot field | Form spam | Contact form only, never on tools. Show the contact email as a fallback. Test with a keyboard and a screen reader. |
| Content-Security-Policy | Injected or malicious scripts, bad ad behavior | Start in report-only mode. Test with ads, analytics and every tool, and follow Google's published CSP guidance for its ad scripts. Enforce only when reports are clean. |
| Security headers: HSTS, nosniff, Referrer-Policy, Permissions-Policy, frame-ancestors | Downgrade attacks, content sniffing, clickjacking | Start HSTS with a short max-age and skip the preload list until you are sure. Allow camera and microphone only on recorder tools. Keep frame-ancestors set to none, except on any future embed path. |
| Output sanitizing: DOMPurify for Markdown preview, no innerHTML with user content, safe download file names | Script injection from user text and files | No visible effect on visitors or search. |
| Dependency hygiene: lockfile, npm ci, audit, Dependabot, protected main branch | Supply chain attacks | Run Lighthouse CI on every update so a new dependency cannot break the performance budget. |
| Ad network vetting and AdSense ad review controls | Malicious or intrusive ads | Use manual slots, block sensitive categories, and measure Core Web Vitals with ads on. |
| Account security: passkeys, 2FA, registrar lock, DNSSEC, CAA, SPF, DKIM and DMARC | Account and domain takeover, email spoofing | No effect on visitors. Delete unused DNS records so old subdomains cannot be taken over. |
| Self-referencing canonical, copyright notice, DMCA process | Clones and scrapers | Show the same HTML to everyone, including crawlers. No content hiding and no cloaking. |
| Monitoring: uptime checks, Cloudflare security events, Search Console Security Issues, security.txt | Slow detection | Review weekly. Add a /.well-known/security.txt file with a contact address. |

**Never do these** (they hurt usability, SEO or AI visibility)

- Put CAPTCHAs, logins or pop-up challenges in front of tools.
- Block whole countries, or block by broad user agent lists.
- Challenge or block requests to robots.txt, sitemap.xml, llms.txt, CSS, JavaScript or images.
- Serve different content to crawlers than to visitors (cloaking).
- Disable right-click or text selection, or obfuscate page text with JavaScript. These do not stop copying and they harm accessibility.
- Turn on hotlink protection, which can break social preview images.
- Show a "checking your browser" page to normal visitors.

**Test after every security change**

1. Run the Search Console URL Inspection live test on the homepage and one tool page, and confirm the page renders with no blocked resources.
2. Check Cloudflare security events for challenged or blocked verified bots such as Googlebot, Bingbot, OAI-SearchBot, PerplexityBot and Claude-SearchBot. The target is zero.
3. Fetch robots.txt, sitemap.xml and llms.txt from a clean network and confirm each returns the file, not a challenge page.
4. Rerun Lighthouse CI and axe on the template pages and confirm the scores did not fall.
5. Open each tool with ads and analytics on, check the console for CSP violations, and confirm ads load and the tool works.
6. Test the contact form and Turnstile with a keyboard and a screen reader.
7. After each monthly AI prompt test, compare citations and AI referral traffic with the previous month to catch any drop caused by a rule change.

**Rollout order**

1. Passkeys and 2FA on the registrar, Cloudflare, GitHub, Google and email. Turn on registrar lock and auto-renew.
2. Cloudflare proxy with verified bots allowed.
3. Security headers, with a short HSTS max-age.
4. CSP in report-only mode, then enforce it.
5. The no-network lint rule, self-hosted libraries and sanitized user content.
6. Lockfile, Dependabot and branch protection.
7. Ad network settings.
8. Monitoring and security.txt.
9. Copyright notice and canonical tags.

**If something goes wrong**

- Roll back to the last good deploy in the hosting dashboard.
- Reset passwords and passkeys, and revoke API tokens and sessions.
- Check DNS records for changes you did not make.
- If Google flags the site, fix the cause and request a review in Search Console.

## Monetization-ready design

Reserve space for ads and affiliate links in the design from day one, but keep every slot away from the tool and inside a fixed-size box so ads can never break speed or usability.

**Slots**

| Slot | Location | Reserved space | Loads |
| --- | --- | --- | --- |
| In-content 1 | After the tool result and limits | 280 px high on mobile, 250 px on desktop | After consent, when scrolled near |
| In-content 2 | Between the explainer and the FAQ | 280 px high | After consent, when scrolled near |
| Sidebar | Desktop 1200 px and wider only, beside the explainer | 600 px high | After consent, when scrolled near |
| Affiliate box | Below the how-to steps | Its own content height | With the page |

**Rules**

- Every slot has a fixed minimum height so layout shift stays at zero.
- Never place ads above the tool, inside the input or output area, or as sticky bottom bars on mobile. No pop-ups, interstitials or auto-playing video.
- Start with at most two ad slots per page and add more only if Core Web Vitals and engagement stay healthy.
- Load ad scripts after consent and after first interaction or idle time, and only when the slot is near the viewport.
- Label every slot "Advertisement".

**Order of monetization**

1. Apply for AdSense when at least 20 tools are live, the legal pages exist, and each page has original text. Place slots by hand rather than switching on automatic ad placement, which can inject units anywhere.
2. Add affiliate recommendations where they fit the task, for example a password manager beside the password generator. Disclose them clearly ("We may earn a commission") and use rel="sponsored noopener" on the links.
3. Add a premium tier later for batch processing and higher limits. Build features behind a flag from the start. Use a merchant of record such as Lemon Squeezy or Paddle, and confirm they can pay out to Bangladesh before committing.
4. Once traffic is steady, offer a sponsored tool slot on the homepage.

## Analytics and monitoring

Measure with Google Analytics 4 and the search consoles, loaded so they never slow a page, and review a short list of numbers every week.

**Tools**

- Google Search Console: search queries, page performance, indexing and Core Web Vitals.
- Bing Webmaster Tools: Bing search data, which also matters for AI products that use Bing's index.
- Google Analytics 4 (free) for visits, referrals and tool events, set up as described below. Cloudflare dashboard analytics adds a view of requests and bot traffic that needs no script.
- PageSpeed Insights for real-user speed data, and any free uptime monitor for outages.

**Events to count.** Count tool\_start, tool\_success, tool\_error, download\_click and language\_switch, tagged with the tool name. Never record file names, file contents or text the visitor typed. For errors, log only the error type and the tool name.

**Google Analytics 4 setup**

- Create one GA4 web property with a single data stream. Use gtag.js directly and skip Google Tag Manager, which adds another script layer.
- Set data retention to 14 months, the longest option for a standard property.
- Turn off Google signals and ad personalization features, since nothing here needs them.
- Turn off the enhanced measurement events you do not use (scrolls, outbound clicks, site search, video, file downloads), so only page views and the five events above are recorded.
- Register tool\_name as a custom event dimension so reports can be broken down by tool.
- Link the property to Search Console, and to AdSense once ads are live.
- Create a custom channel group for AI assistants (chatgpt.com, perplexity.ai, gemini.google.com, claude.ai, copilot.microsoft.com) so their referrals show separately.
- Exclude your own visits with an internal traffic filter. GA4 already excludes known bots.

**Performance rules for the tracker**

- Load gtag.js when the browser is idle after the load event, with a short timeout, and never as a blocking script in the head. Do not wait for the first interaction, because visitors who leave without interacting would never be counted.
- gtag.js weighs tens of kilobytes compressed, many times more than a lightweight counter. Treat it as a deferred third party outside the first-load budget, but measure Core Web Vitals with it switched on and fail the build if they slip.
- To cut the cost further, try Cloudflare Zaraz (free tier), which can run Google Analytics from Cloudflare's edge and leave only a small loader on the page. Partytown, which runs third-party scripts in a worker, is another option but can break scripts. Test events and consent behavior before adopting either.
- Send every event through one small wrapper, track(name, params). Tool code calls only this wrapper, never gtag directly.

**Privacy and consent**

- Use Google Consent Mode v2 with storage denied by default for visitors in the EEA and UK, and let the consent management platform already planned for ads handle the choice. In basic mode no Google tag loads until consent is given, which is the strictest option but undercounts those visitors. In advanced mode the tag loads and sends cookieless pings.
- The track wrapper accepts only the five event names and the parameters tool\_name and language, and drops everything else. This is the technical guarantee that file names and typed text never reach Google.
- Send page URLs to GA4 without query strings or hash fragments.
- Name Google Analytics in the privacy policy and the consent text.
- Content-Security-Policy: allow https://www.googletagmanager.com in script-src, and https://*.google-analytics.com, https://*.analytics.google.com and https://\*.googletagmanager.com in connect-src and img-src. Test in report-only mode first.

**Weekly review**

| Number | Source | Healthy sign |
| --- | --- | --- |
| Clicks and impressions per page | Search Console | Rising week over week |
| Pages indexed compared with submitted | Search Console | Most submitted pages indexed within a few weeks |
| Average position for target queries | Search Console | Improving |
| Core Web Vitals | Search Console, PageSpeed Insights | All templates passing |
| Tool success rate (successes divided by starts) | Analytics | Above 90%, adjusted once real data exists |
| Referrals from AI assistants | Analytics, plus monthly prompt tests | Rising |
| Ad revenue next to page speed | AdSense, Core Web Vitals | Revenue up with no drop in vitals |

## Build phases and launch checklist

The build runs in five phases with two gates: a launch gate that blocks publishing until the checks pass, and a month 6 checkpoint that decides whether to keep investing.

&#91;embedded content: roadmap · 5 phases, 2 gates\]

Phases are not drawn to scale. Nothing ships publicly until the launch gate passes, and new tools stop at month 6 unless search traffic is growing.

**Launch gate checklist**

- [ ] Domain bought, HTTPS and the preferred host redirect working
- [ ] 20 tools live, each checked with keyboard only and with a screen reader
- [ ] Lighthouse mobile score of 95 or more and Core Web Vitals passing on every template
- [ ] axe reports no critical issues on every template
- [ ] Privacy, Terms, About, Contact, Accessibility and privacy explanation pages published
- [ ] Structured data validated, sitemap and robots.txt live, hreflang checked
- [ ] Search Console and Bing Webmaster Tools verified and sitemaps submitted
- [ ] robots.txt and CDN settings allow search and retrieval crawlers
- [ ] GA4 running with the listed events only, consent defaults checked for the EEA and UK, and no file content recorded
- [ ] Network tab check done on every tool: no uploads

* [ ] Security headers set and CSP enforced after a clean report-only period
* [ ] Account security done: passkeys, 2FA, registrar lock, DNSSEC and email authentication
* [ ] Bot protection tested: crawlers, sitemap, robots.txt and llms.txt are never challenged (see Security and protection)

**After launch**

- [ ] Share on Product Hunt, AlternativeTo, Hacker News, Reddit and Bangla communities
- [ ] Review Search Console weekly and add tools based on real queries
- [ ] Run the AI prompt tests monthly and log the results
- [ ] Apply for AdSense once 20 tools are live and traffic exists
- [ ] At month 6, compare results with the targets in Purpose and goals and decide whether to continue
