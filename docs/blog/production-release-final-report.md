# New Hope blog automation — production release

Verdict: **GO PRODUCTION** (4 November 2026). Mandatory production storage, backend, publication, duplicate, audit and regression gates pass.

## Release identity

- PR31 merged: https://github.com/slaks37/kasir-newhope/pull/31
- Reviewed head c4cd721e07d7d7f59b5840be49a517dc7672991c; merge 61fd4d49bf4ca0890704fc28050c6abdda7f7297.
- Production deployment dpl_3kvcdhnq23MWTan9KU8zLt1rhPTH, READY, https://kasir-newhope-4q45qe3qz-slaks37s-projects.vercel.app ; primary https://kasir.newhope.space.
- Worker https://newhope-blog-media.stefenlaksana-sl.workers.dev , binding BLOG_BUCKET → newhope-blog-production; deployment 77da074dbcc84ce8bd8461cdb4a26365. Source matches infra/cloudflare/newhope-blog-media/worker.js.
- Production r2.dev remains disabled. DNS unchanged. No Neon migration, auth, POS, financial-data or payment-provider configuration changes.

## Real production acceptance

Five R2 production variables are configured. A new credential has only Object Read/Write on newhope-blog-production, verified by token policy readback and real S3 authentication. Access keys and secret values are excluded from this report.

Disposable JPEG: S3 upload/HEAD PASS; Content-Type image/jpeg, 5106 bytes; Worker GET/HEAD200; SHA256 f64f7e3792945eebfa22e1c8848e7d71e0362777c03b6d1cb1c2ce6b4294599d; conditional GET304; overwrite412; public writes405; missing/invalid/listing404. Worker unavailable-R2 sanitization503 tested with a failing binding fixture, without inducing a production outage. Test object removed.

Live backend smoke execution16583: POST /covers201, coverGenerated=true, persistent Worker URL. Disposable backend object removed after verification.

Production n8n LY2WqUqboTtPgBSE published version a948c684-f962-4e0f-9f6e-f4348fe132a1, 39 nodes. Only this New Hope workflow is scheduled; staging and repair workflows are inactive. Cron 0 0 * * * *, Asia/Jakarta. Credential and endpoints remain production scoped.

- Scheduled16584, 16:00 WIB: article published, HTTP201, audit published. https://kasir.newhope.space/blog/harga-tepung-naik-margin-pastry-menyusut-cara-hitung-hpp-riil-sebelum-ambil-keputusan
- Next scheduled16585, 17:00 WIB: article published, HTTP201, audit published. https://kasir.newhope.space/blog/bisnis-stop-produksi-karena-margin-menipis-ini-cara-melihat-hpp-riil-sebelum-putuskan
- Controlled manual16586: published, HTTP201, audit published. https://kasir.newhope.space/blog/masih-catat-pesanan-pakai-buku-ini-biaya-tersembunyi-yang-menggerus-omzet-umkm
- Production duplicate probe16587: repeat POST409 SLUG_ALREADY_EXISTS; Neon query confirms exactly one published row for controlled slug. Each scheduled slug also has exactly one row.

Controlled image: https://newhope-blog-media.stefenlaksana-sl.workers.dev/automation/generated/f7c16499-796f-4624-98af-4eff50ee121a.jpg — HTTP200, image/jpeg, 92082 bytes. S3 and Worker SHA256 both 6b1d4e9fdb6b3e6258a5f335f135081010da9a0176be34e1e35813c33dbe3e1f.

Two scheduled article pages return200 with matching cover and og:image. Browser confirms 1200×675 cover loaded. Legacy media regression: three previous Neon JPEG URLs200; existing blog200. Controlled article page200 with matching cover/OG and no CJK in final HTML.

## Quality, failure paths and CI

Execution16579 was success without publication: category/basic validation rejected the draft (835 words, score100). Executions16576–16578 reached qualified=true but failed at old cover storage. The deployed adapter now surfaces safe storage errors and uses R2.

Staging real Agnes/R2 publication16571 passed. Pinned staging16580 verifies discovery audit precedes published audit. Pinned failure16581 verifies cover_upload_failed with no publication node. These pinned tests use saved outputs; no extra AI charge or public article is claimed from them.

