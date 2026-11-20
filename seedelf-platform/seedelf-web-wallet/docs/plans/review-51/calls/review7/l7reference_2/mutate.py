import sys

path = sys.argv[1]
src = open(path).read()
old = "            let (weight, rank) = box_weight(params, &class(u), &[u], Weighed::InOne);\n"
if src.count(old) != 1:
    raise SystemExit(f"expected one weight line, found {src.count(old)}")
new = old + (
    "            // Review scratch (l7reference#2): L7R2_W=ada weighs a box by its ADA, adds by what it adds (the\n"
    "            // parts' weight), seedelf by adds plus seedelf_minimum_lovelace, never more than its ADA.\n"
    "            let weight = match std::env::var(\"L7R2_W\").as_deref() {\n"
    "                Ok(\"ada\") => lovelace_in(u),\n"
    "                Ok(\"adds\") => box_weight(params, &class(u), &[u], Weighed::InParts).0,\n"
    "                Ok(\"seedelf\") if holds_tokens(u) => {\n"
    "                    let added = box_weight(params, &class(u), &[u], Weighed::InParts).0;\n"
    "                    let least = u128::from(seedelf_minimum_lovelace(params).unwrap());\n"
    "                    (added + least).min(lovelace_in(u))\n"
    "                }\n"
    "                _ => weight,\n"
    "            };\n"
)
src = src.replace(old, new)
open(path, "w").write(src)
print("patched")
