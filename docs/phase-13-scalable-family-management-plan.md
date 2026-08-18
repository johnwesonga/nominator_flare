# Phase 13: Scalable family-management UI plan

Status: **13A.3 implemented; manual acceptance pending**

Phase 12 is safe and functional, but its presentation is optimized for a small
dataset. It renders every family as an expanded card, including every swimmer
and all management controls. With 40 or more families, the page would remain
technically correct but become slow to scan, tedious to navigate, and difficult
to use on a phone.

This phase will improve navigation without changing family, swimmer, voting, or
authorization rules.

## Recommendation

Implement a compact, searchable, paginated family list whose rows are collapsed
by default. Expanding one row reveals its swimmers and voting-link actions. Show
the create or edit form only after the administrator chooses an action.

Keep filtering and pagination in the browser initially. A dataset of roughly 40
families and their swimmers is small, so the existing
`GET /api/admin/families` response should remain quick while client-side search
provides immediate feedback. This avoids expanding the API contract before
there is evidence that it is necessary.

### Proposed page structure

```text
Family Management                         Add family
40 families · 83 swimmers

[ Search email or swimmer... ] [ Status: All ] [ 20 per page ]

> parent.one@example.com       2 swimmers    Voting: complete
v parent.two@example.com       3 swimmers    Voting: in progress
    Swimmer A · Group A · voted              Edit
    Swimmer B · Group B · not voted          Edit
    Swimmer C · Group B · not voted          Edit
    [Copy voting link] [Add swimmer] [Edit family] [Delete family]
> parent.three@example.com     0 swimmers    Voting: not started

Showing 21–40 of 40                         Previous  1  2  Next
```

On desktop, each collapsed family should be a compact row. On narrow screens,
the same information should wrap into a compact card rather than a horizontally
scrolling table.

## Interaction design

### Search

- Search family email, swimmer name, and swimmer group with one text field.
- Match case-insensitively after trimming the query.
- Update results as the administrator types.
- Reset to the first page when the query changes.
- Display a clear empty state and a `Clear search` action when nothing matches.

Search should be implemented over normalized display values, never over family
tokens. Tokens must not be placed in a searchable index or logs.

### Filters

Start with filters that directly help common management tasks:

- `All`
- `No swimmers`
- `Voting not started`: no swimmer has voted
- `Voting in progress`: some but not all swimmers have voted
- `Voting complete`: every swimmer in a non-empty family has voted

The zero-swimmer case must not be classified as voting complete. Only one filter
is required initially; combining filters can be reconsidered after actual use.

### Sorting

Use family email in ascending, case-insensitive order as the stable default.
Do not add a sort menu until administrators identify another useful ordering.
Stable ordering prevents rows from unexpectedly moving after an edit or page
refresh.

### Expansion

- Keep all family rows collapsed initially.
- Permit one expanded family at a time.
- Make the entire labelled disclosure button keyboard accessible.
- Set `aria-expanded` and associate the control with its detail region.
- Preserve the expanded family after a successful edit or reload when it is
  still visible under the active query and filter.
- Collapse it when it no longer matches or is deleted.

Allowing one expanded row keeps the page short and makes the administrator's
current context obvious. Supporting multiple expanded rows adds state and can
recreate the original long-page problem.

### Pagination

- Default to 20 families per page.
- Offer page sizes of 10, 20, and 50.
- Render only the current page's family rows and swimmer details.
- Reset to page one when search, filter, or page size changes.
- Clamp the current page after deletion so an empty final page cannot remain.
- Show `Showing X–Y of Z` as well as Previous and Next controls.

At 40 families this produces two short pages by default. The page-size choice
can remain in memory for the current session; persistence is not necessary in
the first implementation.

### Forms and mutations

The current management form is always present. Replace that default with an
idle management state:

- `Add family` opens a blank family editor.
- `Edit family`, `Add swimmer`, and `Edit swimmer` open the appropriate editor
  for the expanded family.
- Delete actions continue to open an explicit confirmation state.
- Cancel returns to the list without discarding search, filter, page, or
  expansion context.
- After a successful mutation, reload the authoritative family list, preserve
  valid list context, display the existing status notice, and return keyboard
  focus to a useful control.

An inline editor immediately below the toolbar is recommended for the first
version. It is responsive and avoids the focus trapping and small-screen issues
of a modal. A side drawer could look more polished on desktop, but it would need
additional responsive and accessibility behavior.

