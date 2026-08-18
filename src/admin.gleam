import api
import app_timer
import clipboard
import gleam/int
import gleam/list
import gleam/option.{None, Some}
import gleam/result
import gleam/string
import gleam/uri
import lustre/attribute
import lustre/effect
import lustre/element
import lustre/element/html
import lustre/event
import modem
import rsvp
import types.{
  type AdminFamily, type AdminRow, type AdminSwimmer, type ResultRow,
  AdminFamily, AdminRow, AdminSwimmer,
}

pub type ManagementMode {
  ManagementIdle
  NewFamily
  EditFamily(String)
  NewSwimmer(String)
  EditSwimmer(String)
  ConfirmDeleteFamily(String, String)
  ConfirmDeleteSwimmer(String, String)
}

pub type ManagementForm {
  ManagementForm(
    mode: ManagementMode,
    email: String,
    swimmer_name: String,
    group_name: String,
  )
}

pub type State {
  Inactive
  LoadingSession
  SessionFailed
  LoadingDashboard(email: String)
  LoggedIn(
    email: String,
    roster: List(AdminRow),
    results: List(ResultRow),
    families: List(AdminFamily),
    management: ManagementForm,
    notice: option.Option(String),
    filter_text: String,
    busy: Bool,
  )
}

pub type Msg {
  SessionLoaded(Result(api.AdminSession, rsvp.Error(String)))
  RetrySession
  Logout
  GotRoster(Result(List(AdminRow), rsvp.Error(String)))
  GotResults(Result(List(ResultRow), rsvp.Error(String)))
  GotFamilies(Result(List(AdminFamily), rsvp.Error(String)))
  FilterInput(String)
  Refresh
  SetVoting(Bool)
  VotingUpdated(Bool, Result(Nil, rsvp.Error(String)))
  NotifyParents
  ParentsNotified(Result(api.NotificationCampaign, rsvp.Error(String)))
  PollCampaign(String)
  CampaignUpdated(Result(api.NotificationCampaign, rsvp.Error(String)))
  StartNewFamily
  StartEditFamily(AdminFamily)
  StartNewSwimmer(String)
  StartEditSwimmer(AdminSwimmer)
  ManagementEmailInput(String)
  ManagementNameInput(String)
  ManagementGroupInput(String)
  CancelManagement
  SubmitManagement
  ManagementFinished(Result(Nil, rsvp.Error(String)))
  AskDeleteFamily(AdminFamily)
  AskDeleteSwimmer(AdminSwimmer)
  CopyFamilyLink(String)
  FamilyLinkCopied(Bool)
}

pub fn init(active: Bool) -> #(State, effect.Effect(Msg)) {
  case active {
    True -> #(LoadingSession, api.get_admin_session(SessionLoaded))
    False -> #(Inactive, effect.none())
  }
}

