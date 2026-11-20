import sys
src, dst = sys.argv[1], sys.argv[2]
s = open(src).read()
old = """    // One UTxO that pays alone: by the purpose's rank, then the box rank, then the smallest.
    let made = |u: &UtxoResponse| {
        let c = h.class_of(u);
        if balance.kind_of(u).is_box() {
            build::box_rank(&c)
        } else {
            0
        }
    };
    let alone_key = |u: &UtxoResponse| (h.rank_of(u), made(u), u.value.parse::<u64>().unwrap());
"""
new = """    // One UTxO that pays alone: by the purpose's rank, then the box rank, then the smallest, from the reference's own
    // table (l6reference#6), never selection's `rank_of` or `box_rank`.
    let alone_key = |u: &UtxoResponse| {
        let (rank, made) = own_rank(spend, balance.kind_of(u));
        (rank, made, u.value.parse::<u64>().unwrap())
    };
"""
assert s.count(old) == 1, "alone_key block"
s = s.replace(old, new)
anchor = "/// What the brute force says of one Spend over one balance, or why selection's pick isn't as good.\n"
table = """/// The one-UTxO order, the reference's own (l6reference#6): Purpose::Pay's and Purpose::Fund's ranks as the rule and
/// the Purpose docs state them, then among boxes of one rank a mixed one, a plain one, one of unknown making.
fn own_rank(spend: &Spend, kind: Kind) -> (u8, u8) {
    match spend {
        Spend::Send(_) | Spend::Public(_) => match kind {
            Kind::Own => (0, 0),
            Kind::OwnSession | Kind::OtherSession => (1, 0),
            Kind::Received => (2, 0),
            Kind::Mixed => (4, 0),
            Kind::Plain => (5, 1),
            Kind::Unknown => (5, 2),
        },
        Spend::Fund(_) => match kind {
            Kind::OwnSession => (0, 0),
            Kind::Received => (1, 0),
            Kind::Mixed => (2, 0),
            Kind::Plain => (3, 1),
            Kind::Unknown => (3, 2),
            Kind::Own => (6, 0),
            Kind::OtherSession => (7, 0),
        },
    }
}

"""
assert s.count(anchor) == 1, "anchor"
s = s.replace(anchor, table + anchor)
open(dst, "w").write(s)
print("wrote", dst)
