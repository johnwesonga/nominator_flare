import api
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import lustre/attribute
import lustre/effect
import lustre/element
import lustre/element/html
import lustre/event
import rsvp
import types.{
  type Candidate, type ChildBallot, ChildBallot, NotSubmitted, Submitted,
  Submitting, VotedFor,
}

// -----------------------------------------------------------------------------
// State
// -----------------------------------------------------------------------------

pub type State {
  Loading
  LoadingWithRoster(List(Candidate))
  LoadFailed(String)
  Ready(
    voting_open: Bool,
    children: List(ChildBallot),
    candidates: List(Candidate),
  )
}

// -----------------------------------------------------------------------------
// Messages
// -----------------------------------------------------------------------------

pub type Msg {
  GotFamilyBallot(Result(List(api.FamilyBallotRow), rsvp.Error(String)))
  GotRoster(Result(List(Candidate), rsvp.Error(String)))

  ChildSearchInput(swimmer_id: String, text: String)

  ChildPickCandidate(swimmer_id: String, candidate: Candidate)
  ChildSubmit(swimmer_id: String)

  VoteResult(swimmer_id: String, result: Result(String, rsvp.Error(String)))
}

// -----------------------------------------------------------------------------
// Initialisation
// -----------------------------------------------------------------------------

pub fn init(token: String) -> #(State, effect.Effect(Msg)) {
  let ballot_effect = api.get_family_ballot(token, GotFamilyBallot)

  let roster_effect = api.get_roster(token, GotRoster)

  #(
    Loading,
    effect.batch([
      ballot_effect,
      roster_effect,
    ]),
  )
}

// -----------------------------------------------------------------------------
// Update
// -----------------------------------------------------------------------------

pub fn update(
  state: State,
  token: String,
  msg: Msg,
) -> #(State, effect.Effect(Msg)) {
  case msg {
    GotFamilyBallot(result) -> got_family_ballot(state, result)
    GotRoster(roster_result) -> got_roster(state, roster_result)
    ChildSearchInput(swimmer_id:, text:) ->
      update_child(state, swimmer_id, fn(child) {
        ChildBallot(..child, search_text: text, selected_candidate: None)
      })
    ChildPickCandidate(swimmer_id:, candidate:) ->
      update_child(state, swimmer_id, fn(child) {
        ChildBallot(
          ..child,
          search_text: candidate.name,
          selected_candidate: Some(candidate),
        )
      })
    ChildSubmit(swimmer_id:) -> submit_child_vote(state, token, swimmer_id)
    VoteResult(swimmer_id:, result:) -> vote_result(state, swimmer_id, result)
  }
}

// -----------------------------------------------------------------------------
// Family ballot response
// -----------------------------------------------------------------------------

fn got_family_ballot(
  state: State,
  ballot_result: Result(List(api.FamilyBallotRow), rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case ballot_result {
    Ok([]) -> #(
      LoadFailed(
        "That link isn't valid. Contact your team manager for a new one.",
      ),
      effect.none(),
    )
    Ok(rows) -> {
      let voting_open =
        rows
        |> list.first
        |> result.map(fn(row) { row.voting_open })
        |> result.unwrap(False)

      let children =
        rows
        |> list.map(fn(row) {
          let status = case row.has_voted, row.voted_for_name {
            True, Some(candidate_name) -> VotedFor(candidate_name)
            True, None -> Submitted("Vote recorded — thank you!")
            False, _ -> NotSubmitted
          }

          ChildBallot(
            swimmer_id: row.swimmer_id,
            swimmer_name: row.swimmer_name,
            has_voted: row.has_voted,
            search_text: "",
            selected_candidate: option.None,
            status: status,
          )
        })

      let candidates = case state {
        Ready(_, _, candidates) -> candidates
        LoadingWithRoster(candidates) -> candidates
        _ -> []
      }

      #(
        Ready(
          voting_open: voting_open,
          children: children,
          candidates: candidates,
        ),
        effect.none(),
      )
    }
    Error(_) -> #(
      LoadFailed("Something went wrong loading your ballot. Please try again."),
      effect.none(),
    )
  }
}

// -----------------------------------------------------------------------------
// Candidate roster response
// -----------------------------------------------------------------------------