pub fn update(state: State, msg: Msg) -> #(State, effect.Effect(Msg)) {
  case msg {
    SessionLoaded(result) ->
      case result {
        Ok(api.AdminSession(email)) -> #(
          LoadingDashboard(email),
          load_dashboard(),
        )
        Error(_) -> #(SessionFailed, effect.none())
      }
    RetrySession -> #(LoadingSession, api.get_admin_session(SessionLoaded))
    Logout -> {
      let assert Ok(logout_uri) = uri.parse("/api/access/logout")
      #(state, modem.load(logout_uri))
    }
    GotRoster(result) -> got_roster(state, result)
    GotResults(result) -> got_results(state, result)
    GotFamilies(result) -> got_families(state, result)
    FilterInput(text) ->
      case state {
        LoggedIn(email, roster, results, families, management, notice, _, busy) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice:,
            filter_text: text,
            busy:,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
    Refresh ->
      case state {
        LoggedIn(
          email,
          roster,
          results,
          families,
          management,
          _,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice: None,
            filter_text:,
            busy: True,
          ),
          load_dashboard(),
        )
        _ -> #(state, effect.none())
      }
    SetVoting(open) ->
      case state {
        LoggedIn(
          email,
          roster,
          results,
          families,
          management,
          _,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice: None,
            filter_text:,
            busy: True,
          ),
          api.set_voting_open(open, fn(result) { VotingUpdated(open, result) }),
        )
        _ -> #(state, effect.none())
      }
    VotingUpdated(open, result) ->
      finish_action(state, result, case open {
        True -> "Voting is open."
        False -> "Voting is closed."
      })
    NotifyParents ->
      case state {
        LoggedIn(
          email,
          roster,
          results,
          families,
          management,
          _,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice: None,
            filter_text:,
            busy: True,
          ),
          api.notify_parents(ParentsNotified),
        )
        _ -> #(state, effect.none())
      }
    ParentsNotified(result) -> update_campaign(state, result)
    PollCampaign(campaign_id) -> #(
      state,
      api.get_notification_campaign(campaign_id, CampaignUpdated),
    )
    CampaignUpdated(result) -> update_campaign(state, result)
    StartNewFamily ->
      set_management(state, ManagementForm(NewFamily, "", "", ""))
    StartEditFamily(family) ->
      set_management(
        state,
        ManagementForm(EditFamily(family.id), family.email, "", ""),
      )
    StartNewSwimmer(family_id) ->
      set_management(state, ManagementForm(NewSwimmer(family_id), "", "", ""))
    StartEditSwimmer(swimmer) ->
      set_management(
        state,
        ManagementForm(
          EditSwimmer(swimmer.id),
          "",
          swimmer.name,
          option.unwrap(swimmer.group_name, ""),
        ),
      )
    ManagementEmailInput(value) ->
      update_management(state, fn(form) { ManagementForm(..form, email: value) })
    ManagementNameInput(value) ->
      update_management(state, fn(form) {
        ManagementForm(..form, swimmer_name: value)
      })
    ManagementGroupInput(value) ->
      update_management(state, fn(form) {
        ManagementForm(..form, group_name: value)
      })
    CancelManagement -> set_management(state, new_management())
    SubmitManagement -> submit_management(state)
    ManagementFinished(result) -> management_finished(state, result)
    AskDeleteFamily(family) ->
      set_management(
        state,
        ManagementForm(ConfirmDeleteFamily(family.id, family.email), "", "", ""),
      )
    AskDeleteSwimmer(swimmer) ->
      set_management(
        state,
        ManagementForm(
          ConfirmDeleteSwimmer(swimmer.id, swimmer.name),
          "",
          "",
          "",
        ),
      )
    CopyFamilyLink(token) -> #(
      state,
      clipboard.write("/vote/" <> token, FamilyLinkCopied),
    )
    FamilyLinkCopied(success) ->
      set_notice(state, case success {
        True -> "Voting link copied."
        False -> "The voting link could not be copied."
      })
  }
}

fn new_management() -> ManagementForm {
  ManagementForm(ManagementIdle, "", "", "")
}

fn set_management(
  state: State,
  management: ManagementForm,
) -> #(State, effect.Effect(Msg)) {
  case state {
    LoggedIn(email, roster, results, families, _, notice, filter_text, busy) -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management:,
        notice:,
        filter_text:,
        busy:,
      ),
      effect.none(),
    )
    _ -> #(state, effect.none())
  }
}

fn update_management(
  state: State,
  update_form: fn(ManagementForm) -> ManagementForm,
) -> #(State, effect.Effect(Msg)) {
  case state {
    LoggedIn(
      email,
      roster,
      results,
      families,
      management,
      notice,
      filter_text,
      busy,
    ) -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management: update_form(management),
        notice:,
        filter_text:,
        busy:,
      ),
      effect.none(),
    )
    _ -> #(state, effect.none())
  }
}

