---
title: Architecture decision records
description: The index of Homiio's ADRs — what each one decides, what it binds, and how to add another.
order: 12
---

# Architecture decision records

An ADR records a decision that is expensive to reverse, the context that forced
it, and what it rules out. It is not a design doc and it is not a plan: it is the
authority a later change is checked against.

**These four are the reason this repository has a shared vocabulary at all.**
Before them, "address", "listing", "location" and "fair price" each meant
something slightly different in each domain, and the disagreements surfaced as
bugs that looked like somebody else's fault.

## The records

| # | Title | Status | Issue | Decides |
|---|---|---|---|---|
| [0001](./0001-canonical-housing-graph) | The canonical housing graph: street, building, unit and listing | Proposed | [#345](https://github.com/OxyHQ/Homiio/issues/345) | What a dwelling IS, why a listing is not one, how reviews/leases/saves attach, and how duplicates merge |
| [0002](./0002-location-and-search-contract) | One location and search contract for Home, Explore, reviews and evictions | Proposed | [#346](https://github.com/OxyHQ/Homiio/issues/346) | The shared `LocationSelection`, the URL grammar, what "search this area" means, and what happens when geocoding fails |
| [0003](./0003-privacy-verification-publication) | Privacy, verification and publication rules for addresses, reviews and evictions | Proposed | [#347](https://github.com/OxyHQ/Homiio/issues/347) | Four-tier data classification, the precision ladder, verification levels, the k-anonymity floor, right of reply |
| [0004](./0004-local-explainable-pricing) | Local, explainable, versioned pricing assessments | Proposed | [#348](https://github.com/OxyHQ/Homiio/issues/348) | What replaces the universal "fair price" score: local comparables, four assessed dimensions, explicit confidence |

All four are children of [epic #344](https://github.com/OxyHQ/Homiio/issues/344).

## `Proposed` means the contract binds design, not behaviour

Every record above is **Status: Proposed** as of 2026-08-10. Read that as:

- **A new change must not contradict them.** They are the agreed direction, and
  building against them is not optional.
- **They do not describe what the code does today.** Where an ADR and the running
  system disagree, the system is what runs. Documentation must never present an
  ADR's target contract as shipped behaviour — mark it **Target** and link the
  record.

Re-read the `Status` line in each file rather than trusting this section. A
status is exactly the kind of fact that goes stale without anybody noticing.

## What binds what

| If you are touching… | Read |
|---|---|
| addresses, buildings, units, deduplication, what a review attaches to | 0001 |
| Home, Explore, the map, saved searches, URLs carrying a place, "search this area" | 0002 |
| anything published about a person or a dwelling, evictions, review authorship, aggregates | 0003 |
| the fair-price badge, `fairnessScore`, comparables, price history | 0004 |
| observability events, buckets, redaction | 0003 (the classification the buckets implement) |

Note 0003 numbers its own heading `3.` rather than `0003`. The **file name** is
the record's identity; cite `0003-privacy-verification-publication.md`.

## Do not restate an ADR

The rules in these documents are long because the reasoning is load-bearing.
Summarising one into `AGENTS.md`, a doc page or a code comment produces a second
copy that diverges — and the copy is what people read, because it is shorter.

Link the record. `AGENTS.md` names the four invariants they establish and points
here for everything else; that is the intended amount of duplication and it
should not grow.

## Adding a record

1. `docs/adr/NNNN-kebab-title.md`, next free number, never reusing one.
2. Open with `**Status:**`, `**Date:**`, the issue, what it supersedes, and the
   related records.
3. **Re-derive every claim from the checkout you have**, and say which commit you
   measured. A figure repeated from memory or from a sibling document is an
   assertion, not a measurement; state the command that produced each number so
   the next reader can re-run it.
4. State what the decision **rules out**, not only what it allows. A record that
   forbids nothing decides nothing.
5. Add a row to the table above, and update the `Status` line here when it
   changes.

A record is never edited to reflect a change of mind. Supersede it with a new one
and mark the old `Superseded by NNNN` — the history of why is the point.
