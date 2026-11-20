
/// Review seven, l7reference#3: the parts test's bounds hold the new selection to 1e1b0647's own, timed in the same run
/// over the same balance and the same reruns, so the bound holds on any machine and load. 1e1b0647's selection (`old`)
/// asks the real builder on every set it tries, with no verdict cache: this balance has two values, so a cache would
/// answer almost every set. The new selection and its reruns each take at most three times as long.
#[test]
fn l7reference_3_parts_plan_within_three_times_1e1b0647s_own_time() {
    let w = world();
    let r = parts_against_old(&w, 100, 100, 400, 1_200 * ADA);
    println!(
        "100 + 100 boxes, 400 payments, a Send of 1,200 ₳: one selection {:?} against 1e1b0647's {:?} ({:.2}x); {} reruns {:?} against {:?} ({:.2}x)",
        r.new_one,
        r.old_one,
        r.new_one.as_secs_f64() / r.old_one.as_secs_f64(),
        r.count,
        r.new_reruns,
        r.old_reruns,
        r.new_reruns.as_secs_f64() / r.old_reruns.as_secs_f64(),
    );
    assert!(
        r.new_one <= r.old_one * 3,
        "one selection took {:?}, 1e1b0647's {:?}",
        r.new_one,
        r.old_one
    );
    assert!(
        r.new_reruns <= r.old_reruns * 3,
        "the reruns took {:?}, 1e1b0647's {:?}",
        r.new_reruns,
        r.old_reruns
    );
}

struct AgainstOld {
    new_one: std::time::Duration,
    old_one: std::time::Duration,
    new_reruns: std::time::Duration,
    old_reruns: std::time::Duration,
    count: usize,
}

/// `parts_shape`'s balance and reruns, each selection timed beside 1e1b0647's over the same UTxOs.
fn parts_against_old(w: &World, unknown: u32, plain: u32, received: u32, lovelace: u64) -> AgainstOld {
    let mut n = 0x1000_0000u32;
    let mut items: Vec<(UtxoResponse, Kind)> = Vec::new();
    for (count, lovelace, kind) in [
        (unknown, 10 * ADA, Kind::Unknown),
        (plain, 10 * ADA, Kind::Plain),
        (received, 2 * ADA, Kind::Received),
    ] {
        for _ in 0..count {
            n += 1;
            items.push((utxo(w, n, lovelace, None), kind));
        }
    }
    let balance = Balance {
        boxes: (unknown + plain) as usize,
        distinct: 0,
        smalls: received as usize,
        small: 2 * ADA,
        items,
    };
    let h = balance.histories(Purpose::Pay, true);
    let both = |utxos: &[UtxoResponse], lovelace: u64| {
        let spend = Spend::Send(lovelace);
        let paying = Paying::new(w, &spend);
        let started = std::time::Instant::now();
        let picked = paying.apart(utxos, &h);
        let new = started.elapsed();
        let (seedelfs, _) = spend.outputs(w);
        let started = std::time::Instant::now();
        let old_built = old::built(&w.chain.params, utxos, &h, &Purpose::Pay, spend.floor(&w.chain.params), |inputs| {
            let inputs: Vec<UtxoResponse> = inputs.iter().map(|u| (*u).clone()).collect();
            match build::transfer_from(&w.chain, &inputs, &seedelfs, &w.owner, w.signer)
                .and_then(|s| s.estimate().map(|_| ()))
            {
                Ok(()) => Verdict::Pays,
                Err(e) if build::is_short(&e) => Verdict::Short,
                Err(_) => Verdict::Failed,
            }
        });
        let old = started.elapsed();
        assert!(picked.is_ok() || !old_built, "refused where 1e1b0647 built");
        (new, old, picked)
    };
    let all: Vec<UtxoResponse> = balance.items.iter().map(|(u, _)| u.clone()).collect();
    let (new_one, old_one, picked) = both(&all, lovelace);
    let e = picked.expect_err("too many for one transaction");
    assert!(build::is_too_many(&e), "{e}");
    let mut rest = all.clone();
    rest.reverse();
    let mut owed = lovelace;
    let (mut new_reruns, mut old_reruns, mut count) = (std::time::Duration::ZERO, std::time::Duration::ZERO, 0);
    while !rest.is_empty() {
        let taken: Vec<UtxoResponse> = rest.drain(..20.min(rest.len())).collect();
        let paid = taken.iter().map(lovelace_of).sum::<u64>() - 400_000;
        owed = owed.saturating_sub(paid);
        if owed == 0 || rest.is_empty() {
            break;
        }
        let (new, old, picked) = both(&rest, owed);
        new_reruns += new;
        old_reruns += old;
        count += 1;
        if picked.is_ok() {
            break;
        }
    }
    AgainstOld {
        new_one,
        old_one,
        new_reruns,
        old_reruns,
        count,
    }
}
