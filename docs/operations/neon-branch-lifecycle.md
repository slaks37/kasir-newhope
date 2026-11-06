# New Hope Neon branch lifecycle

| Category | Use | Expiration |
| --- | --- | --- |
| `main` | Permanent production | None |
| `staging` | Reusable isolated integration environment | None |
| `release/*` | Active release acceptance | Review after 7 days and renew while acceptance is active |
| `experiment/*` | Disposable experiments | 3–7 days |

Use isolated staging databases or schemas where the test preserves tenant and financial isolation. Use dummy records and staging credentials, and preserve release evidence in GitHub. A code change alone does not require a new Neon branch.

Assign an owner and expiry review to each temporary branch. Use Neon automatic expiration only for disposable experiments with no external dependencies. For a release branch serving an active Preview, renew its review deadline while acceptance continues and remove any automatic expiry that could interrupt the live Preview. Keep the existing Auth/staff rehearsal until its replacement passes.

Before retiring a branch, confirm its identity, compute activity, child branches, deployment and environment references, OAuth/issuer/trusted origins, and integration or webhook use. Review and detach dependencies before authorized deletion. Recheck the inventory after each deletion. Production is excluded from cleanup.

## Capacity monitor

The daily GitHub Actions monitor reads branch metadata. Set the repository Actions secret `NEON_BRANCH_MONITOR_API_KEY` using the narrowest available Neon credential for this project. The workflow runs from the default branch after merge and can then be dispatched manually.

At 7/10 it warns. At 8/10 it produces a cleanup review in the run summary with candidates, expiry, and Neon parent/child references. External dependencies require separate verification. At 9/10 it fails and policy prohibits optional branch creation. At 10/10 it also fails and leaves the cleanup review in the run summary. Check the current count before any branch creation, including Console actions. The workflow has no automatic deletion or branch creation.