fn got_roster(
  state: State,
  roster_result: Result(List(Candidate), rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case roster_result {
    Ok(candidates) ->
      case state {
        Ready(voting_open, children, _) -> #(
          Ready(
            voting_open: voting_open,
            children: children,
            candidates: candidates,
          ),
          effect.none(),
        )

        Loading -> #(LoadingWithRoster(candidates), effect.none())

        _ -> #(state, effect.none())
      }
    Error(_) -> #(
      LoadFailed(
        "Something went wrong loading the candidate roster. Please try again.",
      ),
      effect.none(),
    )
  }
}

// -----------------------------------------------------------------------------
// Submit vote
// -----------------------------------------------------------------------------

fn submit_child_vote(
  state: State,
  token: String,
  swimmer_id: String,
) -> #(State, effect.Effect(Msg)) {
  case state {
    Ready(voting_open, children, candidates) ->
      case find_child(children, swimmer_id) {
        Some(child) ->
          case child.selected_candidate {
            Some(candidate) -> {
              let new_children =
                children
                |> list.map(fn(current) {
                  case current.swimmer_id == swimmer_id {
                    True -> ChildBallot(..current, status: Submitting)

                    False -> current
                  }
                })

              let request =
                api.cast_vote(token, swimmer_id, candidate.id, fn(result) {
                  VoteResult(swimmer_id: swimmer_id, result: result)
                })

              #(
                Ready(
                  voting_open: voting_open,
                  children: new_children,
                  candidates: candidates,
                ),
                request,
              )
            }
            None -> #(state, effect.none())
          }

        None -> #(state, effect.none())
      }

    _ -> #(state, effect.none())
  }
}

// -----------------------------------------------------------------------------
// Vote result
// -----------------------------------------------------------------------------

fn vote_result(
  state: State,
  swimmer_id: String,
  result: Result(String, rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case result {
    Ok("ok") ->
      update_child(state, swimmer_id, fn(child) {
        case child.selected_candidate {
          Some(candidate) ->
            ChildBallot(
              ..child,
              status: VotedFor(candidate.name),
              has_voted: True,
            )
          None ->
            ChildBallot(
              ..child,
              status: Submitted("Vote recorded — thank you!"),
              has_voted: True,
            )
        }
      })
    _ -> vote_error_result(state, swimmer_id, result)
  }
}

fn vote_error_result(
  state: State,
  swimmer_id: String,
  result: Result(String, rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  let message = case result {
    Ok("already_voted") -> "This swimmer already has a vote recorded."

    Ok("voting_closed") ->
      "Voting just closed — sorry, this vote couldn't be recorded."

    Ok("not_your_child") ->
      "This link isn't authorized to vote for that swimmer."

    Ok("invalid_candidate") -> "That selection wasn't valid — please try again."

    Ok(other) ->
      "Something went wrong ("
      <> other
      <> "). Please contact your team manager."

    Error(_) -> "Network error — please try again."
  }

  update_child(state, swimmer_id, fn(child) {
    ChildBallot(..child, status: Submitted(message))
  })
}

// -----------------------------------------------------------------------------
// Child state helpers
// -----------------------------------------------------------------------------

fn update_child(
  state: State,
  swimmer_id: String,
  update: fn(ChildBallot) -> ChildBallot,
) -> #(State, effect.Effect(Msg)) {
  case state {
    Ready(voting_open, children, candidates) -> {
      let new_children =
        children
        |> list.map(fn(child) {
          case child.swimmer_id == swimmer_id {
            True -> update(child)

            False -> child
          }
        })

      #(
        Ready(
          voting_open: voting_open,
          children: new_children,
          candidates: candidates,
        ),
        effect.none(),
      )
    }

    _ -> #(state, effect.none())
  }
}

fn find_child(
  children: List(ChildBallot),
  swimmer_id: String,
) -> option.Option(ChildBallot) {
  children
  |> list.find(fn(child) { child.swimmer_id == swimmer_id })
  |> option.from_result
}

// -- VIEWS

pub fn view(state: State) -> element.Element(Msg) {
  html.div(
    [
      attribute.id("view-parent"),
      attribute.class("view active"),
    ],
    [
      html.div([attribute.class("ballot-intro")], [
        html.h1([], [
          html.text("Vote: Most Inspirational Swimmer"),
        ]),

        html.p([], [
          html.text(
            "One vote per swimmer below — you're welcome to nominate your own child. ",
          ),
          html.strong([], [
            html.text("Votes can't be changed once submitted"),
          ]),
          html.text(", so take your time on each one."),
        ]),
      ]),
      // ballot lanes go here
      case state {
        Loading ->
          html.p([], [
            html.text("Loading your ballot..."),
          ])

        LoadingWithRoster(_) ->
          html.p([], [
            html.text("Loading your ballot..."),
          ])

        LoadFailed(message) ->
          html.p([attribute.class("error")], [html.text(message)])

        Ready(voting_open, children, candidates) ->
          html.div(
            [],
            list.index_map(children, fn(child, index) {
              view_child_ballot(voting_open, candidates, child, index + 1)
            }),
          )
      },
    ],
  )
}

