    /// Chunk 51, l8merge#1: rule 2's first box of unknown making beside small money. Shape A of l7merge#1 (T1 and T2,
    /// two plain ways back of one token pool, 6 ₳ and its token each; A, a plain way back of 5.9 ₳; U, a way back of
    /// unknown making of 6.5 ₳; 20 payments received of 10 ₳), plus `n` more received payments of 2 or 3 ₳. T1, T2 and
    /// the 20 pay in 22 inputs and hold no box of unknown making, so by rule 2 ("none where the others pay without one",
    /// its margin only past the first) U stays out. n = 0 is l7merge#1's own pin.
    #[test]
    fn rule_two_keeps_the_first_box_of_unknown_making_out_beside_small_received_money() {
        let w = world();
        let a = owned(&w, 0x31, 0, 5_900_000, &[]);
        let t1 = owned(&w, 0x70, 0, 6_000_000, &[("pooltoken", 1)]);
        let t2 = owned(&w, 0x71, 0, 6_000_000, &[("pooltoken", 1)]);
        let u = owned(&w, 0x90, 0, 6_500_000, &[]);
        let payments: Vec<UtxoResponse> = (0..20u8)
            .map(|i| owned(&w, 0x50 + i, 0, 10_000_000, &[]))
            .collect();
        let both = with_first(&[&t1, &t2], &payments, 20);
        let mut wrong = Vec::new();
        for out in [Out::Send, Out::Public, Out::Fund] {
            let most = most_paid(150_000_000, 230_000_000, |l| {
                pays_out(&w, &both, out, l).is_ok()
            });
            for under in [20_000u64, 50_000] {
                let lovelace = most - under;
                pays_out(&w, &both, out, lovelace).expect("T1, T2 and the 20 pay");
                pays_out(&w, &with_first(&[&u, &a], &payments, 20), out, lovelace)
                    .expect("U, A and the 20 pay");
                for (n, small) in [
                    (0u8, 0u64),
                    (1, 3_000_000),
                    (1, 2_000_000),
                    (2, 2_000_000),
                    (2, 3_000_000),
                    (3, 2_000_000),
                    (3, 3_000_000),
                    (5, 2_000_000),
                    (5, 3_000_000),
                ] {
                    let smalls: Vec<UtxoResponse> = (0..n)
                        .map(|i| owned(&w, 0xa0 + i, 0, small, &[]))
                        .collect();
                    let small_names: Vec<String> = (1..=n).map(|i| format!("X{i}")).collect();
                    let mut names: Vec<(&UtxoResponse, &str)> =
                        vec![(&a, "A"), (&t1, "T1"), (&t2, "T2"), (&u, "U")];
                    names.extend(smalls.iter().zip(&small_names).map(|(s, n)| (s, n.as_str())));
                    let mut known: Vec<(&UtxoResponse, Class)> = vec![
                        (&a, box_class(&a, Origin::Lovejoin)),
                        (&t1, box_class(&t1, Origin::Lovejoin)),
                        (&t2, box_class(&t2, Origin::Lovejoin)),
                        (&u, unknown_class(&u)),
                    ];
                    known.extend(payments.iter().map(|p| (p, received_class(p))));
                    known.extend(smalls.iter().map(|p| (p, received_class(p))));
                    let line = format!(
                        "{n} of {small}, {out:?} of {lovelace} (T1, T2 and the 20 pay up to {most})"
                    );
                    match picked_out(&w, &known, out, lovelace) {
                        Ok(spent) => {
                            let l = format!(
                                "{line}: spent {} ({} inputs)",
                                named(&spent, &names),
                                spent.len()
                            );
                            println!("{l}");
                            if spent
                                .iter()
                                .any(|s| s.tx_hash == u.tx_hash && s.tx_index == u.tx_index)
                            {
                                wrong.push(l);
                            }
                        }
                        Err(e) => {
                            let l = format!("{line}: refused: {e}");
                            println!("{l}");
                            wrong.push(l);
                        }
                    }
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a box of unknown making merged where T1, T2 and the 20 pay without one:\n{}",
            wrong.join("\n")
        );
    }

