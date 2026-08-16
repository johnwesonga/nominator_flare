import lustre/effect

pub fn after(milliseconds: Int, message: msg) -> effect.Effect(msg) {
  use dispatch <- effect.from
  set_timeout(milliseconds, fn() { dispatch(message) })
}

@external(javascript, "./timer_ffi.mjs", "setTimeout")
fn set_timeout(_milliseconds: Int, _callback: fn() -> Nil) -> Nil {
  Nil
}
