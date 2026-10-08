# Legacy link and data cutover

The application can redirect old hostnames after DNS or the existing reverse proxy points those hosts at the Mizu deployment. Set `MIZU_LEGACY_HOST_REDIRECTS` to comma-separated `old-host=https://new-host` pairs. It redirects GET and HEAD with HTTP 308 while preserving the path and query string. Add separate pairs for the public, member and dashboard hosts when they differ.

Check each old host before switching traffic:

```bash
curl -I 'https://OLD_HOST/booking/spa?outlet=example'
```

The response should have `Location: https://NEW_HOST/booking/spa?outlet=example`. Update payment, webhook and other POST callback URLs at their providers; those requests are intentionally not redirected by the app.

## Existing database data

The repository cannot reach the external database in this workspace. Once access is available, take a backup and run the inventory first:

```bash
cd backend
MIGRATE_DATABASE_URL='postgres://…' node database/scripts/rename-external-brand-data.js --from "Old Brand" --to Mizu --allow-remote
```

Review the table and column counts. The apply command updates matching text in one transaction and rolls back on a constraint or query error:

```bash
MIGRATE_DATABASE_URL='postgres://…' node database/scripts/rename-external-brand-data.js --from "Old Brand" --to Mizu --allow-remote --apply --confirm
```

Then repeat the inventory; it should report zero matches. Review third-party dashboards, DNS, WhatsApp templates, app store listings, emails and payment callbacks separately. The database script cannot change those systems.