## Options considered

| Option | Advantages | Disadvantages | Decision |
|---|---|---|---|
| Keep expanded cards | No implementation work; all details visible | Very long page, expensive scanning, actions are difficult to find | Reject for 40+ families |
| Search only | Small change; quickly finds a known family | Unfiltered page remains long; every family remains rendered | Insufficient alone |
| Accordion only | Greatly reduces vertical length; simple mental model | Forty headings still require scrolling; no quick lookup | Use with search and pagination |
| Client-side search, filters, pagination, and accordion | Fast interaction, bounded DOM, no API change, low operational risk | Adds frontend state and page-edge cases | **Recommended now** |
| Server-side cursor pagination | Handles very large datasets and keeps responses bounded | Requires API/SQL contract changes, cursor logic, remote search, more tests | Defer until justified by measurements |
| Virtualized list | Can render thousands of rows smoothly | Overkill here; harder keyboard, focus, variable-height, and test behavior | Do not use |

## Frontend design changes

The exact type names may change during implementation, but the logged-in admin
model needs state equivalent to:

```text
family_query: String
family_filter: FamilyFilter
family_page: Int
family_page_size: Int
expanded_family_id: Option(String)
management_mode: Idle | NewFamily | EditFamily | NewSwimmer | EditSwimmer | ConfirmDelete
```

Derived functions should remain pure and independently testable:

1. Normalize the query.
2. Filter the complete family list.
3. Sort it stably.
4. Clamp the requested page.
5. Slice only the visible page.
6. Derive voting progress from swimmer vote state.

Filtering and paging should not mutate the authoritative family collection.
Family tokens must remain confined to the expanded family's copy-link control.

## API and performance strategy

### Initial implementation

Do not change the Worker API. Continue fetching all families with nested
swimmers using the existing authenticated, `no-store` endpoint.

Before and after implementation, record in preview:

- encoded response size for realistic 40- and 100-family fixtures;
- API response duration;
- time from dashboard initialization to a usable family list;
- number of rendered family and swimmer elements.

### When to introduce server-side pagination

Move to server-side pagination only when preview or production measurements
show that the full response materially affects loading or memory. Useful warning
signals include hundreds of families, a response growing into several hundred
kilobytes, or consistently noticeable list-load time on mobile connections.
Measurements, rather than a fixed family count, should decide the change.

A future contract could be:

```text
GET /api/admin/families?q=<query>&status=<filter>&limit=20&cursor=<opaque>

{
  "items": [...],
  "next_cursor": "...",
  "total": 640
}
```

Cursor pagination is preferable to offset pagination because concurrent inserts
and deletes are less likely to shift records between pages. Its disadvantages
are more complex navigation, opaque cursors, and difficulty jumping directly to
an arbitrary page. If direct numbered pages remain a firm requirement,
server-side offset pagination may be the more pragmatic tradeoff for this
admin-only dataset.

## Accessibility requirements

- Search and filter controls must have persistent labels.
- Disclosure controls must be native buttons with `aria-expanded`.
- Every expanded region must have an accessible relationship to its button.
- All actions must work by keyboard and touch.
- Focus must remain predictable after expansion, cancellation, save, and delete.
- Loading, error, success, and result-count changes must be announced without
  stealing focus.
- Do not rely on color alone for voting progress.
- Mobile content must not require horizontal scrolling.

## Testing plan

### Gleam state and view tests

- Search matches email, swimmer name, and group case-insensitively.
- Search and filter compose correctly.
- Empty families are not classified as voting complete.
- Pagination returns the correct slice and count.
- Query, filter, and page-size changes reset the page.
- Deleting the last item on a page clamps to an existing page.
- Only one family is expanded at a time.
- Mutation success preserves valid context.
- Mutation failure preserves the editor and list context.
- Disclosure and paging controls emit the correct messages.
- The idle state does not render an editor.

### Browser acceptance

Use fixtures with 0, 1, 40, and 100 families, including empty families, long
emails, long swimmer names, and mixed voting states. Confirm:

- no more than the selected page size is rendered;
- a known family can be found quickly by email or swimmer name;
- filtering, paging, expanding, editing, copying, and deleting work together;
- state remains understandable after a request failure and retry;
- keyboard and touch operation pass;
- phone-sized layouts do not overflow;
- Access authorization and existing safe-deletion rules remain unchanged.

