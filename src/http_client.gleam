import gleam/dynamic/decode
import gleam/json.{type Json}
import gleam/result
import lustre/effect
import rsvp

pub fn get_json(
  path: String,
  decoder: decode.Decoder(a),
  message: fn(Result(a, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  rsvp.get(path, rsvp.expect_json(decoder, message))
}

pub fn post_json(
  path: String,
  body: Json,
  decoder: decode.Decoder(a),
  message: fn(Result(a, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  rsvp.post(path, body, rsvp.expect_json(decoder, message))
}

pub fn post_expect_ok(
  path: String,
  body: Json,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  rsvp.post(path, body, expect_nil(message))
}

pub fn put_expect_ok(
  path: String,
  body: Json,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  rsvp.put(path, body, expect_nil(message))
}

pub fn delete_expect_ok(
  path: String,
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> effect.Effect(msg) {
  rsvp.delete(path, json.object([]), expect_nil(message))
}

fn expect_nil(
  message: fn(Result(Nil, rsvp.Error(String))) -> msg,
) -> rsvp.Handler(String, msg) {
  rsvp.expect_ok_response(fn(response_result) {
    message(result.map(response_result, fn(_response) { Nil }))
  })
}
