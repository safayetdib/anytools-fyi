import { buildSearchEntries } from "../lib/search/entries";

// Loaded only when a visitor focuses a search box. Searching then happens on their device.
export function GET() {
  return new Response(JSON.stringify(buildSearchEntries()), {
    headers: { "Content-Type": "application/json" },
  });
}
