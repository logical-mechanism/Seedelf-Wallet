/// An XOR statement between two booleans `a` and `b`. This is used to prevent
/// burning and minting a token at the same time. It is either just burning XOR
/// minting a token, never both.
///
/// ```aiken
/// logic.xor(a, b)
/// ```
pub fn xor(a: Bool, b: Bool) -> Bool {
  // `xor` is actually an `and` of an `or` and `not and`
  and {
    // a or b
    or {
      a,
      b,
    },
    // but not a and b
    !and {
      a,
      b,
    },
  }
}

test true_true_xor() {
  xor(True, True) == False
}

test false_false_xor() {
  xor(False, False) == False
}

test false_true_xor() {
  xor(False, True) == True
}

test true_false_xor() {
  xor(True, False) == True
}

test good_bracket_xor() {
  xor(2 == 2, 1 == 2) == True
}

test bad_bracket_xor() {
  xor(2 == 2, 1 == 1) == False
}
