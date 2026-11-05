CREATE TABLE usage_daily (
  day TEXT NOT NULL,
  metric TEXT NOT NULL,
  key TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric, key)
);
CREATE TABLE visitors (
  day TEXT NOT NULL,
  visitor TEXT NOT NULL,
  PRIMARY KEY (day, visitor)
);
CREATE INDEX visitors_day ON visitors (day);
