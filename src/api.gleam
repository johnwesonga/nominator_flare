import gleam/dynamic/decode
import gleam/json
import gleam/option.{type Option}
import gleam/uri
import http_client
import lustre/effect
import rsvp

import types.{type AdminFamily, type AdminRow, type Candidate, type ResultRow}

// -----------------------------------------------------------------------------
// Family ballot
// -----------------------------------------------------------------------------

pub type FamilyBallotRow {
  FamilyBallotRow(
    swimmer_id: String,
    swimmer_name: String,
    has_voted: Bool,
    voting_open: Bool,
    voted_for_name: Option(String),
  )
}

fn family_ballot_row_decoder() -> decode.Decoder(FamilyBallotRow) {
  use swimmer_id <- decode.field("swimmer_id", decode.string)
  use swimmer_name <- decode.field("swimmer_name", decode.string)
  use has_voted <- decode.field("has_voted", decode.bool)
  use voting_open <- decode.field("voting_open", decode.bool)
  use voted_for_name <- decode.field(
    "voted_for_name",
    decode.optional(decode.string),
  )
  decode.success(FamilyBallotRow(
    swimmer_id:,
    swimmer_name:,
    has_voted:,
    voting_open:,
    voted_for_name:,
  ))
}

pub fn family_ballot_decoder() -> decode.Decoder(List(FamilyBallotRow)) {
  decode.list(family_ballot_row_decoder())
}

pub fn get_family_ballot(
  token: String,
  message: fn(Result(List(FamilyBallotRow), rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json(
    "/api/ballots/" <> uri.percent_encode(token),
    family_ballot_decoder(),
    message,
  )
}

// -----------------------------------------------------------------------------
// Candidate roster
// -----------------------------------------------------------------------------

pub fn get_roster(
  token: String,
  message: fn(Result(List(Candidate), rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json(
    "/api/ballots/" <> uri.percent_encode(token) <> "/candidates",
    roster_decoder(),
    message,
  )
}

pub fn roster_decoder() -> decode.Decoder(List(Candidate)) {
  types.candidate_list_decoder()
}

// -----------------------------------------------------------------------------
// Cast vote
// -----------------------------------------------------------------------------

pub fn cast_vote(
  token: String,
  voter_swimmer_id: String,
  candidate_id: String,
  message: fn(Result(String, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  let body =
    json.object([
      #("voter_swimmer_id", json.string(voter_swimmer_id)),
      #("candidate_id", json.string(candidate_id)),
    ])

  http_client.post_json(
    "/api/ballots/" <> uri.percent_encode(token) <> "/votes",
    body,
    cast_vote_decoder(),
    message,
  )
}

pub fn cast_vote_decoder() -> decode.Decoder(String) {
  decode.string
}

// -----------------------------------------------------------------------------
// Admin session
// -----------------------------------------------------------------------------

pub type AdminSession {
  AdminSession(email: String)
}

pub fn get_admin_session(
  message: fn(Result(AdminSession, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json("/api/admin/session", admin_session_decoder(), message)
}

pub fn admin_session_decoder() -> decode.Decoder(AdminSession) {
  use email <- decode.field("email", decode.string)
  decode.success(AdminSession(email:))
}

// -----------------------------------------------------------------------------
// Admin roster
// -----------------------------------------------------------------------------

pub fn get_admin_roster(
  message: fn(Result(List(AdminRow), rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json("/api/admin/roster", admin_roster_decoder(), message)
}

pub fn admin_roster_decoder() -> decode.Decoder(List(AdminRow)) {
  decode.list(types.admin_row_decoder())
}

// -----------------------------------------------------------------------------
// Admin family management
// -----------------------------------------------------------------------------

pub fn get_admin_families(
  message: fn(Result(List(AdminFamily), rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json(
    "/api/admin/families",
    types.admin_family_list_decoder(),
    message,
  )
}

pub fn create_family(
  email: String,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.post_expect_ok(
    "/api/admin/families",
    json.object([#("email", json.string(email))]),
    message,
  )
}

pub fn update_family(
  family_id: String,
  email: String,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.put_expect_ok(
    "/api/admin/families/" <> uri.percent_encode(family_id),
    json.object([#("email", json.string(email))]),
    message,
  )
}

pub fn delete_family(
  family_id: String,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.delete_expect_ok(
    "/api/admin/families/" <> uri.percent_encode(family_id),
    message,
  )
}

pub fn create_swimmer(
  family_id: String,
  name: String,
  group_name: Option(String),
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.post_expect_ok(
    "/api/admin/families/" <> uri.percent_encode(family_id) <> "/swimmers",
    swimmer_body(name, group_name),
    message,
  )
}

pub fn update_swimmer(
  swimmer_id: String,
  name: String,
  group_name: Option(String),
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.put_expect_ok(
    "/api/admin/swimmers/" <> uri.percent_encode(swimmer_id),
    swimmer_body(name, group_name),
    message,
  )
}

pub fn delete_swimmer(
  swimmer_id: String,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.delete_expect_ok(
    "/api/admin/swimmers/" <> uri.percent_encode(swimmer_id),
    message,
  )
}

fn swimmer_body(name: String, group_name: Option(String)) -> json.Json {
  json.object([
    #("name", json.string(name)),
    #("group_name", case group_name {
      option.Some(value) -> json.string(value)
      option.None -> json.null()
    }),
  ])
}

// -----------------------------------------------------------------------------
// Admin results
// -----------------------------------------------------------------------------

pub fn get_results(
  message: fn(Result(List(ResultRow), rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json("/api/admin/results", results_decoder(), message)
}

pub fn results_decoder() -> decode.Decoder(List(ResultRow)) {
  types.result_list_decoder()
}

// -----------------------------------------------------------------------------
// Open / close voting
// -----------------------------------------------------------------------------

pub fn set_voting_open(
  open: Bool,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  let body =
    json.object([
      #("open", json.bool(open)),
    ])

  http_client.put_expect_ok("/api/admin/voting", body, message)
}

// -----------------------------------------------------------------------------
// Notify parents
// -----------------------------------------------------------------------------

pub type NotificationCampaign {
  NotificationCampaign(
    id: String,
    status: String,
    total: Int,
    queued: Int,
    sent: Int,
    failed: Int,
  )
}

pub fn notification_campaign_decoder() -> decode.Decoder(NotificationCampaign) {
  use id <- decode.field("id", decode.string)
  use status <- decode.field("status", decode.string)
  use total <- decode.field("total", decode.int)
  use queued <- decode.field("queued", decode.int)
  use sent <- decode.field("sent", decode.int)
  use failed <- decode.field("failed", decode.int)
  decode.success(NotificationCampaign(
    id:,
    status:,
    total:,
    queued:,
    sent:,
    failed:,
  ))
}

pub fn notify_parents(
  message: fn(Result(NotificationCampaign, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.post_json(
    "/api/admin/notifications",
    json.object([]),
    notification_campaign_decoder(),
    message,
  )
}

pub fn get_notification_campaign(
  campaign_id: String,
  message: fn(Result(NotificationCampaign, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  http_client.get_json(
    "/api/admin/notifications/" <> uri.percent_encode(campaign_id),
    notification_campaign_decoder(),
    message,
  )
}
