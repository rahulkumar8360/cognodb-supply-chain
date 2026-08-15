# Screen recording script — ~2 min 30 s

## Before you press record

1. Close every other tab and window. Only the browser, maximised.
2. Open **https://cognodb-supply-chain.vercel.app** and let it fully load.
3. **Load each of these once first**, so nothing is slow during the take:
   - `https://cognodb-supply-chain.vercel.app/advisories/CVE-2021-44906`
   - `https://cognodb-supply-chain.vercel.app/trace?app=checkout-api&package=ms`
   - `https://cognodb-supply-chain.vercel.app/phantom`
4. Go back to the home page.
5. Press **`Win + Alt + R`** to start. Wait 2 seconds before speaking.

---

## SCENE 1 — Overview (~25 s)

**You are on:** the home page

**Say:**

> "This is Supply Chain Atlas. It answers one question: when a vulnerability is
> published, which of our services is actually affected?
>
> There are 169 advisories in this feed. Only 153 of them can be reached from
> something we actually run — so 16 are already filtered out as irrelevant.
>
> Each service is ranked by what an attacker could reach, not by how many
> packages it has."

**Do:** slowly scroll down so the "Exposure by team" bars come into view, then back up.

---

## SCENE 2 — Blast radius (~45 s) ⭐ the important one

**Do:** click **Advisories** in the sidebar, then click **CVE-2021-44906**

**Say:**

> "Let's take a real one. CVE-2021-44906 — prototype pollution in minimist.
>
> Thirty services are exposed, twelve of them revenue-critical. It's fixed in
> version 1.2.6.
>
> But this is the part that matters."

**Do:** scroll to "How it gets in" and hover your mouse along one route

**Say:**

> "For every service it shows the actual route in. Config Service depends on
> json5, and json5 depends on minimist. Nobody chose minimist — it arrived two
> levels down.
>
> This comes back from a single shortestPath traversal in Cypher. The database
> returns the path itself, so I don't need a second query to work out why the
> package is there. In SQL this would be a recursive CTE that only tells you
> yes or no."

---

## SCENE 3 — Maintainer risk (~30 s)

**Do:** click **Maintainer risk** in the sidebar

**Say:**

> "A different question. Not what's vulnerable — who can push code into our
> production.
>
> Look at content-type. Fifty-three million downloads a week, it sits under all
> thirty of our services, and exactly one person can publish a new version. That
> account has no two-factor authentication and controls twenty-one other
> packages.
>
> That is the exact shape event-stream and ua-parser-js had before they became
> real incidents. It's a two-hop question — maintainer, to package, to service —
> and you only get an answer after you traverse it."

---

## SCENE 4 — Trace a path (~30 s)

**Do:** paste this in the address bar:
`https://cognodb-supply-chain.vercel.app/trace?app=checkout-api&package=ms`

**Say:**

> "Here's why removing one dependency often doesn't help.
>
> Checkout API to the ms package: six different shortest routes. Four are fully
> installed. Even if I dropped express, three other dependencies still pull ms
> in.
>
> That's allShortestPaths — every shortest route, not just one."

---

## SCENE 5 — Phantom dependencies (~20 s)

**Do:** click **Phantom deps** in the sidebar

**Say:**

> "And the opposite problem — false alarms.
>
> These vulnerable packages are in the dependency tree, but every route to them
> runs through a dev or optional dependency, so they never ship. Eighty findings
> suppressed. A scanner that ignores this wakes someone at three in the morning
> for code that was never deployed.
>
> This is a set difference between two transitive closures over the same graph."

---

## SCENE 6 — Close (~15 s)

**Do:** click the browser back button until you're on the Overview page

**Say:**

> "It's built on CognoDB over the Bolt protocol using the standard Neo4j driver.
> Around two and a half thousand nodes and twenty-one thousand relationships.
>
> Every query is parameterised, the connection details come from environment
> variables, and the README explains the data model and why a graph database
> earns its place here.
>
> Thank you."

**Do:** stop with **`Win + Alt + R`**

---

## Afterwards

The file is in `C:\Users\rahul\Videos\Captures\`.

Upload to Google Drive → right-click → **Share** → **Anyone with the link** → copy link.

## If you'd rather not talk

Silent is fine. Click through Scenes 1–5 slowly, pausing about 5 seconds on each
screen, and lingering on the dependency routes in Scene 2. Roughly 90 seconds.

## Don't worry about

Stumbling, saying "um", or restarting a sentence. One take is fine. They are
watching to see the app work and to hear that you understand it — not for
polish.
