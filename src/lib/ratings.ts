export interface RatingSummary {
  count: number;
  average: number;
}

// Below this many ratings nothing is shown, so a page never says "5.0 from 1 rating".
export const MIN_SHOWN_RATINGS = 5;

export const VOTER_KEY = "anytools-voter";
export const RATED_KEY = "anytools-rated";

export function shownRating(summary: RatingSummary | undefined): RatingSummary | null {
  return summary && summary.count >= MIN_SHOWN_RATINGS ? summary : null;
}

// One decimal, the way people read star scores: 4.78 → "4.8".
export function formatAverage(average: number): string {
  return (Math.round(average * 10) / 10).toFixed(1);
}

export function aggregateRatingSchema(summary: RatingSummary) {
  return {
    "@type": "AggregateRating",
    ratingValue: formatAverage(summary.average),
    ratingCount: summary.count,
    bestRating: "5",
    worstRating: "1",
  };
}