Full npm run verify PASS including lint/build/runtime/POS/payments/admin-photo/security/blog suites. CI for PR31 c4cd721 PASS, PostgreSQL17 rehearsal PASS, Preview READY; merge61fd4d4 main CI PASS. R2/Worker auth and HTTPS were tested against real services; unrelated POS/payment provider regression uses fixtures/mocks, not live financial transactions.

Editorial readback detected stray CJK fragments in three otherwise Indonesian articles. Those exact fragments were corrected in place; a query confirms no remaining CJK in these articles. No title, slug, cover, source or legacy media URL was rewritten. PR32 adds a CJK rejection gate for Indonesian output and a regression fixture; CI for 96c5c1fc8d9a151e23a40d15c75e1b93c4f72c69 PASS (full lint/test/build, PostgreSQL17 rehearsal and Preview). Its exact parser is published live as version 7cf2ad71-be3b-4819-9b8e-5108cacb2737. Pinned staging16588 reuses actual problematic Agnes output: languageOK=false, rejected_quality, no publication node. This is a synthetic replay of saved output, not another paid generation.

## Rollback and residual limits

- Previous Vercel deployment: dpl_BhbREKmyt91UKG29aGms9DFRGHte, main85c350d730f24d46ac0acee29972167c263f14a0, https://kasir-newhope-fea98e200-slaks37s-projects.vercel.app.
- Previous n8n version c8993641-7af1-4575-b8ff-2a5a4f806ab2. Export saved at outputs/newhope-production-workflow-pre-release.json in the task workspace. Restore backend/workflow as a coordinated pair; old upload implementation has the original storage failure. Keep R2 objects and published articles.
- Internal audit uses the existing authorized Opportunities sheet; execution history saves terminal outcomes and recovery references. No external recipients were added. Early RSS/Sheets transport failures remain visible in execution history; no new email/messaging alerts are claimed.
- No blind paid AI or publication retries. Ambiguous publication ACK requires GET slug before any retry. Lock/slug/title checks do not constitute semantic-news deduplication or durable successful-response replay.
- Existing dependency advisories remain documented in automation-r2-review.md. No new SDK advisory was observed in the prior audit.
- Python urllib received403 from Worker on this local network; Node HTTPS and browser image delivery succeeded with TLS verification and matching content. No TLS bypass was used.

Final runtime scan (10:26–10:56 UTC) found one Node DEP0169 url.parse deprecation warning on RSS, no storage/publication error. RSS200 on follow-up. New language gate has not yet had a subsequent hourly execution at report time; scheduled16584/16585 precede that stricter gate.

PR32 merged as 8b2b39e7a9d2981e219b624ddef212cfe5c3c608; reviewed parser head96c5c1f. This follow-up changes the tracked n8n parser only; application backend source is unchanged from verified PR31 production release.

Latest production deployment: dpl_G3DMFwqjrqcBBsR1ccL1jMdKKq3G, https://kasir-newhope-pyi4yvjl0-slaks37s-projects.vercel.app , READY at merge8b2b39e7a9d2981e219b624ddef212cfe5c3c608. Post-deploy controlled article200 with correct cover/OG and no CJK. PR32 CI/security/Preview passed on reviewed head; main merge verification status recorded in the final appendix.

## Final appendix

- Main merge8b2b39e CI completed SUCCESS: https://github.com/slaks37/kasir-newhope/actions/runs/41817561824 . All mandatory CI/security gates pass.
- Next real hourly execution16589 started2026-11-04T11:00:00.054Z (18:00 WIB), completed success, terminal audit **rejected_quality**. AI score65 is below70, with weak UMKM product fit and similar existing topic. No publication is claimed from this execution. This confirms the current scheduler and explicit nonpublication audit after the language-guard release.
- Final active/published n8n version7cf2ad71-be3b-4819-9b8e-5108cacb2737. Staging remains inactive, without schedule, with STAGING_TEST_COMPLETE_LOCKED guard.
- Verdict remains **GO PRODUCTION**. Qualified controlled and scheduled publications passed; low-score output is rejected and audited. Public editorial text in the three acceptance articles has been corrected and read back.