fn submit_management(state: State) -> #(State, effect.Effect(Msg)) {
  case state {
    LoggedIn(management: ManagementForm(mode: ManagementIdle, ..), ..) -> #(
      state,
      effect.none(),
    )
    LoggedIn(email, roster, results, families, management, _, filter_text, _) -> {
      let ManagementForm(mode, family_email, swimmer_name, group_name) =
        management
      let group = case string.trim(group_name) {
        "" -> None
        value -> Some(value)
      }
      let action = case mode {
        ManagementIdle -> effect.none()
        NewFamily -> api.create_family(family_email, ManagementFinished)
        EditFamily(id) ->
          api.update_family(id, family_email, ManagementFinished)
        NewSwimmer(family_id) ->
          api.create_swimmer(family_id, swimmer_name, group, ManagementFinished)
        EditSwimmer(id) ->
          api.update_swimmer(id, swimmer_name, group, ManagementFinished)
        ConfirmDeleteFamily(id, _) -> api.delete_family(id, ManagementFinished)
        ConfirmDeleteSwimmer(id, _) ->
          api.delete_swimmer(id, ManagementFinished)
      }
      #(
        LoggedIn(
          email:,
          roster:,
          results:,
          families:,
          management:,
          notice: None,
          filter_text:,
          busy: True,
        ),
        action,
      )
    }
    _ -> #(state, effect.none())
  }
}

fn management_finished(
  state: State,
  result: Result(Nil, rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case state, result {
    LoggedIn(email, roster, results, families, _, _, filter_text, _), Ok(_) -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management: new_management(),
        notice: Some("Family management changes saved."),
        filter_text:,
        busy: True,
      ),
      load_dashboard(),
    )
    LoggedIn(email, roster, results, families, management, _, filter_text, _),
      Error(_)
    -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management:,
        notice: Some(
          "The change could not be saved. Check for duplicate emails, swimmers, or existing votes.",
        ),
        filter_text:,
        busy: False,
      ),
      effect.none(),
    )
    _, _ -> #(state, effect.none())
  }
}

fn set_notice(state: State, message: String) -> #(State, effect.Effect(Msg)) {
  case state {
    LoggedIn(email, roster, results, families, management, _, filter_text, busy) -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management:,
        notice: Some(message),
        filter_text:,
        busy:,
      ),
      effect.none(),
    )
    _ -> #(state, effect.none())
  }
}

fn load_dashboard() -> effect.Effect(Msg) {
  effect.batch([
    api.get_admin_roster(GotRoster),
    api.get_results(GotResults),
    api.get_admin_families(GotFamilies),
  ])
}

