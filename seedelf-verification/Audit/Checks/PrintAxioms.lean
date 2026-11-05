-- Build-evidence check (scratch): the axioms behind every theorem with an olean.
-- Run last, after every other family: `./check.sh audit-last`. `lake build` brings any stale
-- import up to date inside this module's own limit, so refresh them first
-- (`LIMIT=30m ./check.sh audit-refresh`).
-- Expected: each blaster theorem `depends on axioms: [blasterProven]` (Lean may add propext,
-- Classical.choice, Quot.sound); each rfl lemma only those three or none. Never sorryAx,
-- Lean.ofReduceBool or Lean.trustCompiler.

import Seedelf.AlwaysFalse
import Seedelf.WalletPurpose
import Seedelf.WalletNoLock
import Seedelf.WalletRegister
import Seedelf.PolicyAmount
import Seedelf.PolicyForeign
import Lovejoin.ReferenceHolder
import Lovejoin.MixBoxPurpose
import Lovejoin.MixBoxGate
import Lovejoin.MixBoxNoLock
import Lovejoin.MixLogicPurpose
import Lovejoin.Owner
import Lovejoin.OwnClassic1Boxes
import Lovejoin.OwnClassic1Passes
import Lovejoin.OwnClassic2Boxes
import Lovejoin.OwnClassic2Passes
import Lovejoin.OwnClassic3Boxes
import Lovejoin.OwnClassic3Passes
import Lovejoin.V2.MixChallenges
import Lovejoin.V2.Owner
import Lovejoin.V2.MixOutputs
import Lovejoin.V2.MixDatums
import Lovejoin.V2.MixFirst
import Lovejoin.V2.MixSecond
import Lovejoin.V2.MixPasses
import Lovejoin.Template.MixBoxPurpose
import Lovejoin.Template.MixBoxGate
import Lovejoin.Template.MixBoxNoLock
import Lovejoin.Template.OneShotMint
import Lovejoin.Template.FeeContract
import Lovejoin.V2.Mix3First
import Lovejoin.V2.Mix3Second
import Lovejoin.V2.Mix3Third
import Lovejoin.V2.Mix3Passes
import Lovejoin.V2.MixAnyFirst
import Lovejoin.V2.MixAnySecond
import Lovejoin.V2.MixAnyPasses
import Lovejoin.V2.MixAny3Box1
import Lovejoin.V2.MixAny3Box2
import Lovejoin.V2.MixAny3Box3
import Lovejoin.V2.MixAny3Passes
import Lovejoin.V2.MixAny4Box1
import Lovejoin.V2.MixAny4Box2
import Lovejoin.V2.MixAny4Box3
import Lovejoin.V2.MixAny4Box4
import Lovejoin.V2.MixAny4Passes
import Lovejoin.V2.MixTok2Box1
import Lovejoin.V2.MixTok2Box2
import Lovejoin.V2.MixTok2Passes
import Lovejoin.V2.MixTok3Box1
import Lovejoin.V2.MixTok3Box2
import Lovejoin.V2.MixTok3Box3
import Lovejoin.V2.MixTok3Passes
import Lovejoin.V2.MixTok4Box1
import Lovejoin.V2.MixTok4Box2
import Lovejoin.V2.MixTok4Box3
import Lovejoin.V2.MixTok4Box4
import Lovejoin.V2.MixTok4Passes
import Lovejoin.V2.MixAnyOut
import Lovejoin.V2.MixAnyOutputs
import Lovejoin.V2.MixAnyDatums
import Lovejoin.V2.MixAny3Out
import Lovejoin.V2.MixAny3Outputs
import Lovejoin.V2.MixAny3Datums
import Lovejoin.V2.MixAny4Out
import Lovejoin.V2.MixAny4Outputs
import Lovejoin.V2.MixAny4Datums
import Lovejoin.V2.MixTok2Out
import Lovejoin.V2.MixTok2Outputs
import Lovejoin.V2.MixTok2Datums
import Lovejoin.V2.MixTok3Out
import Lovejoin.V2.MixTok3Outputs
import Lovejoin.V2.MixTok3Datums
import Lovejoin.V2.MixTok4Out
import Lovejoin.V2.MixTok4Outputs
import Lovejoin.V2.MixTok4Datums
import Lovejoin.V2.OwnAny1Boxes
import Lovejoin.V2.OwnAny1Passes
import Lovejoin.V2.OwnAny2Boxes
import Lovejoin.V2.OwnAny2Passes
import Lovejoin.V2.OwnAny3Boxes
import Lovejoin.V2.OwnAny3Passes
import Lovejoin.V2.OwnAny4Boxes
import Lovejoin.V2.OwnAny4Passes

