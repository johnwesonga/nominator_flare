import gleam/dynamic/decode
import gleam/option

pub type Candidate {
  Candidate(id: String, name: String)
}

fn candidate_decoder() -> decode.Decoder(Candidate) {
  use id <- decode.field("id", decode.string)
  use name <- decode.field("name", decode.string)
  decode.success(Candidate(id:, name:))
}

pub fn candidate_list_decoder() -> decode.Decoder(List(Candidate)) {
  decode.list(candidate_decoder())
}

pub type ChildBallot {
  ChildBallot(
    swimmer_id: String,
    swimmer_name: String,
    has_voted: Bool,
    search_text: String,
    selected_candidate: option.Option(Candidate),
    status: ChildStatus,
  )
}

pub type ChildStatus {
  NotSubmitted
  Submitting
  VotedFor(String)
  Submitted(String)
}

pub type FamilyState {
  LoadingFamily
  FamilyError(String)
  FamilyReady(
    voting_open: Bool,
    children: List(ChildBallot),
    candidates: List(Candidate),
  )
}

pub type ResultRow {
  ResultRow(candidate_id: String, candidate_name: String, vote_count: Int)
}

fn result_row_decoder() -> decode.Decoder(ResultRow) {
  use candidate_id <- decode.field("candidate_id", decode.string)
  use candidate_name <- decode.field("candidate_name", decode.string)
  use vote_count <- decode.field("vote_count", decode.int)
  decode.success(ResultRow(candidate_id:, candidate_name:, vote_count:))
}

pub fn result_list_decoder() -> decode.Decoder(List(ResultRow)) {
  decode.list(result_row_decoder())
}

pub type AdminRow {
  AdminRow(
    family_id: String,
    family_email: String,
    family_token: String,
    swimmer_id: String,
    swimmer_name: String,
    group_name: option.Option(String),
    has_voted: Bool,
  )
}

pub fn admin_row_decoder() -> decode.Decoder(AdminRow) {
  use family_id <- decode.field("family_id", decode.string)
  use family_email <- decode.field("family_email", decode.string)
  use family_token <- decode.field("family_token", decode.string)
  use swimmer_id <- decode.field("swimmer_id", decode.string)
  use swimmer_name <- decode.field("swimmer_name", decode.string)
  use group_name <- decode.field("group_name", decode.optional(decode.string))
  use has_voted <- decode.field("has_voted", decode.bool)
  decode.success(AdminRow(
    family_id:,
    family_email:,
    family_token:,
    swimmer_id:,
    swimmer_name:,
    group_name:,
    has_voted:,
  ))
}

pub type AdminSwimmer {
  AdminSwimmer(
    id: String,
    name: String,
    group_name: option.Option(String),
    created_at: String,
    has_voted: Bool,
  )
}

fn admin_swimmer_decoder() -> decode.Decoder(AdminSwimmer) {
  use id <- decode.field("id", decode.string)
  use name <- decode.field("name", decode.string)
  use group_name <- decode.field("group_name", decode.optional(decode.string))
  use created_at <- decode.field("created_at", decode.string)
  use has_voted <- decode.field("has_voted", decode.bool)
  decode.success(AdminSwimmer(id:, name:, group_name:, created_at:, has_voted:))
}

pub type AdminFamily {
  AdminFamily(
    id: String,
    email: String,
    family_token: String,
    created_at: String,
    swimmers: List(AdminSwimmer),
  )
}

pub fn admin_family_decoder() -> decode.Decoder(AdminFamily) {
  use id <- decode.field("id", decode.string)
  use email <- decode.field("email", decode.string)
  use family_token <- decode.field("family_token", decode.string)
  use created_at <- decode.field("created_at", decode.string)
  use swimmers <- decode.field("swimmers", decode.list(admin_swimmer_decoder()))
  decode.success(AdminFamily(id:, email:, family_token:, created_at:, swimmers:))
}

pub fn admin_family_list_decoder() -> decode.Decoder(List(AdminFamily)) {
  decode.list(admin_family_decoder())
}
