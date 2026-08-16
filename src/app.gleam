import admin
import family
import gleam/int
import gleam/json
import gleam/result
import gleam/uri.{type Uri}
import lustre
import lustre/attribute
import lustre/effect
import lustre/element
import lustre/element/html
import lustre/element/svg
import modem
import rsvp

pub type Model {
  Model(route: Route, family: family.State, admin: admin.State)
}

pub type Route {
  Home
  Admin
  Vote(token: String)
  NotFound(uri: Uri)
}

pub type Msg {
  UrlChanged(Uri)
  FamilyMsg(family.Msg)
  AdminMsg(admin.Msg)
}

fn parse_route(uri: Uri) -> Route {
  case uri.path_segments(uri.path) {
    [] | [""] -> Home
    ["admin"] -> Admin
    ["vote", token] -> Vote(token)
    _ -> NotFound(uri)
  }
}

pub fn init(_) -> #(Model, effect.Effect(Msg)) {
  let initial_route =
    modem.initial_uri()
    |> result.map(parse_route)
    |> result.unwrap(Home)

  let #(admin_state, admin_effect) =
    admin.init(case initial_route {
      Admin -> True
      _ -> False
    })

  case initial_route {
    Vote(token) -> {
      let #(family_state, family_effect) = family.init(token)

      #(
        Model(route: initial_route, family: family_state, admin: admin_state),
        effect.batch([
          modem.init(UrlChanged),
          effect.map(family_effect, FamilyMsg),
          effect.map(admin_effect, AdminMsg),
        ]),
      )
    }

    _ -> #(
      Model(route: initial_route, family: family.Loading, admin: admin_state),
      effect.batch([modem.init(UrlChanged), effect.map(admin_effect, AdminMsg)]),
    )
  }
}

fn update(model: Model, msg: Msg) -> #(Model, effect.Effect(Msg)) {
  case msg {
    UrlChanged(uri) -> {
      let new_route = parse_route(uri)

      case new_route {
        Vote(token) -> {
          let #(family_state, family_effect) = family.init(token)

          #(
            Model(..model, route: new_route, family: family_state),
            effect.map(family_effect, FamilyMsg),
          )
        }

        Admin -> {
          let #(admin_state, admin_effect) = admin.init(True)
          #(
            Model(..model, route: new_route, admin: admin_state),
            effect.map(admin_effect, AdminMsg),
          )
        }

        _ -> #(Model(..model, route: new_route), effect.none())
      }
    }

    FamilyMsg(msg) -> {
      case model.route {
        Vote(token) -> {
          let #(family_state, family_effect) =
            family.update(model.family, token, msg)

          #(
            Model(..model, family: family_state),
            effect.map(family_effect, FamilyMsg),
          )
        }

        _ -> #(model, effect.none())
      }
    }
    AdminMsg(msg) -> {
      let #(admin_state, admin_effect) = admin.update(model.admin, msg)
      #(Model(..model, admin: admin_state), effect.map(admin_effect, AdminMsg))
    }
  }
}

pub fn error_to_string(error: rsvp.Error(String)) -> String {
  case error {
    rsvp.BadUrl(url) -> "Invalid request URL: " <> url

    rsvp.BadBody -> "The server sent back something we couldn't read."

    rsvp.NetworkError ->
      "Couldn't reach the application server. Check your connection and try again."

    rsvp.HttpError(response) ->
      "The application server returned an error (status "
      <> int.to_string(response.status)
      <> "). Please try again."

    rsvp.UnhandledResponse(response) ->
      "Unexpected server response (status "
      <> int.to_string(response.status)
      <> ")."

    rsvp.JsonError(json_error) ->
      "Couldn't parse the server response: " <> json_error_to_string(json_error)
  }
}

fn json_error_to_string(error: json.DecodeError) -> String {
  case error {
    json.UnexpectedEndOfInput -> "the response ended unexpectedly."

    json.UnexpectedByte(byte) ->
      "found an unexpected character (" <> byte <> ") in the response."

    json.UnexpectedSequence(seq) ->
      "found an unexpected sequence (" <> seq <> ") in the response."

    json.UnableToDecode(_) -> "the response didn't match the shape we expected."
  }
}

pub fn view(model: Model) -> element.Element(Msg) {
  html.div([], [
    html.div([attribute.class("topbar")], [
      html.div([attribute.class("topbar-inner")], [
        html.div([attribute.class("wordmark")], []),
        html.div([attribute.class("wordmark-text")], [
          html.text("Forest Park Swim Team"),
          html.span([], [html.text("Most Inspirational Swimmer - Nomination")]),
        ]),
      ]),
    ]),
    // Wave
    html.div([attribute.class("wave")], [
      html.svg(
        [
          attribute.attribute("viewBox", "0 0 1200 20"),
          attribute.attribute("preserveAspectRatio", "none"),
        ],
        [
          svg.path([
            attribute.attribute(
              "d",
              "M0,10 Q30,0 60,10 T120,10 T180,10 T240,10 T300,10 T360,10 T420,10 T480,10 T540,10 T600,10 T660,10 T720,10 T780,10 T840,10 T900,10 T960,10 T1020,10 T1080,10 T1140,10 T1200,10 V20 H0 Z",
            ),
            attribute.attribute("fill", "#F4FAFB"),
          ]),
        ],
      ),
    ]),
    // Main content
    html.main([], [
      case model.route {
        Home ->
          html.div([], [
            html.p([], [
              html.text("Welcome to the Nominator!"),
            ]),
          ])
        Admin -> admin.view(model.admin) |> element.map(AdminMsg)
        Vote(_) ->
          family.view(model.family)
          |> element.map(FamilyMsg)
        NotFound(_) ->
          html.div([], [
            html.p([], [
              html.text("Page not found."),
            ]),
          ])
      },
    ]),
  ])
}

pub fn main() -> Nil {
  let app = lustre.application(init, update, view)
  let assert Ok(_) = lustre.start(app, "#app", Nil)
  Nil
}
