/// An XOR statement between two booleans `a` and `b`. This is used to prevent
/// burning and minting a token at the same time. It is either just burning OR
/// just minting a token.
///
/// ```aiken
/// xor(a,b)
/// ```
pub fn xor(a: Bool, b: Bool) -> Bool {
  and {
    or {
      a,
      b,
    },
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