#print axioms Seedelf.V1.always_false_always_fails
#print axioms Seedelf.V1.wallet_fails_minting
#print axioms Seedelf.V1.wallet_fails_rewarding
#print axioms Seedelf.V1.wallet_fails_certifying
#print axioms Seedelf.V1.wallet_fails_voting
#print axioms Seedelf.V1.wallet_fails_proposing
#print axioms Seedelf.V1.spendable_no_datum
#print axioms Seedelf.V1.spendable_bytes
#print axioms Seedelf.V1.spendable_int
#print axioms Seedelf.V1.spendable_list
#print axioms Seedelf.V1.spendable_map
#print axioms Seedelf.V1.spendable_constr_pos
#print axioms Seedelf.V1.spendable_constr_neg
#print axioms Seedelf.V1.spendable_fields0
#print axioms Seedelf.V1.spendable_fields1
#print axioms Seedelf.V1.spendable_fields3
#print axioms Seedelf.V1.spendable_first_constr
#print axioms Seedelf.V1.spendable_first_map
#print axioms Seedelf.V1.spendable_first_list
#print axioms Seedelf.V1.spendable_first_i
#print axioms Seedelf.V1.spendable_second_constr
#print axioms Seedelf.V1.spendable_second_map
#print axioms Seedelf.V1.spendable_second_list
#print axioms Seedelf.V1.spendable_second_i
#print axioms Seedelf.V1.wallet_register_spend_iff
#print axioms Seedelf.V1.other_amounts_fail
#print axioms Seedelf.V1.foreign_mint_fails
#print axioms Seedelf.V1.foreign_burn_fails
#print axioms Lovejoin.Classic.reference_holder_always_fails
#print axioms Lovejoin.Classic.mix_box_fails_minting
#print axioms Lovejoin.Classic.mix_box_fails_rewarding
#print axioms Lovejoin.Classic.mix_box_fails_certifying
#print axioms Lovejoin.Classic.mix_box_fails_voting
#print axioms Lovejoin.Classic.mix_box_fails_proposing
#print axioms Lovejoin.Classic.box_moves_alone_iff_malformed
#print axioms Lovejoin.Classic.well_formed_box_needs_mix_logic
#print axioms Lovejoin.Classic.well_formed_box_moves_with_mix_logic
#print axioms Lovejoin.Classic.well_formed_box_refuses_another_script
#print axioms Lovejoin.Classic.well_formed_box_refuses_a_key
#print axioms Lovejoin.Classic.box_no_datum_moves
#print axioms Lovejoin.Classic.box_by_hash_moves
#print axioms Lovejoin.Classic.box_bytes_moves
#print axioms Lovejoin.Classic.box_int_moves
#print axioms Lovejoin.Classic.box_list_moves
#print axioms Lovejoin.Classic.box_map_moves
#print axioms Lovejoin.Classic.box_constr_pos_moves
#print axioms Lovejoin.Classic.box_constr_neg_moves
#print axioms Lovejoin.Classic.box_fields0_moves
#print axioms Lovejoin.Classic.box_fields1_moves
#print axioms Lovejoin.Classic.box_fields3_moves
#print axioms Lovejoin.Classic.box_first_constr_moves
#print axioms Lovejoin.Classic.box_first_map_moves
#print axioms Lovejoin.Classic.box_first_list_moves
#print axioms Lovejoin.Classic.box_first_i_moves
#print axioms Lovejoin.Classic.box_second_constr_moves
#print axioms Lovejoin.Classic.box_second_map_moves
#print axioms Lovejoin.Classic.box_second_list_moves
#print axioms Lovejoin.Classic.box_second_i_moves
#print axioms Lovejoin.Classic.mix_logic_fails_spending
#print axioms Lovejoin.Classic.mix_logic_fails_minting
#print axioms Lovejoin.Classic.mix_logic_fails_voting
#print axioms Lovejoin.Classic.mix_logic_fails_proposing
#print axioms Lovejoin.Classic.mix_logic_publishes_iff_registration
#print axioms Lovejoin.Classic.mix_logic_refuses_other_certificates
#print axioms Lovejoin.Classic.owner_withdraws_iff_proof
#print axioms Lovejoin.Classic.Own1.own_classic1_needs_the_first_box_proof
#print axioms Lovejoin.Classic.Own1.own_classic1_passes_with_every_proof
#print axioms Lovejoin.Classic.Own2.own_classic2_needs_the_first_box_proof
#print axioms Lovejoin.Classic.Own2.own_classic2_needs_the_second_box_proof
#print axioms Lovejoin.Classic.Own2.own_classic2_passes_with_every_proof
#print axioms Lovejoin.Classic.Own3.own_classic3_needs_the_first_box_proof
#print axioms Lovejoin.Classic.Own3.own_classic3_needs_the_second_box_proof
#print axioms Lovejoin.Classic.Own3.own_classic3_needs_the_third_box_proof
#print axioms Lovejoin.Classic.Own3.own_classic3_passes_with_every_proof
#print axioms Lovejoin.V2.mix_refuses_a_challenge_not_32_bytes
#print axioms Lovejoin.V2.owner_withdraws_iff_proof
#print axioms Lovejoin.V2.mix_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.mix_boxes_hold_the_box_value
#print axioms Lovejoin.V2.mix_first_box_holds_no_token
#print axioms Lovejoin.V2.mix_second_box_holds_no_token
#print axioms Lovejoin.V2.mix_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.mix_first_box_datum_inline
#print axioms Lovejoin.V2.mix_second_box_datum_inline
#print axioms Lovejoin.V2.mix_needs_the_first_challenge
#print axioms Lovejoin.V2.mix_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.mix_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.firstAccepts_parts
#print axioms Lovejoin.V2.mix_needs_the_second_challenge
#print axioms Lovejoin.V2.mix_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.mix_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.secondAccepts_parts
#print axioms Lovejoin.V2.mix_passes_with_both_proofs
#print axioms Lovejoin.V2.mixAccepts_halves
#print axioms Lovejoin.Template.mix_box_fails_minting
#print axioms Lovejoin.Template.mix_box_fails_rewarding
#print axioms Lovejoin.Template.mix_box_fails_certifying
#print axioms Lovejoin.Template.mix_box_fails_voting
#print axioms Lovejoin.Template.mix_box_fails_proposing
#print axioms Lovejoin.Template.box_moves_alone_iff_malformed
#print axioms Lovejoin.Template.well_formed_box_needs_mix_logic
#print axioms Lovejoin.Template.well_formed_box_moves_with_mix_logic
#print axioms Lovejoin.Template.well_formed_box_refuses_another_script
#print axioms Lovejoin.Template.well_formed_box_refuses_a_key
#print axioms Lovejoin.Template.box_no_datum_moves
#print axioms Lovejoin.Template.box_by_hash_moves
#print axioms Lovejoin.Template.box_bytes_moves
#print axioms Lovejoin.Template.box_int_moves
#print axioms Lovejoin.Template.box_list_moves
#print axioms Lovejoin.Template.box_map_moves
#print axioms Lovejoin.Template.box_constr_pos_moves
#print axioms Lovejoin.Template.box_constr_neg_moves
#print axioms Lovejoin.Template.box_fields0_moves
#print axioms Lovejoin.Template.box_fields1_moves
#print axioms Lovejoin.Template.box_fields3_moves
#print axioms Lovejoin.Template.box_first_constr_moves
#print axioms Lovejoin.Template.box_first_map_moves
#print axioms Lovejoin.Template.box_first_list_moves
#print axioms Lovejoin.Template.box_first_i_moves
#print axioms Lovejoin.Template.box_second_constr_moves
#print axioms Lovejoin.Template.box_second_map_moves
#print axioms Lovejoin.Template.box_second_list_moves
#print axioms Lovejoin.Template.box_second_i_moves
#print axioms Lovejoin.Template.nft_is_one_token_named_lovejoin
#print axioms Lovejoin.Template.nft_needs_the_seed
#print axioms Lovejoin.Template.nft_is_alone_under_its_policy
#print axioms Lovejoin.Template.nft_lands_at_reference_holder
#print axioms Lovejoin.Template.nft_needs_a_sane_datum
#print axioms Lovejoin.Template.shard_pays_exactly_the_fee
#print axioms Lovejoin.Template.shard_needs_three_boxes
#print axioms Lovejoin.Template.shard_pays_no_withdrawal
#print axioms Lovejoin.Template.shard_needs_mix_logic
#print axioms Lovejoin.Template.shard_only_grows
#print axioms Lovejoin.V2.N3.mix3_needs_the_first_challenge
#print axioms Lovejoin.V2.N3.mix3_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_first_proofs_third_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_second_challenge
#print axioms Lovejoin.V2.N3.mix3_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_second_proofs_third_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_third_challenge
#print axioms Lovejoin.V2.N3.mix3_needs_the_third_proofs_first_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_third_proofs_second_branch
#print axioms Lovejoin.V2.N3.mix3_needs_the_third_proofs_third_branch
#print axioms Lovejoin.V2.N3.mix3_passes_with_every_proof
#print axioms Lovejoin.V2.Any.mix_any_needs_the_first_challenge
#print axioms Lovejoin.V2.Any.mix_any_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Any.mix_any_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Any.mix_any_needs_the_second_challenge
#print axioms Lovejoin.V2.Any.mix_any_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Any.mix_any_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Any.mix_any_passes_with_both_proofs
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_first_challenge
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_first_proofs_third_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_second_challenge
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_second_proofs_third_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_third_challenge
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_third_proofs_first_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_third_proofs_second_branch
#print axioms Lovejoin.V2.Any3.mixany3_needs_the_third_proofs_third_branch
#print axioms Lovejoin.V2.Any3.mixany3_passes_with_every_proof
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_first_challenge
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_first_proofs_third_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_first_proofs_fourth_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_second_challenge
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_second_proofs_third_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_second_proofs_fourth_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_third_challenge
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_third_proofs_first_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_third_proofs_second_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_third_proofs_third_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_third_proofs_fourth_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_fourth_challenge
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_fourth_proofs_first_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_fourth_proofs_second_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_fourth_proofs_third_branch
#print axioms Lovejoin.V2.Any4.mixany4_needs_the_fourth_proofs_fourth_branch
#print axioms Lovejoin.V2.Any4.mixany4_passes_with_every_proof
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_first_challenge
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_second_challenge
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Tok2.mixtok2_passes_with_every_proof
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_first_challenge
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_first_proofs_third_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_second_challenge
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_second_proofs_third_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_third_challenge
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_third_proofs_first_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_third_proofs_second_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_the_third_proofs_third_branch
#print axioms Lovejoin.V2.Tok3.mixtok3_passes_with_every_proof
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_first_challenge
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_first_proofs_first_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_first_proofs_second_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_first_proofs_third_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_first_proofs_fourth_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_second_challenge
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_second_proofs_first_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_second_proofs_second_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_second_proofs_third_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_second_proofs_fourth_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_third_challenge
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_third_proofs_first_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_third_proofs_second_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_third_proofs_third_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_third_proofs_fourth_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_fourth_challenge
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_fourth_proofs_first_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_fourth_proofs_second_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_fourth_proofs_third_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_the_fourth_proofs_fourth_branch
#print axioms Lovejoin.V2.Tok4.mixtok4_passes_with_every_proof
#print axioms Lovejoin.V2.Any.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Any.mixany_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Any.mixany_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Any.mixany_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Any.mixany_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Any.mixany_needs_every_box_out
#print axioms Lovejoin.V2.Any.mixany_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Any.mixany_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Any.mixany_first_box_datum_inline
#print axioms Lovejoin.V2.Any.mixany_second_box_datum_inline
#print axioms Lovejoin.V2.Any3.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Any3.mixany3_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Any3.mixany3_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Any3.mixany3_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Any3.mixany3_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Any3.mixany3_third_box_holds_no_other_token
#print axioms Lovejoin.V2.Any3.mixany3_needs_every_box_out
#print axioms Lovejoin.V2.Any3.mixany3_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Any3.mixany3_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Any3.mixany3_first_box_datum_inline
#print axioms Lovejoin.V2.Any3.mixany3_second_box_datum_inline
#print axioms Lovejoin.V2.Any3.mixany3_third_box_datum_inline
#print axioms Lovejoin.V2.Any4.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Any4.mixany4_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Any4.mixany4_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Any4.mixany4_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Any4.mixany4_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Any4.mixany4_third_box_holds_no_other_token
#print axioms Lovejoin.V2.Any4.mixany4_fourth_box_holds_no_other_token
#print axioms Lovejoin.V2.Any4.mixany4_needs_every_box_out
#print axioms Lovejoin.V2.Any4.mixany4_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Any4.mixany4_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Any4.mixany4_first_box_datum_inline
#print axioms Lovejoin.V2.Any4.mixany4_second_box_datum_inline
#print axioms Lovejoin.V2.Any4.mixany4_third_box_datum_inline
#print axioms Lovejoin.V2.Any4.mixany4_fourth_box_datum_inline
#print axioms Lovejoin.V2.Tok2.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Tok2.mixtok2_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Tok2.mixtok2_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Tok2.mixtok2_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok2.mixtok2_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok2.mixtok2_needs_every_box_out
#print axioms Lovejoin.V2.Tok2.mixtok2_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Tok2.mixtok2_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Tok2.mixtok2_first_box_datum_inline
#print axioms Lovejoin.V2.Tok2.mixtok2_second_box_datum_inline
#print axioms Lovejoin.V2.Tok3.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Tok3.mixtok3_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Tok3.mixtok3_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Tok3.mixtok3_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok3.mixtok3_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok3.mixtok3_third_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok3.mixtok3_needs_every_box_out
#print axioms Lovejoin.V2.Tok3.mixtok3_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Tok3.mixtok3_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Tok3.mixtok3_first_box_datum_inline
#print axioms Lovejoin.V2.Tok3.mixtok3_second_box_datum_inline
#print axioms Lovejoin.V2.Tok3.mixtok3_third_box_datum_inline
#print axioms Lovejoin.V2.Tok4.mixCtxOuts_is_the_mix
#print axioms Lovejoin.V2.Tok4.mixtok4_pays_its_boxes_to_mix_box
#print axioms Lovejoin.V2.Tok4.mixtok4_boxes_hold_the_box_value
#print axioms Lovejoin.V2.Tok4.mixtok4_first_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok4.mixtok4_second_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok4.mixtok4_third_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok4.mixtok4_fourth_box_holds_no_other_token
#print axioms Lovejoin.V2.Tok4.mixtok4_needs_every_box_out
#print axioms Lovejoin.V2.Tok4.mixtok4_pays_no_other_box_to_mix_box
#print axioms Lovejoin.V2.Tok4.mixtok4_boxes_carry_well_formed_datums
#print axioms Lovejoin.V2.Tok4.mixtok4_first_box_datum_inline
#print axioms Lovejoin.V2.Tok4.mixtok4_second_box_datum_inline
#print axioms Lovejoin.V2.Tok4.mixtok4_third_box_datum_inline
#print axioms Lovejoin.V2.Tok4.mixtok4_fourth_box_datum_inline
#print axioms Lovejoin.V2.Own1.own_any1_needs_the_first_box_proof
#print axioms Lovejoin.V2.Own1.own_any1_passes_with_every_proof
#print axioms Lovejoin.V2.Own2.own_any2_needs_the_first_box_proof
#print axioms Lovejoin.V2.Own2.own_any2_needs_the_second_box_proof
#print axioms Lovejoin.V2.Own2.own_any2_passes_with_every_proof
#print axioms Lovejoin.V2.Own3.own_any3_needs_the_first_box_proof
#print axioms Lovejoin.V2.Own3.own_any3_needs_the_second_box_proof
#print axioms Lovejoin.V2.Own3.own_any3_needs_the_third_box_proof
#print axioms Lovejoin.V2.Own3.own_any3_passes_with_every_proof
#print axioms Lovejoin.V2.Own4.own_any4_needs_the_first_box_proof
#print axioms Lovejoin.V2.Own4.own_any4_needs_the_second_box_proof
#print axioms Lovejoin.V2.Own4.own_any4_needs_the_third_box_proof
#print axioms Lovejoin.V2.Own4.own_any4_needs_the_fourth_box_proof
#print axioms Lovejoin.V2.Own4.own_any4_passes_with_every_proof
