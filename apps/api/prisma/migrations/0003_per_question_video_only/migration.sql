-- Backfill existing questions missing solutionUrl from their Topic's videoUrl (excluding placeholders)
UPDATE "Question" AS q
SET "solutionUrl" = t."videoUrl"
FROM "ExamModel" AS em
JOIN "Topic" AS t ON t."id" = em."topicId"
WHERE q."examModelId" = em."id"
  AND q."solutionUrl" IS NULL
  AND t."videoUrl" IS NOT NULL
  AND t."videoUrl" <> ''
  AND t."videoUrl" NOT LIKE '%REPLACE_ME%';

-- Drop obsolete topic-level video & watch-time columns, question timestamp column, and cohort segment visit flag
ALTER TABLE "Topic"
  DROP COLUMN "videoUrl",
  DROP COLUMN "videoId",
  DROP COLUMN "minWatchSeconds";

ALTER TABLE "Question"
  DROP COLUMN "videoTimestampSeconds";

ALTER TABLE "Cohort"
  DROP COLUMN "requireWrongSegmentVisits";
