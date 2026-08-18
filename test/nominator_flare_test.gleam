import admin
import api
import family
import gleam/int
import gleam/json
import gleam/list
import gleam/option
import gleeunit
import rsvp
import types

pub fn main() -> Nil {
  gleeunit.main()
}

fn default_family_list() -> admin.FamilyListState {
  admin.FamilyListState("", admin.AllFamilies, 1, 20, option.None)
}

fn family_fixtures(count: Int) -> List(types.AdminFamily) {
  case count <= 0 {
    True -> []
    False -> family_fixtures_loop(1, count, []) |> list.reverse
  }
}

fn family_fixtures_loop(
  index: Int,
  count: Int,
  fixtures: List(types.AdminFamily),
) -> List(types.AdminFamily) {
  case index > count {
    True -> fixtures
    False ->
      family_fixtures_loop(index + 1, count, [family_fixture(index), ..fixtures])
  }
}

fn family_fixture(index: Int) -> types.AdminFamily {
  let suffix = int.to_string(index)
  let swimmers = case index {
    1 -> []
    2 -> [swimmer_fixture(suffix <> "-1", False)]
    3 -> [
      swimmer_fixture(suffix <> "-1", True),
      swimmer_fixture(suffix <> "-2", False),
    ]
    _ -> [swimmer_fixture(suffix <> "-1", True)]
  }

  types.AdminFamily(
    id: "family-" <> suffix,
    email: "family-" <> suffix <> "@example.com",
    family_token: "token-" <> suffix,
    created_at: "2026-08-17T00:00:00.000Z",
    swimmers:,
  )
}

fn swimmer_fixture(suffix: String, has_voted: Bool) -> types.AdminSwimmer {
  types.AdminSwimmer(
    id: "swimmer-" <> suffix,
    name: "Swimmer " <> suffix,
    group_name: option.Some("Test group"),
    created_at: "2026-08-17T00:00:00.000Z",
    has_voted:,
  )
}

// gleeunit test functions end in `_test`
pub fn hello_world_test() {
  let name = "Joe"
  let greeting = "Hello, " <> name <> "!"

  assert greeting == "Hello, Joe!"
}

pub fn admin_session_decoder_test() {
  let result =
    json.parse(
      "{\"email\":\"manager@example.com\"}",
      api.admin_session_decoder(),
    )

  let assert Ok(api.AdminSession("manager@example.com")) = result
}

pub fn admin_session_decoder_rejects_missing_email_test() {
  let result = json.parse("{}", api.admin_session_decoder())

  let assert Error(_) = result
}

pub fn inactive_admin_does_not_start_session_test() {
  let #(state, _effect) = admin.init(False)

  let assert admin.Inactive = state
}

pub fn access_session_starts_dashboard_loading_test() {
  let #(state, _effect) =
    admin.update(
      admin.LoadingSession,
      admin.SessionLoaded(Ok(api.AdminSession("manager@example.com"))),
    )

  let assert admin.LoadingDashboard("manager@example.com") = state
}

pub fn failed_access_session_is_visible_test() {
  let #(state, _effect) =
    admin.update(
      admin.LoadingSession,
      admin.SessionLoaded(Error(rsvp.NetworkError)),
    )

  let assert admin.SessionFailed = state
}

pub fn notification_campaign_decoder_test() {
  let result =
    json.parse(
      "{\"id\":\"campaign-id\",\"status\":\"sending\",\"total\":4,\"queued\":2,\"sent\":1,\"failed\":1}",
      api.notification_campaign_decoder(),
    )

  let assert Ok(api.NotificationCampaign(
    id: "campaign-id",
    status: "sending",
    total: 4,
    queued: 2,
    sent: 1,
    failed: 1,
  )) = result
}

pub fn completed_notification_campaign_updates_admin_notice_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(admin.NewFamily, "", "", ""),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: True,
    )
  let campaign =
    api.NotificationCampaign(
      id: "campaign-id",
      status: "completed",
      total: 2,
      queued: 0,
      sent: 2,
      failed: 0,
    )
  let #(updated, _effect) =
    admin.update(state, admin.ParentsNotified(Ok(campaign)))

  let assert admin.LoggedIn(
    notice: option.Some(
      "Parent notifications complete: 2 sent, 0 queued, 0 failed out of 2.",
    ),
    busy: False,
    ..,
  ) = updated
}

pub fn family_ballot_decoder_test() {
  let result =
    json.parse(
      "[{\"swimmer_id\":\"swimmer-1\",\"swimmer_name\":\"Ada\",\"has_voted\":true,\"voting_open\":false,\"voted_for_name\":\"Grace\"}]",
      api.family_ballot_decoder(),
    )

  let assert Ok([
    api.FamilyBallotRow(
      swimmer_id: "swimmer-1",
      swimmer_name: "Ada",
      has_voted: True,
      voting_open: False,
      voted_for_name: option.Some("Grace"),
    ),
  ]) = result
}

