-- Field Ops Reporter — migration 7: report-audio writes are service-role only (session 6 review)
--
-- FOR-03. The bucket had member INSERT and UPDATE policies scoped to the caller's org folder
-- ({org_id}/…). Nothing in the app uses them: every write goes through a service-role signed
-- upload URL minted in a server action (createReport / answerClarification), and the PUT to a
-- signed URL is authorised by the token, not by RLS. The member policies only widened the
-- attack surface — with their own JWT a field user could
--   * upload arbitrary content types (e.g. text/html) anywhere in the org folder, and
--   * overwrite ANY object in the org folder, including another driver's processed report audio
--     (verified: a field JWT replaced an existing report's recording).
-- The dashboard's audio player still needs to read, so the SELECT policy stays; the pipeline
-- reads and writes with the service role, which bypasses RLS. Dropping these two policies
-- leaves the phone-upload path (signed URL) and the player (signed read) working while closing
-- the direct-JWT write surface.

drop policy if exists "org members upload audio into their org folder" on storage.objects;
drop policy if exists "org members replace audio in their org folder" on storage.objects;

-- "org members read their org audio" (SELECT) is intentionally kept: the report detail page
-- signs its own org's audio as the user (createSignedUrl), which checks this policy.