Worker tests do not need to change for the initial client-side version. If the
server API is later paginated, add validation, stable ordering, cursor,
authorization, no-store, and token non-disclosure tests.

## Delivery sequence

### Phase 13A: small implementation checkpoints

Each checkpoint must leave the application usable, pass its focused tests and
the complete release gate, and be reviewed before work starts on the next
checkpoint. A checkpoint should normally be one commit.

#### 13A.1: idle management editor

Goal: remove the always-visible empty `Add family` form without changing the
family list.

Changes:

- Add an idle variant to the management state.
- Initialize and reset management to idle.
- Render no editor while idle.
- Keep `Add family`, edit, add-swimmer, and delete actions opening their existing
  forms.
- Make Cancel return to idle.

Focused checks:

- the dashboard initially contains no management editor;
- every management action opens the correct existing form;
- Cancel closes it; and
- successful mutations return to idle while failed mutations keep their form.

This is the safest first increment because it shortens the page immediately and
does not alter API requests, family ordering, or list navigation.

Checkpoint status:

- [x] Idle management variant added.
- [x] Dashboard initialization and successful mutations reset to idle.
- [x] The editor is omitted from the view while idle.
- [x] Existing Add, Edit, Add swimmer, and Delete actions still open forms.
- [x] Cancel returns to idle and failures preserve the active form.
- [x] Focused state tests added.
- [x] Complete release gate passes: 22 Gleam tests, 54 Worker tests, frontend
  packaging, generated types, D1 and migration validation, and deployment dry
  run.
- [x] Manual browser acceptance confirmed on 2026-08-17 that the editor is
  initially hidden and opens and closes through every action.

#### 13A.2: family-list state and test fixtures

Goal: introduce navigation state without changing which families are displayed.

Changes:

- Add a dedicated family-list state containing query, filter, page, page size,
  and expanded family ID.
- Initialize it with an empty query, `All`, page 1, page size 20, and no expanded
  family.
- Add deterministic test factories for 0, 1, 40, and 100 families.
- Keep rendering the existing cards during this checkpoint.

Focused checks:

- default state is deterministic;
- refresh and unrelated admin actions preserve list state; and
- fixture families contain empty, partial-vote, and complete-vote cases.

Checkpoint status:

- [x] Dedicated family-list state added for query, filter, page, page size, and
  expanded family ID.
- [x] State initializes with an empty query, `All`, page 1, page size 20, and no
  expanded family.
- [x] Existing family cards remain unchanged during this checkpoint.
- [x] Refresh, authoritative family reloads, and management actions preserve
  family-list state.
- [x] Deterministic automated fixtures cover 0, 1, 40, and 100 families.
- [x] Fixtures include empty, partial-vote, and complete-vote families.
- [x] Focused Gleam suite passes with 27 tests.
- [x] Complete release gate passes: 27 Gleam tests, 54 Worker tests, frontend
  packaging, generated types, TypeScript, D1 and migration validation, and the
  deployment dry run.
- [x] Manual browser acceptance confirmed on 2026-08-17 that the interface and
  existing family-management functionality have no visible regression.

#### 13A.3: collapsed family disclosures

Goal: bound the vertical size of each family while preserving all management
features.

Changes:

- Replace the permanently expanded card body with a native button disclosure.
- Keep all families collapsed initially.
- Expand at most one family at a time.
- Place the private voting link, swimmers, and mutation actions inside the
  expanded region.
- Add `aria-expanded` and an associated detail-region ID.

Focused checks:

- no swimmer details or family token are rendered while collapsed;
- selecting a second family collapses the first;
- selecting an expanded family collapses it; and
- keyboard and touch activation work.

Checkpoint status:

- [x] Family rows are collapsed by default and expose a native button control.
- [x] At most one family can be expanded at a time.
- [x] Expanding the open family again collapses it.
- [x] Private voting links, swimmers, and mutation actions render only within
  the expanded detail region.
- [x] Disclosure buttons expose `aria-expanded` and `aria-controls`, with a
  matching detail-region ID.
- [x] Expansion survives authoritative reloads while the family still exists
  and is cleared if that family was deleted.
- [x] Desktop and narrow-screen disclosure styles added.
- [x] Focused state and view tests pass as part of 31 Gleam tests.
- [x] Complete release gate passes: 31 Gleam tests, 54 Worker tests, frontend
  packaging, generated types, TypeScript, D1 and migration validation, and the
  deployment dry run.
