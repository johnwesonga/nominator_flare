import admin
import api
import family
import gleam/json
import gleam/option
import gleeunit
import rsvp
import types

pub fn main() -> Nil {
  gleeunit.main()
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
