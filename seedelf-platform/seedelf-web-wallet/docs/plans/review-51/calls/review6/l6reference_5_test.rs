    /// Chunk 51, round six's step-1 sibling of l5merge#1 (l6reference#5): the cap of 12 token-bearing UTxOs tried
    /// alone counted every one it passed by unasked (holding no more than the spend pays out) and shared one count
    /// between boxes and the other money, so payments received each holding a token of its own kept a token pool's way
    /// back that pays alone from being asked, and the merge tied as many payers together as paid. T, a mixed token
    /// pool's way back of 14.5 ₳ and its token, pays a 10 ₳ Send, Make public or funding alone, beside two plain ways
    /// back of 9.71 ₳ and, ranked ahead of T in step 1:
    ///
    /// - 13 payments received of 2 ₳, each its own class with a token of its own: none asked (round five's cap, both
    ///   halves at once);
    /// - 12 payments received of 10.5 ₳, the same: each asked and short, its change can't carry its token (the
    ///   shared count on its own);
    /// - 13 mixed token pool ways back of 4.15 ₳, none asked, beside two payments received of 6 ₳ of ADA alone that
    ///   together pay (counting the unasked on its own).
    #[test]
    fn a_token_pools_way_back_that_pays_alone_is_asked_past_twelve_token_utxos() {
        let w = world();
        let t = owned(&w, 0x70, 0, 14_500_000, &[("pooltoken", 1)]);
        let k1 = owned(&w, 0x61, 0, BOX, &[]);
        let k2 = owned(&w, 0x62, 0, BOX, &[]);
        let seedelf = paying(10_000_000);
        let spends: Vec<(&str, Purpose, Vec<AddressPayment>)> = vec![
            ("a Send of 10 ₳ to a Seedelf", Purpose::Pay, Vec::new()),
            (
                "a Make public of 10 ₳",
                Purpose::Pay,
                to_address(10_000_000),
            ),
            (
                "a new session's funding of 5 ₳ and its 5 ₳ collateral",
                Purpose::Fund {
                    session: Some("session:7".into()),
                },
                funding(5_000_000),
            ),
        ];
        let received =
            |u: &UtxoResponse| class(&format!("received:{}", u.tx_hash), Origin::Received);
        let names: Vec<String> = (0..13).map(|i| format!("gift{i:02}")).collect();
        let payments = |count: usize, lovelace: u64| -> Vec<UtxoResponse> {
            (0..count)
                .map(|i| owned(&w, 0x80 + i as u8, 0, lovelace, &[(names[i].as_str(), 1)]))
                .collect()
        };
        let small_boxes: Vec<UtxoResponse> = (0..13u8)
            .map(|i| owned(&w, 0xa0 + i, 0, 4_150_000, &[("poolA", 1)]))
            .collect();
        let ada_payments: Vec<UtxoResponse> = (0..2u8)
            .map(|i| owned(&w, 0x90 + i, 0, 6_000_000, &[]))
            .collect();
        let shapes: Vec<(&str, Vec<(UtxoResponse, Class)>)> = vec![
            (
                "13 payments of 2 ₳, each with a token",
                payments(13, 2_000_000)
                    .into_iter()
                    .map(|u| {
                        let c = received(&u);
                        (u, c)
                    })
                    .collect(),
            ),
            (
                "12 payments of 10.5 ₳, each with a token",
                payments(12, 10_500_000)
                    .into_iter()
                    .map(|u| {
                        let c = received(&u);
                        (u, c)
                    })
                    .collect(),
            ),
            (
                "13 mixed token ways back of 4.15 ₳ and two payments of 6 ₳",
                small_boxes
                    .iter()
                    .map(|u| {
                        (
                            u.clone(),
                            class(&format!("box:{}", u.tx_hash), Origin::Mixed),
                        )
                    })
                    .chain(ada_payments.iter().map(|u| (u.clone(), received(u))))
                    .collect(),
            ),
        ];
        let mut wrong = Vec::new();
        for (shape, ahead) in &shapes {
            for (u, _) in ahead {
                assert!(
                    build::adds(&w.chain.params, u).unwrap() > 0,
                    "{shape}: each adds something"
                );
            }
            let mut known: Vec<(&UtxoResponse, Class)> =
                ahead.iter().map(|(u, c)| (u, c.clone())).collect();
            known.push((&t, class(&format!("box:{}", t.tx_hash), Origin::Mixed)));
            known.push((&k1, class(&format!("box:{}", k1.tx_hash), Origin::Lovejoin)));
            known.push((&k2, class(&format!("box:{}", k2.tx_hash), Origin::Lovejoin)));
            for (name, purpose, pay) in &spends {
                pays_with(&w, std::slice::from_ref(&t), &seedelf, pay)
                    .unwrap_or_else(|e| panic!("{shape}, {name}: T pays alone: {e}"));
                let spent = spent_by(&w, purpose.clone(), &known, &seedelf, pay);
                let tied = spent
                    .iter()
                    .filter(|u| {
                        ahead
                            .iter()
                            .any(|(a, c)| a.tx_hash == u.tx_hash && c.origin == Origin::Received)
                    })
                    .count();
                println!(
                    "{shape}, {name}: spent {} inputs, {tied} of them payments received",
                    spent.len()
                );
                if outpoints(&spent) != one(&t) {
                    wrong.push(format!(
                        "{shape}, {name}: spent {} inputs, {tied} of them payments received, where T pays alone",
                        spent.len()
                    ));
                }
            }
        }
        assert!(
            wrong.is_empty(),
            "a token pool's way back that pays alone left unasked:\n{}",
            wrong.join("\n")
        );
    }

