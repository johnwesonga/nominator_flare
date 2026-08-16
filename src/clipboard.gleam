import lustre/effect

pub fn write(text: String, message: fn(Bool) -> msg) -> effect.Effect(msg) {
  use dispatch <- effect.from
  write_text(text, fn(success) { dispatch(message(success)) })
}

@external(javascript, "./clipboard_ffi.mjs", "writeText")
fn write_text(_text: String, _callback: fn(Bool) -> Nil) -> Nil {
  Nil
}
