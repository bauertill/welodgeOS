-- The Stagger Planner has 2-bed apartments again (doc §4.12, 2026-11-23): the
-- first scenario, Decron – OBS 50 units, moves to the new defaults — Studio
-- 20% at $4,000, 1-bed 60% at $4,500 and 2-bed 20% at $5,500 a month. Only if
-- nobody has edited it since it was last set (by 20261120150000), so no one's
-- work is replaced. Other scenarios keep what they hold: no 2-bed share (0),
-- the default 2-bed rate.
UPDATE "StaggerScenario"
SET "data" = '{"units":50,"first":"2028-03-01","waves":6,"gap":14,"stay":6,"mix":{"studio":20,"one":60,"two":20},"rates":{"studio":4000,"one":4500,"two":5500},"showBlock":true,"showRent":true,"rateBasis":"month","rows":[{"date":"2028-03-01","units":9,"stay":6},{"date":"2028-03-15","units":9,"stay":6},{"date":"2028-03-29","units":8,"stay":6},{"date":"2028-04-12","units":8,"stay":6},{"date":"2028-04-26","units":8,"stay":6},{"date":"2028-05-10","units":8,"stay":6}]}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'stagger_decron_obs_50'
  AND "data" = '{"units":50,"first":"2028-03-01","waves":6,"gap":14,"stay":6,"mix":{"studio":20,"one":80},"rates":{"studio":4000,"one":4500},"showBlock":true,"showRent":true,"rateBasis":"month","rows":[{"date":"2028-03-01","units":9,"stay":6},{"date":"2028-03-15","units":9,"stay":6},{"date":"2028-03-29","units":8,"stay":6},{"date":"2028-04-12","units":8,"stay":6},{"date":"2028-04-26","units":8,"stay":6},{"date":"2028-05-10","units":8,"stay":6}]}'::jsonb;
