# Content rights and third-party services

## Status: FINDINGS — not yet triaged

Not a software-licence question, but the same production question: can this be
put in front of the public as-is? Read together with
[license-audit.md](license-audit.md) (what the *code* is allowed to do) and
[security-review.md](security-review.md). Verified 2026-10-03, `main` @ `78937ef`.

---

## CRITICAL — the Terms of Use claims copyright the Library does not hold

`frontend/src/i18n/en-US/index.ts:136`, rendered on the public page
`/uslovi-koriscenja`:

> "The National Library of Montenegro "Đurđe Crnojević" **retains all copyright
> on the digitized and published material** on the Digital Library of
> Montenegro portal."

Montenegro is a Berne Convention signatory. A library that digitises a work it
legally owns a **physical copy** of acquires no copyright in that work — it
acquires the copy. Asserting blanket copyright over everything on the portal is
an over-claim the Library cannot back, and it is published in **both** locales
(`me/index.ts:136`), with the derived rules at `:138` ("may not be distributed,
exchanged or sold without the written consent of the copyright holder") resting
on it. This is a live legal statement about a government body, on a public page,
in production — a materially worse production risk than any package licence.

What the Library can assert is narrower and still useful: copyright in its own
publications, in works assigned or licensed to it, and public domain works. For
everything else the portal is a reproduction under whatever right the Library
holds (often a purchase, a bequest, or a national deposit), and the terms need
to say that rather than claim ownership.

**Nobody has ever reviewed this text.** `docs/backend/development.md` says every
endpoint and behaviour needs tests; no doc anywhere records who wrote the terms
or against what advice.

## HIGH — metadata comes from COBISS.net and its terms are unrecorded

Every imported record's metadata originates from COBISS.net, the union catalogue
run by **IZUM** (Ljubljana), fetched over a token-gated API
(`external.cobiss-token` in `config.template.yml`,
`cobiss-util/cobiss-fetch.ts`). A grep of every doc for licence/rights/fee terms
on COBISS or IZUM returns **nothing** — `architecture.md` and
`roles-and-permissions.md` treat COBISS purely as a data source.

That matters because the portal republishes their metadata on a public site, and
because the Terms of Use above implies the Library controls the whole record. IZUM
operates the Slovenian and shared COBISS network under its own terms; what those
permit for a third-country national library republishing records is a contract
question, not a technical one. **Find out whether a signed COBISS/IZUM agreement
exists and what it covers** — this is a procurement item, not a code change.

## HIGH — placeholder stock photos are live on the home page

`frontend/src/pages/IndexPage.vue:298,300,303` hotlink
`https://picsum.photos/seed/nbcg-{old-rare-books,cetinje-heritage,folk-heritage}/...`
for the "Old rare books", "Cetinje heritage" and "Folk heritage" tiles of the
theme mosaic. Deterministic seeds, so they look deliberate. In production that
means:

- random photographs from the Unsplash pool presented as national-library
  heritage;
- someone else's images, under a licence nobody elected to;
- a third-party request on every home-page view (see the fonts item below).

Replace with real scans from the collection — `image-stock.jpg` in
`frontend/src/assets/` is unreferenced and may already be a placeholder.

## MEDIUM — fonts are hotlinked from Google's CDN

`frontend/index.html:15-19` loads Source Sans 3 and Source Serif 4 from
`fonts.googleapis.com`. The licence is fine (SIL OFL 1.1) and self-hosting is
free, but hotlinking sends every public visitor's IP address to Google — an
ePrivacy/GDPR exposure for a government-facing EU site, for no benefit. The same
page also `preconnect`s to `fonts.gstatic.com`.

Fix is small: drop the `<link>` tags and serve the OFL files from
`frontend/public/fonts/` (Quasar's own `@quasar/extras` already ships local
copies, which is where the current fonts came from).

## MEDIUM — Font Awesome's attribution obligation is unmet

`frontend/quasar.config.ts:21` enables `fontawesome-v6`. Font Awesome **Free** 6
is three licences: icons **CC BY 4.0** (attribution **mandatory**), fonts
SIL OFL 1.1, code MIT. Their licence additionally forbids using FA icons as part
of a logo or trademark.

There is **no credits / attribution / open-source page** anywhere — no route in
`frontend/src/router/routes.ts`, no footer link in `i18n/*/index.ts` `footer`.
This is the only hard attribution obligation anywhere in the stack and it is
currently unmet. Material Icons (`material-icons-outlined`, also enabled) is
Apache-2.0 — attribution appreciated, not required.

A `/credits` page listing Font Awesome and Material Icons closes it, and is the
natural home for a fuller third-party notice later.

## INFORMATIONAL

- `frontend/src/assets/quasar-logo-vertical.svg` — the Quasar logo is a
  trademark. It is unreferenced, so delete rather than ship.
- `backend/pgadmin-servers.json` (committed) contains a dev password; dead file,
  but it is a credential in git.
- The public footer claims no licence at all today, so there is no page the
  Library would need to *amend* if it wants to publish a third-party notice —
  there is simply nothing there.
