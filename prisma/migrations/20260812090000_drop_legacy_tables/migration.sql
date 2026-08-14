-- Drop the legacy ORGS/data.json layer's tables.
--
-- Every writer and reader of these nine tables was deleted in the previous
-- commit ("Remove the legacy ORGS/data.json layer"); nothing in the app has
-- referenced them since. IF EXISTS so this is safe on a database that never
-- had them (a fresh install replaying the full migration history does create
-- them in earlier migrations, so this really does drop there).
--
-- NOT dropped, deliberately: `events`, `store_countries` and
-- `partner_managed_stores`. They look legacy but live code still reads them —
-- uninstall-enrichment falls back to `events` for plan name and uninstall
-- reason, flow-engine reads `store_countries` for the {{country}} merge tag,
-- and countries.ts sources its domain list from `partner_managed_stores`.

DROP TABLE IF EXISTS `app_snapshots`;
DROP TABLE IF EXISTS `store_categories`;
DROP TABLE IF EXISTS `app_ads`;
DROP TABLE IF EXISTS `keyword_suggestions`;
DROP TABLE IF EXISTS `thresholds`;
DROP TABLE IF EXISTS `file_blobs`;
DROP TABLE IF EXISTS `projects`;
DROP TABLE IF EXISTS `automations`;
DROP TABLE IF EXISTS `partners`;
