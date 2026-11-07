import en from "../../i18n/en.json";
import { fill } from "../../i18n/format";
import { RATED_KEY, VOTER_KEY } from "../ratings";

const r = en.rating;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Blocked storage: the rating still counts, it just isn't remembered here.
  }
}

function rememberedScores(): Record<string, number> {
  try {
    const scores = JSON.parse(read(RATED_KEY) ?? "{}");
    return scores && typeof scores === "object" ? scores : {};
  } catch {
    return {};
  }
}

// The random id is made only when someone rates, and the server stores only a salted hash of it.
function voterId(): string {
  const existing = read(VOTER_KEY);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(VOTER_KEY, id);
  return id;
}

export function mountRating(root: HTMLElement) {
  const group = root.querySelector<HTMLElement>("[data-rate]");
  const rateSlug = group?.dataset.rate;
  if (!group || !rateSlug) return;
  const slug: string = rateSlug;
  const stars = [...group.querySelectorAll<HTMLButtonElement>(".shell-star")];
  const status = group.querySelector<HTMLElement>('[data-el="rate-status"]');
  let sending = false;

  function show(score: number) {
    for (const star of stars) {
      const value = Number(star.dataset.score);
      star.classList.toggle("is-on", value <= score);
      star.setAttribute("aria-pressed", String(value === score));
    }
  }

  function say(message: string, problem = false) {
    if (!status) return;
    status.textContent = message;
    status.classList.toggle("is-problem", problem);
  }

  const previous = Number(rememberedScores()[slug]);
  if (previous >= 1 && previous <= 5) {
    show(previous);
    say(fill(r.thanks, { score: previous }));
  }

  async function send(score: number, star: HTMLButtonElement) {
    if (sending) return;
    sending = true;
    show(score);
    star.classList.add("is-picked");
    say(r.sending);
    try {
      const response = await fetch(`/api/ratings/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ score, voter: voterId() }),
      });
      if (response.status === 429) throw new Error("limited");
      if (!response.ok) throw new Error(String(response.status));
      write(RATED_KEY, JSON.stringify({ ...rememberedScores(), [slug]: score }));
      say(fill(r.thanks, { score }));
    } catch (cause) {
      const before = Number(rememberedScores()[slug]) || 0;
      show(before);
      say((cause as Error).message === "limited" ? r.limited : r.failed, true);
    } finally {
      sending = false;
      setTimeout(() => star.classList.remove("is-picked"), 200);
    }
  }

  group.addEventListener("click", (event) => {
    const star = (event.target as HTMLElement).closest<HTMLButtonElement>(".shell-star");
    if (star) void send(Number(star.dataset.score), star);
  });
}