// -----------------------------------------------------------------------------
// Child ballot view
// -----------------------------------------------------------------------------

fn view_child_ballot(
  voting_open: Bool,
  candidates: List(Candidate),
  child: ChildBallot,
  lane_number: Int,
) -> element.Element(Msg) {
  let status_view = case child.status {
    Submitted(_) | VotedFor(_) ->
      html.span([attribute.class("status-pill submitted")], [
        html.text("Submitted"),
      ])

    Submitting ->
      html.span([attribute.class("status-pill submitting")], [
        html.text("Submitting..."),
      ])

    NotSubmitted ->
      html.span([attribute.class("status-pill open")], [
        html.text("Not yet submitted"),
      ])
  }

  html.div(
    [
      attribute.class("lane"),
      attribute.attribute("data-lane", int.to_string(lane_number)),
    ],
    [
      html.div([attribute.class("lane-number")], [
        html.span([], [
          html.text(int.to_string(lane_number)),
        ]),
      ]),

      html.div([attribute.class("lane-head")], [
        html.div([], [
          html.span([attribute.class("eyebrow")], [html.text("Vote for")]),

          html.h2([], [
            html.text(child.swimmer_name),
          ]),
        ]),

        status_view,
      ]),

      case child.status {
        VotedFor(candidate_name) -> view_recorded_vote(candidate_name)

        Submitted(message) ->
          html.div([attribute.class("submitted-message")], [
            html.p([attribute.class("success")], [html.text(message)]),
          ])

        Submitting ->
          html.div([attribute.class("submitting-message")], [
            html.p([], [
              html.text("Submitting your vote..."),
            ]),
          ])

        NotSubmitted ->
          case voting_open {
            False ->
              html.div([attribute.class("voting-closed")], [
                html.p([], [
                  html.text("Voting is currently closed."),
                ]),
              ])

            True -> view_voting_controls(candidates, child)
          }
      },
    ],
  )
}

fn view_recorded_vote(candidate_name: String) -> element.Element(Msg) {
  html.div([attribute.class("voted-row")], [
    html.div([attribute.class("check")], [html.text("✓")]),
    html.div([attribute.class("txt")], [
      html.text("Voted for "),
      html.b([], [html.text(candidate_name)]),
      html.text(" — thank you! This can't be changed."),
    ]),
  ])
}

fn view_voting_controls(
  candidates: List(Candidate),
  child: ChildBallot,
) -> element.Element(Msg) {
  let matching_candidates =
    candidates
    |> list.filter(fn(candidate) {
      let search = string.lowercase(child.search_text)
      let name = string.lowercase(candidate.name)

      string.contains(name, search)
    })
    |> list.take(8)

  let show_autocomplete =
    child.search_text != "" && child.selected_candidate == None

  html.div([], [
    html.div([attribute.class("search-wrap")], [
      html.input([
        attribute.type_("text"),
        attribute.placeholder("Start typing a teammate's name..."),
        attribute.value(child.search_text),
        event.on_input(fn(value) {
          ChildSearchInput(swimmer_id: child.swimmer_id, text: value)
        }),
      ]),

      case show_autocomplete {
        True ->
          html.div(
            [attribute.class("autocomplete")],
            list.map(matching_candidates, fn(candidate) {
              html.button(
                [
                  attribute.class("opt"),
                  attribute.type_("button"),
                  event.on_click(ChildPickCandidate(
                    swimmer_id: child.swimmer_id,
                    candidate: candidate,
                  )),
                ],
                [
                  html.span([], [
                    html.text(candidate.name),
                  ]),
                ],
              )
            }),
          )

        False -> html.text("")
      },
    ]),

    html.div([attribute.class("lane-foot")], [
      html.span([attribute.class("hint")], [
        html.text("Start typing a teammate's name to search the roster."),
      ]),

      html.button(
        [
          attribute.class("btn btn-primary"),
          attribute.disabled(child.selected_candidate == None),
          event.on_click(ChildSubmit(swimmer_id: child.swimmer_id)),
        ],
        [html.text("Submit this vote")],
      ),
    ]),
  ])
}
