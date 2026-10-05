# Changelog Rules

`docs/changelog.md` is read by developers upgrading the library. They scan it for what breaks and what's new; write for scanning, not reading.

## Structure

- Sections per release, in this order: `Breaking Changes`, `Added`, `Changed`, `Fixed`. Omit empty sections.
- Never create an `[Unreleased]` section. Entries go under the version heading currently being prepared.
- Intro paragraph: at most two sentences, only when the release has one theme. Link the relevant guide instead of explaining.
- Write entries at phase completion, describing the net change. Never per-fix during development.
- Treat published versioned migration guides as immutable historical documentation. Add a new guide for a new release; never revise an older guide with later behavior.

## Entries

- One bullet per change, one sentence per bullet. Breaking entries may use two: what changed, then the migration.
- Lead with the API name or the observable behavior. No scene-setting clauses before the point.
- Merge related entries into one bullet. Five reflection fixes are one bullet, not five.
- **Breaking:** start with "Removed"/"Renamed", then state the replacement and what to delete from saved presets or code.
- **Added:** API name, default value, one clause on what it controls.
- **Fixed:** the symptom that no longer occurs. Never the cause, the mechanism, or the fix.

## Never include

- Preset changes. Tuning of built-in preset values is not a changelog entry, ever.
- Implementation vocabulary: shader, pass, buffer, uniform, vertex, fragment, compute, mip, texture, sample, billboard, flipbook, cascade, frame loop.
- Formulas, algorithm names, tuning constants, file paths.
- Mechanism narration: "previously X was Y", "instead of the hand-tuned...", "the blur tracks wind speed on its own".
- Filler and marketing: "no tuning required", "dramatic", em-dash asides restating the sentence.

## Litmus tests

- If an entry needs the source to be understood, rewrite it.
- If an entry is longer than two rendered lines, cut it.
- If two entries share a subject, merge them.

After editing, run `npm run docs:build` and fix any errors, unless the root project instructions or the user prohibit builds in the current conversation.
