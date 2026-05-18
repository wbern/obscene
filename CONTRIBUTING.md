# Contributing

## Field reports wanted

The most useful contribution right now isn't code — it's an honest field report from running obscene against a real codebase. The reports in the [README](./README.md#field-reports) all came from agents that tried the tool, read the output critically, and wrote up what they found. More reports across more codebase shapes (different languages, sizes, histories, conventions) make the tool's actual strengths and limits visible to the next person evaluating it.

The prompt below is designed to be copied verbatim into your agent of choice (Claude Code, Cursor, Aider, etc.) inside a repo you're willing to analyze. The agent runs, reads, and writes; you review and either open a PR adding it to the README or send it via issue.

For a worked example of what the tool says about a real codebase, see the **Hotspots snapshot** auto-appended to every GitHub release of obscene itself — it's the same output you'll be reading on your own repo, applied to this one.

### What a good report looks like

- **Honest, specific, numbered.** "5 hotspots flagged, top one had 12 fix-commits across 30 changes" beats "it found stuff."
- **Both views exercised** — `obscene` (hotspots) and `obscene coupling`, with the confidence stamps inspected.
- **Compares findings to prior knowledge.** Did it confirm something you already knew, surface something new, or miss something obvious? The contrast is the signal.
- **Names a worth-reporting angle.** What is *this* codebase able to say about obscene that the existing reports can't? (Thin history? Polyglot? Monorepo? Notebook-heavy? Generated code? Strict conventional commits? No conventional commits at all?)
- **Honest about limits.** Negative findings are welcome. "Ran it on X and got nothing useful because Y" is a valuable report.
- **Anonymized byline.** Sign off with model identity only (`— Claude/Opus 4.7`, `— GPT-5`, `— Gemini 2.5 Pro`, etc.). No human names, no company names, no product names. Codebase descriptions stay generic ("mid-sized polyglot service repo", not "Acme's billing system").

### The prompt

Copy everything between the `---` markers into your agent, inside a repo with at least a few months of git history.

---

````
You're going to run a hotspot-analysis CLI called `@wbern/obscene` against this
repository and write a field report on what it surfaced. The report will be
added to a public README, so be honest, specific, and concrete — not a sales
pitch. Negative findings ("nothing useful here because Y") are welcome.

Important guardrails:

- **Do not act on the findings.** This is an evaluation of the tool, not a
  remediation task. Do not refactor files because they ranked HOT.
- **Do not impersonate a different model.** Sign off with your actual model
  identity at the end.
- **Do not name the repository, employer, product, or any developer** in the
  report. Codebase descriptions stay generic.

## Step 1: Run it

Prerequisites: `scc` must be installed (https://github.com/boyter/scc#install).

Run these and capture the output (substitute `npx` for `pnpm dlx` if you
don't have pnpm):

  pnpm dlx @wbern/obscene --version
  pnpm dlx @wbern/obscene init                       # generates .obsignore
  pnpm dlx @wbern/obscene --format table             # hotspots, 3-month default
  pnpm dlx @wbern/obscene --format table --months 6  # wider window
  pnpm dlx @wbern/obscene coupling --format table    # coupling
  pnpm dlx @wbern/obscene report --format table      # raw scc summary

Then pick a base ref (a release tag, a branch you merged, or a SHA from
~2 weeks ago) and run the delta views:

  pnpm dlx @wbern/obscene --base <ref> --format table              # rankings filtered to changed files
  pnpm dlx @wbern/obscene --base <ref> --full-delta --format table # full corpus diff (mode C)

Note: as of v2.x, **`obscene` excludes nothing by default** — without an
`.obsignore`, generated files / vendored code / lockfiles all show up in
the ranking. Running `init` first is not optional cosmetics; it's how you
opt into the filtering everyone else's rankings assume. If you skip it,
mention that in the report.

Also run each command without `--format table` to get JSON, and inspect the
`confidence` fields on each ranking — `level`, `reason`, `inputs.value`,
`inputs.thresholds`, and `source`. Note the file count after `.obsignore`
filtering and roughly how long the runs took.

Watch stderr for warnings like _"git history covers ~Nd, but --months
window is 90d — count-based confidence won't reflect time-based trust on
a young repo"_. If you see one, that's a verification target for the
honesty claim — note whether it changed how you read the confidence
column.

## Step 2: Read it critically

Don't just summarize the output. The interesting question is: *what do you
now know that you didn't from reading the code alone, and where did the tool
mislead you?*

For hotspots, for the top 3–5 entries in each ranking:

- Are they genuinely worth attention, or false positives (stable parser, a
  vendored file `.obsignore` missed, a generator + its output)?
- Did the tool surface anything you wouldn't have prioritized from code
  reading? Did it miss anything obvious?
- On the Fix Activity column — is the top entry latent fragility or a
  feature that got debugged thoroughly? Read the actual `fix:` commits
  before concluding.

For coupling:

- Are high-degree pairs real hidden dependencies, or expected co-change
  (docs ↔ code, generated ↔ source, fixtures ↔ subject)?
- Did the `⇄` lockstep marker fire on anything real?
- Did the `†` deleted-file marker show up, and did it help?
- Anything surprise you about how Degree is computed or displayed?

For the delta views:

- Compare the `--base <ref>` run (filtered rankings) against the full
  hotspots run — do the filtered entries look like the parts of the diff
  worth careful review, or did the filter drop the file you would have
  flagged from reading the diff yourself?
- With `--full-delta`, look at the Δ columns and the Full Delta section.
  Are the complexity / churn deltas directionally believable? Did a file
  with a big Δ actually warrant attention, or was it a rename / format
  churn?
- Did `--full-delta` ever fall back to mode B (filtered rankings)? If so,
  the JSON `fullDelta` will be missing and stderr will explain why —
  worth noting what triggered it.

On the confidence ladder specifically:

- For each ranking, does the assigned level (INCONCLUSIVE / WEAK /
  PLAUSIBLE / ACCEPTABLE) match what the data warrants? Was anything over-
  or under-confident?
- If a ranking was skipped, which threshold did it fail? Does that
  failure message tell you something useful about your git history?
- Look at the JSON `confidence.source` field. The README claims it
  honestly distinguishes "metric concept from a paper" vs. "threshold
  values that are engineering judgment." Does that hold up?

On the README's claims more broadly:

- Pick 2–3 specific behavioral claims from the README (e.g. "refuses to
  rank thin samples", "exposes confidence inputs", "marks lockstep pairs",
  "init picks up modern patterns", "exclusions are opt-in") and verify
  them against the actual output. Note any gap between claim and
  behavior.

## Step 3: Write the report

Write a markdown blockquote (every line starting with `> `). Match the
voice of the existing field reports in the README — direct, numbered,
willing to flag rough edges. Required pieces:

1. **Opener (1 paragraph).** Codebase shape (size, languages, history
   depth, anything unusual). End the opener with one sentence naming
   *why this case is worth a report* — the angle this codebase exposes
   that prior reports didn't.

2. **Findings (2–5 specific items).** Numbered or bulleted. Each item
   names a column or command, gives a number (entries, threshold, score,
   degree), and says what it told you. The existing reports split this
   into "what the tool does well" + "caveats and rough edges" — use that
   shape, or use hotspots/coupling/expectations splits, or whatever fits
   what you found. Don't pad with sections that have nothing to say.

3. **Verdict (1 paragraph).** What is obscene good for on this codebase,
   and what isn't it telling you?

4. **Byline.** Single line: `> — <your actual model identity>` (e.g.
   `> — Claude/Opus 4.7`, `> — GPT-5`, `> — Gemini 2.5 Pro`).

Constraints:

- Specific over general. Real numbers, real column names, real threshold-
  failure messages copy-pasted where useful.
- Length: roughly 400–700 words of blockquote body.
- Do not invent results. If a dimension skipped, say so. If confidence was
  WEAK, say so. If the run was uninformative, say so and explain why.

## Step 4: Deliver

Two options:

1. Open a PR against https://github.com/wbern/obscene adding the report to
   the `## Field reports` section of README.md, immediately before the
   `## License` heading. Don't touch the existing reports.

2. Or paste the report into a new issue at
   https://github.com/wbern/obscene/issues — the maintainer will PR it.

Include in the PR/issue body (NOT in the report itself):
- `obscene --version` output
- Anonymized codebase shape: file count after `.obsignore`, primary
  languages, rough history depth
- Any commands you ran beyond the prompt's defaults
- Approximate run time per command (if memorable)
````

---

### Notes for human contributors

- Reports are not anonymous to the maintainer — the PR or issue carries your GitHub identity. The *byline in the README* is anonymized to model identity so the report reads as an evaluation, not an endorsement from a named person.
- The maintainer reserves the right to lightly copy-edit reports for consistency, but won't change the substance. If something would materially change, you'll be asked.
- If your agent produces something that reads as marketing copy, send it back through with the constraint "be more honest about misses". The most useful reports admit what didn't work.

## Other contributions

For bugs, feature requests, or code changes, open an issue first to discuss scope before sending a PR. The project is intentionally small — additions should keep the surface area lean and the citations honest.
