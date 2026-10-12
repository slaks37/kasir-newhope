# Public landing runtime

The root HTML is prerendered from HomePage. Its CSS and framework-free bootstrap
are inline. Do not restore initial module preloads for the React feature bundle:
read-only visitors, anchors, and native disclosures do not need hydration.

Login and trial CTAs navigate directly. Buttons, sector links, and range controls
load landing-interactive on pointer/focus intent or their first action. The
bootstrap queues actions during loading and replays them after synchronous
hydration. Commit each queued action before the next so a billing toggle updates
the handler used by a subsequent checkout click. Preserve native open disclosures and replay input values against
React's SSR-initialized value tracker. Failed downloads offer an explicit reload
because browsers can cache a rejected dynamic import until the page reloads.
The authenticated application remains a separate app.html with its existing
session, checkout intent, and offline service worker behavior.

## Analytics

The publicly served GTM-WD7T7WSF container was inspected on 2026-10-12. Its
resource contains zero tags, zero predicates, and zero rules. The ~113 KiB
runtime cannot produce analytics events without configured tags. The public
landing therefore retains dataLayer and the gtm.js start event but does not load
that empty container. The application entry's GTM configuration is unchanged.

When real analytics is configured, publish and validate the tags first, then
restore an appropriate landing loader. Check page_view, campaign attribution,
and conversion events end to end. Avoid merely delaying analytics until a user
clicks: that would lose visits from readers who leave without interaction.

## Verification

npm run verify includes production HTML checks for SSR copy/metadata, no CSS or
initial module requests, a small inline bootstrap with deferred feature imports,
no empty GTM runtime, and a separate cashier shell. Browser verification must
also cover cold first click on slow networks, native disclosure state, first
range change, keyboard sector navigation, demo checkout, and selected billing
cycle continuing to registration.