- [ ] Manual browser acceptance confirms keyboard and touch operation, the
  one-expanded-family rule, and existing management actions.

#### 13A.4: family search

Goal: find a known family without paging or scanning.

Changes:

- Add a labelled family search field separate from the existing roster search.
- Match normalized family email, swimmer name, and group.
- Never search or index family IDs or tokens.
- Reset the family page and close an invisible expanded row when the query
  changes.
- Add result-count and no-results messages with a clear-search action.

Focused checks:

- matching is trimmed and case-insensitive;
- email, swimmer, and group searches work;
- tokens do not match; and
- clearing restores the complete list.

#### 13A.5: voting-progress filters

Goal: support common management views without adding combined-filter
complexity.

Changes:

- Add `All`, `No swimmers`, `Voting not started`, `Voting in progress`, and
  `Voting complete` options.
- Derive progress only from the nested swimmer vote state.
- Compose the selected filter with search.
- Reset the page and invalid expansion when the filter changes.

Focused checks:

- an empty family is never complete;
- zero, partial, and all-voted families are classified correctly; and
- filtering and search compose correctly.

#### 13A.6: client-side pagination

Goal: render a bounded number of family rows.

Changes:

- Sort filtered families by normalized email with an ID tie-breaker.
- Add page sizes 10, 20, and 50 with 20 as the default.
- Render only the selected page.
- Add result range, Previous, Next, and numbered page controls.
- Clamp the page after filtering, refresh, and deletion.

Focused checks:

- 40 families produce two default pages;
- boundary controls disable correctly;
- changing query, filter, or page size returns to page 1; and
- deleting the last row on a page cannot leave an empty page selected.

#### 13A.7: mutation context and focus

Goal: prevent administrators from losing their place while managing a family.

Changes:

- Preserve valid search, filter, page, page size, and expanded-family state
  across authoritative reloads.
- Keep failed forms open with their entered values.
- Return focus to the initiating or nearest surviving control after Cancel,
  save, and delete.
- Announce changed result counts and operation notices without stealing focus.

Focused checks:

- successful edit preserves visible context;
- a renamed or deleted family that no longer matches is handled predictably;
- failure and retry preserve context; and
- keyboard focus remains useful after every mutation outcome.

#### 13A.8: responsive styling and large-data acceptance

Goal: finish and measure the user-facing redesign.

Changes:

- Style compact rows for desktop and wrapped cards for narrow screens.
- Ensure controls meet touch-size and overflow requirements.
- Load realistic 40- and 100-family preview fixtures without using production.
- Record response size, response duration, usable-list time, and rendered row
  count.
- Run the complete release gate and authenticated preview acceptance.

Focused checks:

- desktop, mobile, keyboard, touch, and deliberate failure recovery pass;
- no more than the selected page size is rendered;
- existing Access, audit, validation, deletion, and caching protections remain
  unchanged; and
- measurements do not justify Phase 13B server pagination.

### Phase 13B: conditional server scaling

This is not automatically part of Phase 13A. Start it only if recorded
performance shows a real need:

1. Freeze the paginated API contract.
2. Add indexed D1 search and stable pagination.
3. Update frontend loading and navigation semantics.
4. Add Worker and integration tests.
5. Compare measured performance with the client-side version.

## Phase 13A completion checklist

- [ ] Large family fixtures exist for automated and preview testing.
- [ ] Search by family and swimmer information works.
- [ ] Voting-progress and empty-family filters work.
- [ ] Stable client-side pagination works at 10, 20, and 50 rows.
- [ ] Family details are collapsed by default and only one is expanded.
- [x] Management editors appear only in response to an explicit action.
- [ ] Mutations preserve valid search, filter, page, expansion, and focus state.
- [ ] Desktop, mobile, keyboard, touch, and failure recovery tests pass.
- [ ] Existing Access, audit, validation, safe-deletion, and no-store behavior is
  unchanged.
- [ ] Full local release gate passes.
- [ ] Preview performance measurements are documented.
- [ ] Authenticated preview acceptance with at least 40 families passes.

## Exit gate

Phase 13A is complete only after the compact list passes the full release gate
and authenticated preview acceptance with a realistic 40-family dataset.
Production deployment remains a separate explicit approval. Phase 13B remains
deferred unless measurements justify it.
