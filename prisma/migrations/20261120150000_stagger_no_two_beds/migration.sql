-- The Stagger Planner drops 2-bed apartments (doc §4.12, 2026-11-20): the
-- first scenario, Decron – OBS 50 units, moves to the new 50-unit defaults —
-- Studio 20% at $4,000 and 1-bed 80% at $4,500 a month. Only if nobody has
-- edited it since the migration that made it, so no one's work is replaced.
-- Other scenarios keep what they hold; a stored 2-bed figure is ignored.
UPDATE "StaggerScenario"
SET "data" = '{"units":50,"first":"2028-03-01","waves":6,"gap":14,"stay":6,"mix":{"studio":20,"one":80},"rates":{"studio":4000,"one":4500},"showBlock":true,"showRent":true,"rateBasis":"month","rows":[{"date":"2028-03-01","units":9,"stay":6},{"date":"2028-03-15","units":9,"stay":6},{"date":"2028-03-29","units":8,"stay":6},{"date":"2028-04-12","units":8,"stay":6},{"date":"2028-04-26","units":8,"stay":6},{"date":"2028-05-10","units":8,"stay":6}]}'::jsonb,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'stagger_decron_obs_50'
  AND "data" = '{"units":50,"first":"2028-03-01","waves":6,"gap":14,"stay":6,"mix":{"studio":20,"one":60,"two":20},"rates":{"studio":4000,"one":4500,"two":5500},"showBlock":true,"showRent":true,"rateBasis":"month","rows":[{"date":"2028-03-01","units":9,"stay":6},{"date":"2028-03-15","units":9,"stay":6},{"date":"2028-03-29","units":8,"stay":6},{"date":"2028-04-12","units":8,"stay":6},{"date":"2028-04-26","units":8,"stay":6},{"date":"2028-05-10","units":8,"stay":6}]}'::jsonb;