pub fn roster_decoder_test() {
  let result =
    json.parse(
      "[{\"id\":\"candidate-1\",\"name\":\"Grace\"}]",
      api.roster_decoder(),
    )

  let assert Ok([types.Candidate("candidate-1", "Grace")]) = result
}

pub fn admin_roster_decoder_test() {
  let result =
    json.parse(
      "[{\"family_id\":\"family-1\",\"family_email\":\"parent@example.com\",\"family_token\":\"token-1\",\"swimmer_id\":\"swimmer-1\",\"swimmer_name\":\"Ada\",\"group_name\":null,\"has_voted\":false}]",
      api.admin_roster_decoder(),
    )

  let assert Ok([
    types.AdminRow(
      family_id: "family-1",
      family_email: "parent@example.com",
      family_token: "token-1",
      swimmer_id: "swimmer-1",
      swimmer_name: "Ada",
      group_name: option.None,
      has_voted: False,
    ),
  ]) = result
}

pub fn results_decoder_test() {
  let result =
    json.parse(
      "[{\"candidate_id\":\"candidate-1\",\"candidate_name\":\"Grace\",\"vote_count\":2}]",
      api.results_decoder(),
    )

  let assert Ok([types.ResultRow("candidate-1", "Grace", 2)]) = result
}

pub fn admin_family_decoder_includes_empty_and_nested_families_test() {
  let result =
    json.parse(
      "[{\"id\":\"family-1\",\"email\":\"parent@example.com\",\"family_token\":\"token-1\",\"created_at\":\"2026-08-15T00:00:00.000Z\",\"swimmers\":[{\"id\":\"swimmer-1\",\"name\":\"Ada\",\"group_name\":null,\"created_at\":\"2026-08-15T00:00:00.000Z\",\"has_voted\":false}]},{\"id\":\"family-2\",\"email\":\"empty@example.com\",\"family_token\":\"token-2\",\"created_at\":\"2026-08-15T00:00:00.000Z\",\"swimmers\":[]}]",
      types.admin_family_list_decoder(),
    )

  let assert Ok([
    types.AdminFamily(
      email: "parent@example.com",
      swimmers: [types.AdminSwimmer(name: "Ada", has_voted: False, ..)],
      ..,
    ),
    types.AdminFamily(email: "empty@example.com", swimmers: [], ..),
  ]) = result
}

pub fn admin_can_start_swimmer_management_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(admin.NewFamily, "", "", ""),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: False,
    )
  let #(updated, _effect) =
    admin.update(state, admin.StartNewSwimmer("family-id"))

  let assert admin.LoggedIn(
    management: admin.ManagementForm(
      mode: admin.NewSwimmer("family-id"),
      swimmer_name: "",
      ..,
    ),
    ..,
  ) = updated
}

pub fn family_management_initializes_idle_test() {
  let #(state, _effect) =
    admin.update(
      admin.LoadingDashboard("manager@example.com"),
      admin.GotFamilies(Ok([])),
    )

  let assert admin.LoggedIn(
    management: admin.ManagementForm(mode: admin.ManagementIdle, ..),
    family_list: admin.FamilyListState(
      query: "",
      filter: admin.AllFamilies,
      page: 1,
      page_size: 20,
      expanded_family_id: option.None,
    ),
    ..,
  ) = state
}

pub fn family_list_state_survives_refresh_test() {
  let family_list =
    admin.FamilyListState(
      "ada",
      admin.VotingInProgress,
      2,
      10,
      option.Some("family-3"),
    )
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: family_fixtures(40),
      management: admin.ManagementForm(admin.ManagementIdle, "", "", ""),
      family_list:,
      notice: option.Some("Previous notice"),
      filter_text: "",
      busy: False,
    )

  let #(updated, _effect) = admin.update(state, admin.Refresh)

  let assert admin.LoggedIn(
    family_list: updated_family_list,
    notice: option.None,
    busy: True,
    ..,
  ) = updated
  assert updated_family_list == family_list
}

pub fn family_list_state_survives_family_reload_test() {
  let family_list =
    admin.FamilyListState(
      "family-4",
      admin.VotingComplete,
      3,
      10,
      option.Some("family-4"),
    )
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(admin.ManagementIdle, "", "", ""),
      family_list:,
      notice: option.None,
      filter_text: "",
      busy: True,
    )

  let #(updated, _effect) =
    admin.update(state, admin.GotFamilies(Ok(family_fixtures(1))))

  let assert admin.LoggedIn(
    families: [types.AdminFamily(id: "family-1", ..)],
    family_list: updated_family_list,
    ..,
  ) = updated
  assert updated_family_list == family_list
}

