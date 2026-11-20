    /// Chunk 51, l8merge#1, the general case: S1, a way back of another pool (6.1 ₳ and a token of another policy),
    /// beside T1 and T2 (6 ₳ and the pool's token each), U (6.5 ₳, unknown making), X (3 ₳ received) and 20 payments
    /// received of 10 ₳. S1 leads by its ADA and by its weight, but S1 and T1 pay less than T1 and T2, whose change
    /// carries one policy: T1, T2 and the 20, never U.
    #[test]
    fn rule_two_keeps_the_first_box_of_unknown_making_out_beside_a_token_box_of_another_policy() {
        let w = world();
        let mut s1 = owned(&w, 0x72, 0, 6_100_000, &[("sB", 1)]);
        s1.asset_list.as_mut().unwrap()[0].policy_id =
            "d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0d0".to_string();
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let u = owned(&w, 0x90, 0, 6_500_000, &[]);
        let x = owned(&w, 0xa0, 0, 3_000_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let both = with_first(&[&t1, &t2], &payments, 20);
        let names = [(&s1, "S1"), (&t1, "T1"), (&t2, "T2"), (&u, "U"), (&x, "X")];
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            let s1t1 = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &with_first(&[&s1, &t1], &payments, 20), out, l).is_ok()
            });
            assert!(s1t1 < most, "{out:?}: S1, T1 and the 20 pay up to {s1t1}, T1, T2 and the 20 {most}");
            let lovelace = most - (most - s1t1) / 2;
            pays_out(&w, &both, out, lovelace).expect("T1, T2 and the 20 pay");
            for (what, inputs) in [
                ("S1, T1 and the 20", with_first(&[&s1, &t1], &payments, 20)),
                ("S1, T2 and the 20", with_first(&[&s1, &t2], &payments, 20)),
                ("the 20, X and S1", with_first(&[&x, &s1], &payments, 20)),
                ("U, the 20 and X", with_first(&[&u, &x], &payments, 20)),
            ] {
                let e = pays_out(&w, &inputs, out, lovelace).unwrap_err();
                assert!(build::is_short(&e), "{out:?}: {what}: {e}");
            }
            let mut known: Vec<(&UtxoResponse, Class)> = vec![
                (&s1, box_class(&s1, Origin::Lovejoin)),
                (&t1, box_class(&t1, Origin::Lovejoin)),
                (&t2, box_class(&t2, Origin::Lovejoin)),
                (&u, unknown_class(&u)),
                (&x, received_class(&x)),
            ];
            known.extend(payments.iter().map(|p| (p, received_class(p))));
            for with_x in [true, false] {
            let mut known = known.clone();
            if !with_x {
                known.retain(|(k, _)| k.tx_hash != x.tx_hash);
            }
            let line = format!(
                "with X {with_x}: {out:?} of {lovelace} (T1, T2 and the 20 pay up to {most}, S1, T1 and the 20 up to {s1t1})"
            );
            match picked_out(&w, &known, out, lovelace) {
                Ok(spent) => {
                    let l = format!("{line}: spent {} ({} inputs)", named(&spent, &names), spent.len());
                    println!("{l}");
                    if spent
                        .iter()
                        .any(|s| s.tx_hash == u.tx_hash && s.tx_index == u.tx_index)
                    {
                        wrong.push(l);
                    }
                }
                Err(e) => wrong.push(format!("{line}: refused: {e}")),
            }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where T1, T2 and the 20 pay without one:\n{}",
            wrong.join("\n")
        );
    }

