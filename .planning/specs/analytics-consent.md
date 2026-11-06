# Spec: Google Analytics with consent

Status: approved by the owner on 2026-11-06. Measurement ID `G-5KMBSHH44P`.

## Behaviour
- Google Analytics (GA4) loads only after the visitor taps **Accept** ("basic" Consent Mode). Before that, nothing is sent to Google and no cookies are set.
- It loads only on the production host `anytools.fyi`, so local builds, tests and previews never send data.
- A small banner asks once: "Accept" and "Decline" are equal buttons, with a link to the Cookies page. The choice is kept in `localStorage` (`anytools-consent`).
- "Cookie settings" in the footer reopens the banner, so a choice can be changed as easily as it was made. Declining after accepting deletes the `_ga` cookies.
- Consent Mode v2 defaults are set to denied for ads; Google signals and ad personalisation are off.
- On phones the banner sits above the bottom tab bar and never covers the tool's own controls for long: it is dismissed with one tap.

## What is sent
- Page views, plus one event, `tool_complete`, with the tool's path when a tool finishes.
- Never file names, file contents, typed text or page counts.

## Pages
- Cookies page lists `_ga` and `_ga_<id>` and the `anytools-consent` and `theme` storage keys.
- Privacy policy describes Google Analytics, what it collects and how to opt out.

## Performance
- gtag.js is requested only after consent and after the page has loaded, so first visits keep their Lighthouse scores.
