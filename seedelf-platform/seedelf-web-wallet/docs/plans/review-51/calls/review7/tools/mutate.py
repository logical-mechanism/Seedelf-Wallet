import sys
path = sys.argv[1]
src = open(path).read()

def rep(old, new, count=1):
    global src
    n = src.count(old)
    if n != count:
        raise SystemExit(f"expected {count} of {old[:60]!r}, found {n}")
    src = src.replace(old, new)

# Pass d behind R7REF_NO_D, its first part behind R7REF_NO_OLD_ASKED.
rep("    // d. 1e1b0647's own orders, as it grew them, its whole ones kept apart from the rule's.\n",
    "    // d. 1e1b0647's own orders, as it grew them, its whole ones kept apart from the rule's.\n    if std::env::var_os(\"R7REF_NO_D\").is_none() {\n")
rep("    for u in old_asked {\n        if let Some(Grown::Built(built, _)) = run(vec![u], 1, None, &grown_old) {\n",
    "    for u in old_asked.into_iter().filter(|_| std::env::var_os(\"R7REF_NO_OLD_ASKED\").is_none()) {\n        if let Some(Grown::Built(built, _)) = run(vec![u], 1, None, &grown_old) {\n")
rep("    // e.\n    if let Some(Grown::Built(built, _)) = run(blind, 0, None, &grown) {\n",
    "    }\n    // e.\n    if let Some(Grown::Built(built, _)) = run(blind, 0, None, &grown) {\n")
# The weight as the box's ADA behind R7REF_W_ADA.
rep("            let (weight, rank) = box_weight(params, &class(u), &[u], Weighed::InOne);\n",
    "            let (weight, rank) = box_weight(params, &class(u), &[u], Weighed::InOne);\n            let weight = if std::env::var_os(\"R7REF_W_ADA\").is_some() { lovelace_in(u) } else { weight };\n")
open(path, "w").write(src)
print("patched")