fn got_roster(
  state: State,
  response: Result(List(AdminRow), rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case response {
    Error(_) ->
      case state {
        LoadingDashboard(_) -> #(SessionFailed, effect.none())
        LoggedIn(
          email,
          roster,
          results,
          families,
          management,
          _,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice: Some("Refresh failed. Please try again."),
            filter_text:,
            busy: False,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
    Ok(loaded_roster) ->
      case state {
        LoadingDashboard(email) -> #(
          LoggedIn(
            email:,
            roster: loaded_roster,
            results: [],
            families: [],
            management: new_management(),
            notice: None,
            filter_text: "",
            busy: False,
          ),
          effect.none(),
        )
        LoggedIn(
          email,
          _,
          results,
          families,
          management,
          notice,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster: loaded_roster,
            results:,
            families:,
            management:,
            notice:,
            filter_text:,
            busy: False,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
  }
}

fn got_results(
  state: State,
  response: Result(List(ResultRow), rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case response {
    Error(_) ->
      case state {
        LoadingDashboard(_) -> #(SessionFailed, effect.none())
        LoggedIn(
          email,
          roster,
          results,
          families,
          management,
          _,
          filter_text,
          _,
        ) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice: Some("Refresh failed. Please try again."),
            filter_text:,
            busy: False,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
    Ok(results) ->
      case state {
        LoadingDashboard(email) -> #(
          LoggedIn(
            email:,
            roster: [],
            results:,
            families: [],
            management: new_management(),
            notice: None,
            filter_text: "",
            busy: False,
          ),
          effect.none(),
        )
        LoggedIn(email, roster, _, families, management, notice, filter_text, _) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice:,
            filter_text:,
            busy: False,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
  }
}

fn got_families(
  state: State,
  response: Result(List(AdminFamily), rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case response {
    Error(_) ->
      case state {
        LoadingDashboard(_) -> #(SessionFailed, effect.none())
        _ -> set_notice(state, "Family management could not be refreshed.")
      }
    Ok(families) ->
      case state {
        LoadingDashboard(email) -> #(
          LoggedIn(
            email:,
            roster: [],
            results: [],
            families:,
            management: new_management(),
            notice: None,
            filter_text: "",
            busy: False,
          ),
          effect.none(),
        )
        LoggedIn(email, roster, results, _, management, notice, filter_text, _) -> #(
          LoggedIn(
            email:,
            roster:,
            results:,
            families:,
            management:,
            notice:,
            filter_text:,
            busy: False,
          ),
          effect.none(),
        )
        _ -> #(state, effect.none())
      }
  }
}

fn finish_action(
  state: State,
  result: Result(Nil, rsvp.Error(String)),
  success: String,
) {
  case state {
    LoggedIn(email, roster, results, families, management, _, filter_text, _) -> {
      let notice = case result {
        Ok(_) -> success
        Error(_) -> "The action failed. Please try again."
      }
      #(
        LoggedIn(
          email:,
          roster:,
          results:,
          families:,
          management:,
          notice: Some(notice),
          filter_text:,
          busy: False,
        ),
        effect.none(),
      )
    }
    _ -> #(state, effect.none())
  }
}

fn update_campaign(
  state: State,
  result: Result(api.NotificationCampaign, rsvp.Error(String)),
) -> #(State, effect.Effect(Msg)) {
  case state, result {
    LoggedIn(email, roster, results, families, management, _, filter_text, _),
      Ok(campaign)
    -> {
      let notice = campaign_notice(campaign)
      let next = case campaign.status {
        "queued" | "sending" -> app_timer.after(2000, PollCampaign(campaign.id))
        _ -> effect.none()
      }
      #(
        LoggedIn(
          email:,
          roster:,
          results:,
          families:,
          management:,
          notice: Some(notice),
          filter_text:,
          busy: False,
        ),
        next,
      )
    }
    LoggedIn(email, roster, results, families, management, _, filter_text, _),
      Error(_)
    -> #(
      LoggedIn(
        email:,
        roster:,
        results:,
        families:,
        management:,
        notice: Some("Notification progress could not be loaded."),
        filter_text:,
        busy: False,
      ),
      effect.none(),
    )
    _, _ -> #(state, effect.none())
  }
}

fn campaign_notice(campaign: api.NotificationCampaign) -> String {
  let summary =
    int.to_string(campaign.sent)
    <> " sent, "
    <> int.to_string(campaign.queued)
    <> " queued, "
    <> int.to_string(campaign.failed)
    <> " failed out of "
    <> int.to_string(campaign.total)

  case campaign.status {
    "completed" -> "Parent notifications complete: " <> summary <> "."
    "failed" ->
      "Parent notifications finished with failures: " <> summary <> "."
    _ -> "Parent notifications in progress: " <> summary <> "."
  }
}

pub fn view(state: State) -> element.Element(Msg) {
  html.div([attribute.id("view-admin"), attribute.class("view active")], [
    case state {
      Inactive -> html.text("")
      LoadingSession -> html.p([], [html.text("Checking admin access...")])
      SessionFailed -> view_session_failed()
      LoadingDashboard(_) -> html.p([], [html.text("Loading dashboard...")])
      LoggedIn(
        email,
        roster,
        results,
        families,
        management,
        notice,
        filter_text,
        busy,
      ) ->
        view_dashboard(
          email,
          roster,
          results,
          families,
          management,
          notice,
          filter_text,
          busy,
        )
    },
  ])
}

fn view_session_failed() {
  html.section([attribute.class("panel admin-login")], [
    html.h1([], [html.text("Admin access unavailable")]),
    html.p([], [
      html.text(
        "Cloudflare Access could not verify this session or the dashboard failed to load.",
      ),
    ]),
    html.button(
      [attribute.class("btn btn-primary"), event.on_click(RetrySession)],
      [html.text("Try again")],
    ),
  ])
}

fn view_dashboard(
  email: String,
  roster: List(AdminRow),
  results: List(ResultRow),
  families: List(AdminFamily),
  management: ManagementForm,
  notice: option.Option(String),
  filter_text: String,
  busy: Bool,
) {
  let filtered =
    list.filter(roster, fn(row) {
      let query = string.lowercase(filter_text)
      string.contains(string.lowercase(row.swimmer_name), query)
      || string.contains(string.lowercase(row.family_email), query)
      || string.contains(
        string.lowercase(option.unwrap(row.group_name, "")),
        query,
      )
    })
  html.div([], [
    html.div([attribute.class("admin-head")], [
      html.div([], [
        html.h1([], [html.text("Admin dashboard")]),
        html.span([attribute.class("sub")], [
          html.text(
            int.to_string(list.length(roster)) <> " swimmers · " <> email,
          ),
        ]),
      ]),
      html.button(
        [
          attribute.class("btn btn-ghost"),
          event.on_click(Logout),
        ],
        [
          html.text("Sign out"),
        ],
      ),
    ]),
    html.div([attribute.class("controls")], [
      html.button(
        [
          attribute.class("btn btn-primary"),
          attribute.disabled(busy),
          event.on_click(SetVoting(True)),
        ],
        [html.text("Open voting")],
      ),
      html.button(
        [
          attribute.class("btn btn-ghost"),
          attribute.disabled(busy),
          event.on_click(SetVoting(False)),
        ],
        [html.text("Close voting")],
      ),
      html.button(
        [
          attribute.class("btn btn-ghost"),
          attribute.disabled(busy),
          event.on_click(NotifyParents),
        ],
        [html.text("Email all parents")],
      ),
      html.button(
        [
          attribute.class("btn btn-ghost"),
          attribute.disabled(busy),
          event.on_click(Refresh),
        ],
        [html.text("Refresh")],
      ),
    ]),
    case notice {
      Some(message) ->
        html.p([attribute.class("admin-notice")], [html.text(message)])
      None -> html.text("")
    },
    view_results(results),
    view_family_management(families, management, busy),
    html.section([attribute.class("panel")], [
      html.h3([], [html.text("Roster")]),
      html.input([
        attribute.class("roster-search"),
        attribute.type_("search"),
        attribute.placeholder("Search swimmer, family, or group..."),
        attribute.value(filter_text),
        event.on_input(FilterInput),
      ]),
      html.div([attribute.class("table-wrap")], [
        html.table([attribute.class("roster")], [
          html.thead([], [
            html.tr([], [
              html.th([], [html.text("Swimmer")]),
              html.th([], [html.text("Group")]),
              html.th([], [html.text("Family")]),
              html.th([], [html.text("Voted?")]),
            ]),
          ]),
          html.tbody([], list.map(filtered, view_roster_row)),
        ]),
      ]),
    ]),
  ])
}

fn view_results(results: List(ResultRow)) {
  let leaders = list.filter(results, fn(row) { row.vote_count > 0 })
  let max_votes =
    results
    |> list.first
    |> result.map(fn(row) { row.vote_count })
    |> result.unwrap(0)
  html.section([attribute.class("panel")], [
    html.h3([], [html.text("Results")]),
    case leaders {
      [] -> html.p([], [html.text("No votes have been recorded yet.")])
      _ ->
        html.div(
          [],
          list.index_map(leaders, fn(row, index) {
            let width = case max_votes > 0 {
              True -> row.vote_count * 100 / max_votes
              False -> 0
            }
            html.div(
              [
                attribute.class(case index == 0 {
                  True -> "leaderboard-row top"
                  False -> "leaderboard-row"
                }),
              ],
              [
                html.span([attribute.class("rank")], [
                  html.text(int.to_string(index + 1)),
                ]),
                html.span([attribute.class("cand-name")], [
                  html.text(row.candidate_name),
                ]),
                html.div([attribute.class("bar-track")], [
                  html.div(
                    [
                      attribute.class("bar-fill"),
                      attribute.style("width", int.to_string(width) <> "%"),
                    ],
                    [],
                  ),
                ]),
                html.span([attribute.class("vote-count")], [
                  html.text(int.to_string(row.vote_count)),
                ]),
              ],
            )
          }),
        )
    },
  ])
}

fn view_family_management(
  families: List(AdminFamily),
  management: ManagementForm,
  busy: Bool,
) {
  html.section([attribute.class("panel family-management")], [
    html.div([attribute.class("family-management-head")], [
      html.div([], [
        html.h3([], [html.text("Families")]),
        html.p([], [
          html.text(
            int.to_string(list.length(families))
            <> " families. IDs and private voting tokens are generated automatically.",
          ),
        ]),
      ]),
      html.button(
        [
          attribute.class("btn btn-primary"),
          attribute.disabled(busy),
          event.on_click(StartNewFamily),
        ],
        [html.text("Add family")],
      ),
    ]),
    view_management_form(management, busy),
    case families {
      [] -> html.p([], [html.text("No families have been added yet.")])
      _ ->
        html.div(
          [attribute.class("family-list")],
          list.map(families, fn(family) { view_family(family, busy) }),
        )
    },
  ])
}

fn view_management_form(form: ManagementForm, busy: Bool) {
  let ManagementForm(mode, email, swimmer_name, group_name) = form
  case mode {
    ManagementIdle -> html.text("")
    _ -> {
      let title = case mode {
        ManagementIdle -> ""
        NewFamily -> "Add family"
        EditFamily(_) -> "Edit family"
        NewSwimmer(_) -> "Add swimmer"
        EditSwimmer(_) -> "Edit swimmer"
        ConfirmDeleteFamily(_, _) -> "Confirm family deletion"
        ConfirmDeleteSwimmer(_, _) -> "Confirm swimmer deletion"
      }
      html.div([attribute.class("management-form")], [
        html.h4([], [html.text(title)]),
        case mode {
          ManagementIdle -> html.text("")
          NewFamily | EditFamily(_) ->
            html.label([], [
              html.text("Parent or family email"),
              html.input([
                attribute.type_("email"),
                attribute.value(email),
                attribute.autocomplete("email"),
                attribute.disabled(busy),
                event.on_input(ManagementEmailInput),
              ]),
            ])
          NewSwimmer(_) | EditSwimmer(_) ->
            html.div([attribute.class("management-fields")], [
              html.label([], [
                html.text("Swimmer name"),
                html.input([
                  attribute.type_("text"),
                  attribute.value(swimmer_name),
                  attribute.disabled(busy),
                  event.on_input(ManagementNameInput),
                ]),
              ]),
              html.label([], [
                html.text("Group (optional)"),
                html.input([
                  attribute.type_("text"),
                  attribute.value(group_name),
                  attribute.disabled(busy),
                  event.on_input(ManagementGroupInput),
                ]),
              ]),
            ])
          ConfirmDeleteFamily(_, family_email) ->
            html.p([], [
              html.text(
                "Delete "
                <> family_email
                <> "? This is allowed only after every swimmer is removed.",
              ),
            ])
          ConfirmDeleteSwimmer(_, name) ->
            html.p([], [
              html.text(
                "Delete "
                <> name
                <> "? A swimmer referenced by any vote cannot be removed.",
              ),
            ])
        },
        html.div([attribute.class("management-actions")], [
          html.button(
            [
              attribute.class("btn btn-primary"),
              attribute.disabled(busy),
              event.on_click(SubmitManagement),
            ],
            [
              html.text(case mode {
                ConfirmDeleteFamily(_, _) | ConfirmDeleteSwimmer(_, _) ->
                  "Confirm delete"
                _ -> "Save"
              }),
            ],
          ),
          html.button(
            [
              attribute.class("btn btn-ghost"),
              attribute.disabled(busy),
              event.on_click(CancelManagement),
            ],
            [html.text("Cancel")],
          ),
        ]),
      ])
    }
  }
}

fn view_family(family: AdminFamily, busy: Bool) {
  let AdminFamily(..) = family
  html.article([attribute.class("family-card")], [
    html.div([attribute.class("family-card-head")], [
      html.div([], [
        html.h4([], [html.text(family.email)]),
        html.span([attribute.class("sub")], [
          html.text(int.to_string(list.length(family.swimmers)) <> " swimmers"),
        ]),
      ]),
      html.div([attribute.class("family-actions")], [
        html.button(
          [
            attribute.class("btn btn-ghost btn-small"),
            attribute.disabled(busy),
            event.on_click(StartEditFamily(family)),
          ],
          [html.text("Edit")],
        ),
        html.button(
          [
            attribute.class("btn btn-ghost btn-small"),
            attribute.disabled(busy || !list.is_empty(family.swimmers)),
            attribute.title(case family.swimmers {
              [] -> "Delete this empty family"
              _ -> "Remove every swimmer before deleting this family"
            }),
            event.on_click(AskDeleteFamily(family)),
          ],
          [html.text("Delete")],
        ),
      ]),
    ]),
    html.div([attribute.class("family-link")], [
      html.input([
        attribute.type_("text"),
        attribute.readonly(True),
        attribute.value("/vote/" <> family.family_token),
        attribute.aria_label("Private family voting path"),
      ]),
      html.button(
        [
          attribute.class("btn btn-ghost btn-small"),
          attribute.disabled(busy),
          event.on_click(CopyFamilyLink(family.family_token)),
        ],
        [html.text("Copy link")],
      ),
    ]),
    html.div([attribute.class("family-swimmers")], [
      case family.swimmers {
        [] -> html.p([], [html.text("No swimmers in this family.")])
        swimmers ->
          html.ul(
            [],
            list.map(swimmers, fn(swimmer) {
              view_managed_swimmer(swimmer, busy)
            }),
          )
      },
      html.button(
        [
          attribute.class("btn btn-ghost btn-small"),
          attribute.disabled(busy),
          event.on_click(StartNewSwimmer(family.id)),
        ],
        [html.text("Add swimmer")],
      ),
    ]),
  ])
}

fn view_managed_swimmer(swimmer: AdminSwimmer, busy: Bool) {
  let AdminSwimmer(..) = swimmer
  html.li([], [
    html.div([], [
      html.b([], [html.text(swimmer.name)]),
      html.span([attribute.class("sub")], [
        html.text(option.unwrap(swimmer.group_name, "No group")),
      ]),
    ]),
    html.div([attribute.class("family-actions")], [
      html.button(
        [
          attribute.class("btn btn-ghost btn-small"),
          attribute.disabled(busy),
          event.on_click(StartEditSwimmer(swimmer)),
        ],
        [html.text("Edit")],
      ),
      html.button(
        [
          attribute.class("btn btn-ghost btn-small"),
          attribute.disabled(busy || swimmer.has_voted),
          attribute.title(case swimmer.has_voted {
            True -> "A swimmer with a recorded vote cannot be deleted"
            False -> "Delete swimmer if no vote references them"
          }),
          event.on_click(AskDeleteSwimmer(swimmer)),
        ],
        [html.text("Delete")],
      ),
    ]),
  ])
}

fn view_roster_row(row: AdminRow) {
  let AdminRow(..) = row
  html.tr([], [
    html.td([], [html.text(row.swimmer_name)]),
    html.td([], [
      html.span([attribute.class("grp-tag")], [
        html.text(option.unwrap(row.group_name, "—")),
      ]),
    ]),
    html.td([], [html.text(row.family_email)]),
    html.td(
      [
        attribute.class(case row.has_voted {
          True -> "voted-yes"
          False -> "voted-no"
        }),
      ],
      [
        html.text(case row.has_voted {
          True -> "Yes"
          False -> "No"
        }),
      ],
    ),
  ])
}
