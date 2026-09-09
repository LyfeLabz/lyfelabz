ASTRA-004 offline Hosting fixtures
================================

astra004-hosting-dist.json.gz is deterministic gzip (mtime 0) of a JSON object
mapping the three app/dist paths to their UTF-8 bodies. These files are absent
from Git's cb73aff tree. The fixture contains only the public bytes from the
independently inspected astra004-hosting-zBFaP3 artifact, compared with public
staging on 2026-09-07. The other 175 baseline files come from the pinned Git tree.
Every fixture is checked against the production baseline hash lock before tests
run. No test fetches these fixtures from a live service or updates the lock.

This directory is test data. It is outside the 178-path Hosting allowlist.
