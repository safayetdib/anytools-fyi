-- One row per voter per tool. Rating again replaces the score.
-- voter and ip_day are salted hashes, so neither the browser id nor the IP address is stored.
CREATE TABLE ratings (
  tool TEXT NOT NULL,
  voter TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 1 AND 5),
  ip_day TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tool, voter)
);

CREATE INDEX idx_ratings_tool_ip_day ON ratings (tool, ip_day);