pub fn family_list_state_survives_management_action_test() {
  let family_list =
    admin.FamilyListState(
      "search",
      admin.FamiliesWithoutSwimmers,
      1,
      20,
      option.None,
    )
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: family_fixtures(1),
      management: admin.ManagementForm(admin.ManagementIdle, "", "", ""),
      family_list:,
      notice: option.None,
      filter_text: "",
      busy: False,
    )

  let #(updated, _effect) = admin.update(state, admin.StartNewFamily)

  let assert admin.LoggedIn(
    management: admin.ManagementForm(mode: admin.NewFamily, ..),
    family_list: updated_family_list,
    ..,
  ) = updated
  assert updated_family_list == family_list
}

pub fn scalable_family_fixture_sizes_are_deterministic_test() {
  assert family_fixtures(0) == []
  assert list.length(family_fixtures(1)) == 1
  assert list.length(family_fixtures(40)) == 40
  assert list.length(family_fixtures(100)) == 100
}

pub fn scalable_family_fixtures_cover_voting_states_test() {
  let assert [first, second, third, fourth] = family_fixtures(4)
  let assert types.AdminFamily(_, _, _, _, []) = first
  let assert types.AdminFamily(
    _,
    _,
    _,
    _,
    [types.AdminSwimmer(_, _, _, _, False)],
  ) = second
  let assert types.AdminFamily(
    _,
    _,
    _,
    _,
    [
      types.AdminSwimmer(_, _, _, _, True),
      types.AdminSwimmer(_, _, _, _, False),
    ],
  ) = third
  let assert types.AdminFamily(
    _,
    _,
    _,
    _,
    [types.AdminSwimmer(_, _, _, _, True)],
  ) = fourth
}

pub fn add_family_opens_management_editor_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(admin.ManagementIdle, "", "", ""),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: False,
    )
  let #(updated, _effect) = admin.update(state, admin.StartNewFamily)

  let assert admin.LoggedIn(
    management: admin.ManagementForm(mode: admin.NewFamily, ..),
    ..,
  ) = updated
}

pub fn cancel_family_management_returns_to_idle_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(
        admin.EditFamily("family-id"),
        "parent@example.com",
        "",
        "",
      ),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: False,
    )
  let #(updated, _effect) = admin.update(state, admin.CancelManagement)

  let assert admin.LoggedIn(
    management: admin.ManagementForm(mode: admin.ManagementIdle, ..),
    ..,
  ) = updated
}

pub fn successful_family_management_returns_to_idle_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(
        admin.EditFamily("family-id"),
        "parent@example.com",
        "",
        "",
      ),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: True,
    )
  let #(updated, _effect) =
    admin.update(state, admin.ManagementFinished(Ok(Nil)))

  let assert admin.LoggedIn(
    management: admin.ManagementForm(mode: admin.ManagementIdle, ..),
    notice: option.Some("Family management changes saved."),
    ..,
  ) = updated
}

pub fn failed_family_management_keeps_editor_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(
        admin.EditFamily("family-id"),
        "parent@example.com",
        "",
        "",
      ),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: True,
    )
  let #(updated, _effect) =
    admin.update(state, admin.ManagementFinished(Error(rsvp.NetworkError)))

  let assert admin.LoggedIn(
    management: admin.ManagementForm(
      mode: admin.EditFamily("family-id"),
      email: "parent@example.com",
      ..,
    ),
    busy: False,
    ..,
  ) = updated
}

pub fn invalid_ballot_link_becomes_visible_failure_test() {
  let #(state, _effect) =
    family.update(
      family.Loading,
      "unused-token",
      family.GotFamilyBallot(Ok([])),
    )

  let assert family.LoadFailed(
    "That link isn't valid. Contact your team manager for a new one.",
  ) = state
}

pub fn recorded_vote_is_restored_from_ballot_test() {
  let row =
    api.FamilyBallotRow(
      swimmer_id: "swimmer-1",
      swimmer_name: "Ada",
      has_voted: True,
      voting_open: True,
      voted_for_name: option.Some("Grace"),
    )
  let #(state, _effect) =
    family.update(
      family.Loading,
      "unused-token",
      family.GotFamilyBallot(Ok([row])),
    )

  let assert family.Ready(
    voting_open: True,
    children: [types.ChildBallot(status: types.VotedFor("Grace"), ..)],
    candidates: [],
  ) = state
}

pub fn failed_campaign_poll_is_visible_test() {
  let state =
    admin.LoggedIn(
      email: "manager@example.com",
      roster: [],
      results: [],
      families: [],
      management: admin.ManagementForm(admin.NewFamily, "", "", ""),
      family_list: default_family_list(),
      notice: option.None,
      filter_text: "",
      busy: True,
    )
  let #(updated, _effect) =
    admin.update(state, admin.CampaignUpdated(Error(rsvp.NetworkError)))

  let assert admin.LoggedIn(
    notice: option.Some("Notification progress could not be loaded."),
    busy: False,
    ..,
  ) = updated
}
