<!-- Comment on https://github.com/input-output-hk/PlutusCoreBlaster/pull/68
File lean-blaster-datatype-param-names.md first and put its number in the second paragraph. -->

While this moves to Z3 5.3.1: the README's *Installation and building* still says "Install z3 version 4.15.2." With the beta-based Blaster (from `88588c5`, "set min z3 version to 5.3.1"), every proof that reaches the solver fails on 4.15.2 with `invalid tactic, unknown tactic recfun-finder` (the simplifier arrived in Z3 5.3.0), while goals the optimizer closes still pass, so it looks half-working. Lean-blaster's own README says both (4.15.2 in the badge and install section, 5.3.1 under Prerequisites). Worth updating here with the dependency.

Also worth knowing before this lands: the beta branch has a regression that `main` doesn't, input-output-hk/Lean-blaster#NUMBER. A datatype gets declared with the parameter names of an earlier alpha-equivalent type, so any goal with both `Except` and `Prod` fails to translate. Here that's every goal reaching a BLS12-381 builtin (they return `Except String _`, after the CEK model's `Data × Data`).
