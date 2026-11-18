#!/usr/bin/env bash
# Build one module at a time, each in a memory-capped scope: past the cap the
# kernel kills that build (and everything it started), never the desktop.
# Every module runs, cheapest first; the summary says how each went and the
# most memory its scope used. A module that builds but logs a Blaster check as
# "Undetermined" is UNDETERM, not ok: Blaster logs that as a warning only, so the
# build passes, but the check proved nothing (a timeout, or no model found). One
# whose log has a `sorry`, or a `#print axioms` naming sorryAx or the compiler's
# axioms (`native_decide`), is SORRY: the kernel didn't check all of it. Both are
# read from the module's own build log, its trace, never from the console, which
# replays every import's log too. A module whose build fails, times out or is
# killed loses its last good build's files, and so does a dependency's module
# that fails, so no reader (tally.py, Audit/count.py) takes that build for this
# one: a module resting on one reads not ok there.
#   ./check.sh                       every Seedelf module but the kernel's (seedelf-every) and Slice/'s
#                                    (seedelf-slice)
#   ./check.sh seedelf-any-tx        Seedelf's properties in every transaction (Seedelf/AnyTx.lean)
#   ./check.sh seedelf-signers       the wallet's core property with 4 to 128 signatories
#   ./check.sh seedelf-policy-any-tx the policy in every transaction, where it needs no slice
#   ./check.sh seedelf-slice         the policy's one-line rule, over an opaque slice (Slice/)
#   ./check.sh seedelf-every         all three Seedelf scripts in every transaction, kernel-checked,
#                                    after what they import (16G, 30m)
#   ./check.sh upstream              the upstream reproductions (Upstream/)
#   ./check.sh upstream-main         ExceptParams against Lean-blaster main
#   ./check.sh lovejoin              Lovejoin's classic pool (chunk 42)
#   ./check.sh lovejoin-v2           v2, the templates with xor32's length checks (chunk 42)
#   ./check.sh lovejoin-v2-pools     v2's general Mix alone, for every pool kind and n = 2 to 4
#   ./check.sh lovejoin-v2-outputs   what that Mix must pay, for the same pools and n
#   ./check.sh lovejoin-owner        Owner withdrawals of several boxes, v2 and the classic pool
#   ./check.sh lovejoin-any-tx       v2 scenario families with arbitrary uninspected fields
#   ./check.sh lovejoin-every        v2's mix_logic and one_shot_mint in every transaction, after what
#                                    they import (16G, 30m)
#   ./check.sh audit-quick           an audit family (Audit/audit-*.txt), then Audit/count.py
#   ./check.sh Seedelf.PolicyMint    some modules (naming a Lovejoin.Every or Seedelf.Every one gives
#                                    the whole run 16G, 30m)
#   CAP=12G LIMIT=20m ./check.sh     other limits
cd "$(dirname "$0")" || exit 1
# lovejoin-every's modules need more than the default cap, named alone too: Collect peaks near 13 GB.
# So do seedelf-every's whole-program roots: Root peaks near 9 GB, Mint near 10.
for a in "$@"; do case $a in lovejoin-every|Lovejoin.Every.*|seedelf-every|Seedelf.Every.*)
  CAP=${CAP:-16G}; LIMIT=${LIMIT:-30m} ;; esac; done
CAP=${CAP:-8G}
LIMIT=${LIMIT:-10m}
mods=("$@")
# Seedelf's every-transaction modules (Seedelf/AnyTx.lean): the same properties with every field
# the script doesn't read left as any Data.
any_tx=(Seedelf.AnyTx Seedelf.AnyTxCover Seedelf.AnyTxSteps Seedelf.AlwaysFalseAnyTx
  Seedelf.WalletPurposeAnyTx Seedelf.WalletNoLockAnyTx Seedelf.WalletRedeemerAnyTx Seedelf.WalletAnyTx Seedelf.WalletAnyTxTwo
  Seedelf.WalletAnyTxThree Seedelf.AnyTxControls Seedelf.WalletAnyTxControls Seedelf.AnyTxShapes)
# The wallet's core property with four signatories and more (gen-seedelf-signers.py), one module
# a length, listed in Seedelf/Signers/modules.txt.
mapfile -t signers < <(grep -v -e '^#' -e '^[[:space:]]*$' Seedelf/Signers/modules.txt)
# The policy in every transaction, where it needs no slice: its other purposes, its redeemer,
# mints of other than one line (to five by Blaster, every length and any mint Data by the kernel:
# the LinesAll modules), and the cover of every context.
policy_any_tx=(Seedelf.PolicyAnyTx Seedelf.PolicyAnyTxSteps Seedelf.PolicyPurposeAnyTx
  Seedelf.PolicyRedeemerAnyTx Seedelf.PolicyLinesAnyTx Seedelf.PolicyLinesFourAnyTx Seedelf.PolicyLinesFiveAnyTx
  Seedelf.LinesAllCek Seedelf.LinesAllLoops Seedelf.PolicyLinesAll Seedelf.LinesAllAnyMint Seedelf.PolicyShapes)
[ ${#mods[@]} -eq 0 ] && mods=(Seedelf.Scripts Seedelf.Scenario Seedelf.Steps Seedelf.AlwaysFalse
  Seedelf.WalletPurpose Seedelf.WalletNoLock Seedelf.WalletRegister "${any_tx[@]}" "${policy_any_tx[@]}"
  "${signers[@]}" Seedelf.PolicyAmount Seedelf.PolicyForeign Seedelf.PolicyBurn Seedelf.PolicyMint)
[ "${mods[0]}" = seedelf-any-tx ] && mods=("${any_tx[@]}")
# All three Seedelf scripts in every transaction, kernel-checked (chunk 48, Seedelf/Every/): the
# modules they import from elsewhere first, in import order, so each scope builds one module.
seedelf_every=(Seedelf.Scripts Seedelf.Scenario Seedelf.Wallet Seedelf.Policy Seedelf.Steps Seedelf.AnyTx
  Seedelf.AnyTxCover Seedelf.AnyTxSteps Seedelf.PolicyAnyTx Seedelf.LinesAllCek Lovejoin.AnyTx.CekCase
  Seedelf.LinesAllLoops Seedelf.PolicyLinesAll Seedelf.LinesAllAnyMint
  Seedelf.Every.Base Seedelf.Every.AlwaysFalse Seedelf.Every.Scalar Seedelf.Every.Prove Seedelf.Every.Signers
  Seedelf.Every.Register Seedelf.Every.Datum Seedelf.Every.Root Seedelf.Every.Typed
  Seedelf.Every.PolicyBase Seedelf.Every.Burn Seedelf.Every.Mint Seedelf.Every.PolicyRoot Seedelf.Every.PolicyTyped)
[ "${mods[0]}" = seedelf-every ] && mods=("${seedelf_every[@]}")
[ "${mods[0]}" = seedelf-signers ] && mods=("${signers[@]}")
[ "${mods[0]}" = seedelf-policy-any-tx ] && mods=("${policy_any_tx[@]}")
[ "${mods[0]}" = upstream ] && mods=(Upstream.ExceptParams Upstream.ByteStrings Upstream.Fq1Fin Upstream.SlicePrograms
  Upstream.SliceNone Upstream.Slice1 Upstream.Slice4 Upstream.Slice16 Upstream.Slice32)
# Owner withdrawals of several boxes, a payer's input and two outputs (gen-lovejoin-owner.py):
# v2 through mix_logic's template, 1 to 4 boxes; the deployed classic pool, 1 to 3.
owners_v2=(
  Lovejoin.V2.OwnAny1 Lovejoin.V2.OwnAny1Spec Lovejoin.V2.OwnAny1Steps Lovejoin.V2.OwnAny1Boxes
  Lovejoin.V2.OwnAny1Passes Lovejoin.V2.OwnAny2 Lovejoin.V2.OwnAny2Spec Lovejoin.V2.OwnAny2Steps
  Lovejoin.V2.OwnAny2Boxes Lovejoin.V2.OwnAny2Passes Lovejoin.V2.OwnAny3 Lovejoin.V2.OwnAny3Spec
  Lovejoin.V2.OwnAny3Steps Lovejoin.V2.OwnAny3Boxes Lovejoin.V2.OwnAny3Passes Lovejoin.V2.OwnAny4
  Lovejoin.V2.OwnAny4Spec Lovejoin.V2.OwnAny4Steps Lovejoin.V2.OwnAny4Boxes Lovejoin.V2.OwnAny4Passes)
owners_classic=(
  Lovejoin.OwnClassic1 Lovejoin.OwnClassic1Spec Lovejoin.OwnClassic1Steps Lovejoin.OwnClassic1Boxes
  Lovejoin.OwnClassic1Passes Lovejoin.OwnClassic2 Lovejoin.OwnClassic2Spec Lovejoin.OwnClassic2Steps
  Lovejoin.OwnClassic2Boxes Lovejoin.OwnClassic2Passes Lovejoin.OwnClassic3 Lovejoin.OwnClassic3Spec
  Lovejoin.OwnClassic3Steps Lovejoin.OwnClassic3Boxes Lovejoin.OwnClassic3Passes)
[ "${mods[0]}" = lovejoin-owner ] && mods=("${owners_v2[@]}" "${owners_classic[@]}")
# Lovejoin's classic mainnet pool (chunk 42), after ./extract-lovejoin.sh.
[ "${mods[0]}" = lovejoin ] && mods=(Lovejoin.Scripts Lovejoin.Box Lovejoin.Steps Lovejoin.ReferenceHolder
  Lovejoin.MixBoxPurpose Lovejoin.MixBoxGate Lovejoin.MixBoxNoLock Lovejoin.MixLogicPurpose Lovejoin.Logic
  Lovejoin.Owner "${owners_classic[@]}")
# v2's general Mix: mix_logic's template, every pool parameter, box point and proof field symbolic.
# MixAny is ADA pools at n = 2; the rest gen-lovejoin-mix.py writes (ADA n = 3, 4; token n = 2, 3, 4).
pools=(
  Lovejoin.V2.MixAny Lovejoin.V2.MixAnySpec Lovejoin.V2.MixAnySteps Lovejoin.V2.MixAnyFirst
  Lovejoin.V2.MixAnySecond Lovejoin.V2.MixAnyPasses Lovejoin.V2.MixAny3 Lovejoin.V2.MixAny3Spec
  Lovejoin.V2.MixAny3Steps Lovejoin.V2.MixAny3Box1 Lovejoin.V2.MixAny3Box2 Lovejoin.V2.MixAny3Box3
  Lovejoin.V2.MixAny3Passes Lovejoin.V2.MixAny4 Lovejoin.V2.MixAny4Spec Lovejoin.V2.MixAny4Steps
  Lovejoin.V2.MixAny4Box1 Lovejoin.V2.MixAny4Box2 Lovejoin.V2.MixAny4Box3 Lovejoin.V2.MixAny4Box4
  Lovejoin.V2.MixAny4Passes Lovejoin.V2.MixTok2 Lovejoin.V2.MixTok2Spec Lovejoin.V2.MixTok2Steps
  Lovejoin.V2.MixTok2Box1 Lovejoin.V2.MixTok2Box2 Lovejoin.V2.MixTok2Passes Lovejoin.V2.MixTok3
  Lovejoin.V2.MixTok3Spec Lovejoin.V2.MixTok3Steps Lovejoin.V2.MixTok3Box1 Lovejoin.V2.MixTok3Box2
  Lovejoin.V2.MixTok3Box3 Lovejoin.V2.MixTok3Passes Lovejoin.V2.MixTok4 Lovejoin.V2.MixTok4Spec
  Lovejoin.V2.MixTok4Steps Lovejoin.V2.MixTok4Box1 Lovejoin.V2.MixTok4Box2 Lovejoin.V2.MixTok4Box3
  Lovejoin.V2.MixTok4Box4 Lovejoin.V2.MixTok4Passes)
[ "${mods[0]}" = lovejoin-v2-pools ] && mods=("${pools[@]}")
# What a Mix must pay, for the same families (gen-lovejoin-mix-outputs.py): its boxes out, any
# pool parameter, box point and proof field symbolic.
outputs=(
  Lovejoin.V2.MixAnyOut Lovejoin.V2.MixAnyOutSteps Lovejoin.V2.MixAnyOutputs Lovejoin.V2.MixAnyDatums
  Lovejoin.V2.MixAny3Out Lovejoin.V2.MixAny3OutSteps Lovejoin.V2.MixAny3Outputs Lovejoin.V2.MixAny3Datums
  Lovejoin.V2.MixAny4Out Lovejoin.V2.MixAny4OutSteps Lovejoin.V2.MixAny4Outputs Lovejoin.V2.MixAny4Datums
  Lovejoin.V2.MixTok2Out Lovejoin.V2.MixTok2OutSteps Lovejoin.V2.MixTok2Outputs Lovejoin.V2.MixTok2Datums
  Lovejoin.V2.MixTok3Out Lovejoin.V2.MixTok3OutSteps Lovejoin.V2.MixTok3Outputs Lovejoin.V2.MixTok3Datums
  Lovejoin.V2.MixTok4Out Lovejoin.V2.MixTok4OutSteps Lovejoin.V2.MixTok4Outputs Lovejoin.V2.MixTok4Datums)
[ "${mods[0]}" = lovejoin-v2-outputs ] && mods=("${outputs[@]}")
# v2: the token-pool templates with xor32's length checks (chunk 42), after ./extract-lovejoin-v2.sh.
[ "${mods[0]}" = lovejoin-v2 ] && mods=(Lovejoin.V2.Scripts Lovejoin.V2.Mix Lovejoin.V2.Logic
  Lovejoin.V2.Steps Lovejoin.V2.MixChallenges Lovejoin.V2.Owner Lovejoin.V2.MixOutputs Lovejoin.V2.MixDatums
  Lovejoin.V2.MixSpec Lovejoin.V2.MixSplit Lovejoin.V2.MixFirst Lovejoin.V2.MixSecond Lovejoin.V2.MixPasses
  Lovejoin.Template.Scripts Lovejoin.Template.Steps
  Lovejoin.Template.MixBoxPurpose Lovejoin.Template.MixBoxGate Lovejoin.Template.MixBoxNoLock
  Lovejoin.Template.Launch Lovejoin.Template.OneShotMint Lovejoin.Template.Fee Lovejoin.Template.FeeContract
  Lovejoin.V2.Mix3 Lovejoin.V2.Mix3Spec Lovejoin.V2.Mix3Steps Lovejoin.V2.Mix3First Lovejoin.V2.Mix3Second
  Lovejoin.V2.Mix3Third Lovejoin.V2.Mix3Passes "${pools[@]}" "${outputs[@]}" "${owners_v2[@]}")
# v2 scenario families and unbounded kernel-checked mix_box/purpose proofs.
any_tx_v2=(Lovejoin.Template.AnyTxPurposes Lovejoin.AnyTx.FeePurpose Lovejoin.AnyTx.PurposesKernel Lovejoin.AnyTx.LogicPublishKernel
  Lovejoin.AnyTx.LogicLength Lovejoin.AnyTx.LogicProofPairs Lovejoin.AnyTx.LogicInputFilter Lovejoin.AnyTx.LogicInputHelpers
  Lovejoin.AnyTx.LogicInputMalformed Lovejoin.AnyTx.LogicInputExtended Lovejoin.AnyTx.LogicInputCover Lovejoin.AnyTx.LogicOwnerVerifier Lovejoin.AnyTx.LogicOwnerScalar
  Lovejoin.AnyTx.LogicOwnerScalarSteps Lovejoin.AnyTx.LogicOwnerPartial Lovejoin.AnyTx.LogicOwnerPairing
  Lovejoin.AnyTx.LogicOwnerPairingPartial Lovejoin.AnyTx.LogicOwnerFinish Lovejoin.AnyTx.LogicOwnerHash
  Lovejoin.AnyTx.LogicOwnerContextPairing Lovejoin.AnyTx.LogicOwnerConditions Lovejoin.AnyTx.LogicOwnerBoundary
  Lovejoin.AnyTx.LogicOwnerBoundaryPartial Lovejoin.AnyTx.LogicOwnerShapesJoin
  Lovejoin.AnyTx.LogicOwnerEntry Lovejoin.AnyTx.LogicOwnerCollectedEntry Lovejoin.AnyTx.LogicOwnerReachableBoundary Lovejoin.AnyTx.LogicOwnerProgramBoundary
  Lovejoin.AnyTx.LaunchSeedSearch Lovejoin.AnyTx.LaunchSeedSlots Lovejoin.AnyTx.LaunchOutputSearch
  Lovejoin.AnyTx.LogicInputRefs Lovejoin.AnyTx.LogicReferenceFilter
  Lovejoin.AnyTx.LogicOwnerParse Lovejoin.AnyTx.LogicMixParse Lovejoin.AnyTx.LogicMixShape Lovejoin.AnyTx.LogicProofBoundary Lovejoin.AnyTx.LogicMixBoundary
  Lovejoin.AnyTx.LogicOwnerMalformed Lovejoin.AnyTx.LogicNoReferenceMany Lovejoin.AnyTx.LogicOwnerNoCarrier Lovejoin.AnyTx.LogicOwnerShape Lovejoin.AnyTx.LogicMixNoCarrier
  Lovejoin.AnyTx.LogicPolicyLookup Lovejoin.AnyTx.LogicNameLookup Lovejoin.AnyTx.LogicCarrierPredicate Lovejoin.AnyTx.LogicCarrierFilterExact
  Lovejoin.AnyTx.LogicWrongQuantity Lovejoin.AnyTx.LogicDuplicateCarrier Lovejoin.AnyTx.LogicCarrierNecessary
  Lovejoin.AnyTx.LogicCarrierVariable Lovejoin.AnyTx.LogicVariableNecessary Lovejoin.AnyTx.LogicBadCarrierDatum Lovejoin.AnyTx.LogicWrongQuantityControls
  Lovejoin.AnyTx.LogicAbsentName Lovejoin.AnyTx.LogicAbsentNameSafety Lovejoin.AnyTx.LogicAbsentNameAfter Lovejoin.AnyTx.LogicAbsentNameAfterSafety
  Lovejoin.AnyTx.LogicAbsentPolicy Lovejoin.AnyTx.LogicAbsentPolicyAfter Lovejoin.AnyTx.LogicCarrierCover Lovejoin.AnyTx.LogicCarrierCoverSafety
  Lovejoin.AnyTx.LogicLedgerValueCover Lovejoin.AnyTx.LogicLedgerCarrier Lovejoin.AnyTx.LogicValueOf Lovejoin.AnyTx.LogicSortedValue Lovejoin.AnyTx.LogicLedgerUniqueness
  Lovejoin.AnyTx.LogicLedgerInline Lovejoin.AnyTx.LogicInlineMalformed Lovejoin.AnyTx.ReferenceHolderPersistence
  Lovejoin.AnyTx.LogicBoxComposition Lovejoin.AnyTx.LogicCarrierCoverControls
  Lovejoin.AnyTx.LogicNoReference Lovejoin.AnyTx.LogicRedeemerFailures Lovejoin.AnyTx.LogicLongControls
  Lovejoin.AnyTx.Common Lovejoin.AnyTx.LogicEmpty Lovejoin.AnyTx.LogicControls
  Lovejoin.AnyTx.OwnerOne Lovejoin.AnyTx.OwnerControls Lovejoin.AnyTx.BoxGate Lovejoin.AnyTx.BoxBoundary Lovejoin.AnyTx.BoxSuffix
  Lovejoin.AnyTx.BoxDatum Lovejoin.AnyTx.BoxControls
  Lovejoin.AnyTx.CekCase Lovejoin.AnyTx.BoxSearch Lovejoin.AnyTx.WithdrawSearch Lovejoin.AnyTx.BoxAll
  Lovejoin.AnyTx.BoxGateAll Lovejoin.AnyTx.BoxMalformed Lovejoin.AnyTx.BoxMalformedShapes Lovejoin.AnyTx.BoxInlineAll
  Lovejoin.AnyTx.BoxComplete Lovejoin.AnyTx.BoxCover Lovejoin.AnyTx.BoxSemantics Lovejoin.AnyTx.BoxPurposesAll Lovejoin.AnyTx.BoxAllControls
  Lovejoin.AnyTx.OwnerLayouts Lovejoin.AnyTx.OwnerTwo
  Lovejoin.AnyTx.Owner3 Lovejoin.AnyTx.Owner4 Lovejoin.AnyTx.OwnerOtherInputs Lovejoin.AnyTx.OwnerMoreControls
  Lovejoin.AnyTx.OwnerManyControls Lovejoin.AnyTx.OwnerOtherControls Lovejoin.AnyTx.Reference Lovejoin.AnyTx.ReferenceControls
  Lovejoin.AnyTx.MixTwo Lovejoin.AnyTx.MixTwoControls Lovejoin.AnyTx.MixOutputs Lovejoin.AnyTx.MixOutputControls
  Lovejoin.AnyTx.MixTokenTwo Lovejoin.AnyTx.MixTokenControls Lovejoin.AnyTx.MixTokenOutputs Lovejoin.AnyTx.MixTokenOutputControls
  Lovejoin.AnyTx.MixAda3 Lovejoin.AnyTx.MixAda3Controls Lovejoin.AnyTx.MixAda3Output Lovejoin.AnyTx.MixAda3OutputControls
  Lovejoin.AnyTx.MixAda4 Lovejoin.AnyTx.MixAda4Controls Lovejoin.AnyTx.MixAda4Output Lovejoin.AnyTx.MixAda4OutputControls
  Lovejoin.AnyTx.MixToken3 Lovejoin.AnyTx.MixToken3Controls Lovejoin.AnyTx.MixToken3Output Lovejoin.AnyTx.MixToken3OutputControls
  Lovejoin.AnyTx.MixToken4 Lovejoin.AnyTx.MixToken4Controls Lovejoin.AnyTx.MixToken4Output Lovejoin.AnyTx.MixToken4OutputControls
  Lovejoin.AnyTx.FeeSpend Lovejoin.AnyTx.FeeRecovery Lovejoin.AnyTx.FeeControls Lovejoin.AnyTx.Launch Lovejoin.AnyTx.LaunchControls
  Lovejoin.AnyTx.OwnerIff Lovejoin.AnyTx.MixIff Lovejoin.AnyTx.FeeMix Lovejoin.AnyTx.FeeMixControls
  Lovejoin.AnyTx.FalsifiedBox Lovejoin.AnyTx.FalsifiedOwner)
[ "${mods[0]}" = lovejoin-any-tx ] && mods=("${any_tx_v2[@]}")
# v2 in every transaction, kernel-checked (chunk 45): the compiled code read back as Lean over Data,
# no fixed list length and no step limit. mix_logic's withdrawals and one_shot_mint's launch, the
# typed theorems over every V3 context, then their restatement in the Aiken source's terms
# (Readable*, Lovejoin/Every/). First the 51 modules they import from outside Lovejoin/Every/, in
# import order, so each scope builds its own module alone: one building several at once can pass 16 GB.
every_imports=(Seedelf.LinesAllCek Lovejoin.AnyTx.CekCase Lovejoin.Template.Scripts
  Lovejoin.AnyTx.BoxSearch Lovejoin.Scripts Seedelf.Scenario Lovejoin.Box Lovejoin.Logic
  Lovejoin.Template.Launch Seedelf.Scripts Seedelf.AnyTx Lovejoin.Template.AnyTxPurposes
  Lovejoin.AnyTx.PurposesKernel Lovejoin.AnyTx.LogicPublishKernel Lovejoin.AnyTx.LogicLength
  Seedelf.Wallet Seedelf.Policy Seedelf.Steps Seedelf.AnyTxSteps Lovejoin.AnyTx.Common
  Lovejoin.AnyTx.BoxAll Lovejoin.AnyTx.WithdrawSearch Lovejoin.AnyTx.BoxGateAll
  Lovejoin.AnyTx.BoxMalformed Lovejoin.AnyTx.BoxMalformedShapes Lovejoin.AnyTx.BoxInlineAll
  Lovejoin.AnyTx.BoxComplete Seedelf.AnyTxCover Lovejoin.AnyTx.BoxCover Lovejoin.AnyTx.LogicInputRefs
  Lovejoin.AnyTx.LogicReferenceFilter Lovejoin.AnyTx.LogicPolicyLookup Lovejoin.AnyTx.LogicNameLookup
  Lovejoin.AnyTx.LogicCarrierPredicate Lovejoin.AnyTx.LogicCarrierFilterExact
  Lovejoin.AnyTx.LogicCarrierVariable Lovejoin.AnyTx.LogicAbsentName Lovejoin.AnyTx.LogicAbsentNameAfter
  Lovejoin.AnyTx.LogicAbsentPolicy Lovejoin.AnyTx.LogicAbsentPolicyAfter
  Lovejoin.AnyTx.LogicCarrierCover Lovejoin.AnyTx.LogicOwnerParse Lovejoin.AnyTx.LogicMixParse
  Lovejoin.AnyTx.LogicProofBoundary Lovejoin.AnyTx.LogicOwnerMalformed Lovejoin.AnyTx.LogicNoReference
  Lovejoin.AnyTx.LogicNoReferenceMany Lovejoin.AnyTx.LogicOwnerNoCarrier
  Lovejoin.AnyTx.LogicCarrierCoverSafety Lovejoin.AnyTx.LogicLedgerValueCover
  Lovejoin.AnyTx.LogicLedgerCarrier)
every=("${every_imports[@]}" Lovejoin.Every.Base Lovejoin.Every.Lookup Lovejoin.Every.Carrier Lovejoin.Every.Collect
  Lovejoin.Every.Shared Lovejoin.Every.Owner Lovejoin.Every.Main Lovejoin.Every.Fold Lovejoin.Every.Value
  Lovejoin.Every.Walk Lovejoin.Every.MixPred Lovejoin.Every.Mix Lovejoin.Every.Withdraw Lovejoin.Every.Typed
  Lovejoin.Every.Mint Lovejoin.Every.MintSpec Lovejoin.Every.MintConds Lovejoin.Every.MintCheck
  Lovejoin.Every.MintRoot Lovejoin.Every.MintTyped Lovejoin.Every.ReadableBase Lovejoin.Every.ReadableOwner
  Lovejoin.Every.ReadableMix Lovejoin.Every.ReadableLaunch Lovejoin.Every.Readable)
[ "${mods[0]}" = lovejoin-every ] && mods=("${every[@]}")
# The audit (Audit/): each family's modules, cheapest first, one per line in Audit/<family>.txt.
case ${mods[0]} in audit-*) [ -f "Audit/${mods[0]}.txt" ] &&
  mapfile -t mods < <(grep -v -e '^#' -e '^[[:space:]]*$' "Audit/${mods[0]}.txt") ;; esac
# The policy's rule for one mint line in every transaction, over an opaque SliceByteString, in
# its own package (Slice/): the modules given, or those in Slice/modules.txt.
[ "${mods[0]}" = seedelf-slice ] && { cd Slice || exit 1
  if [ ${#mods[@]} -gt 1 ]; then mods=("${mods[@]:1}")
  else mapfile -t mods < <(grep -v -e '^#' -e '^[[:space:]]*$' modules.txt); fi; }
# The same ExceptParams file in its own package, against Lean-blaster main.
[ "${mods[0]}" = upstream-main ] && { cd Upstream/blaster-main || exit 1; mods=(BlasterMain.ExceptParams); }
peakf=$(mktemp)
outf=$(mktemp)
summary=()
check_failed=0
# The package that holds module M's source: this one (.), or the dependency under
# .lake/packages/ that does. Fails when neither does.
root_of() {
  case $1 in ''|*[!A-Za-z0-9_.]*|.*|*.|*..*) return 1 ;; esac
  local p=${1//.//} d
  [ -f "$p.lean" ] && { echo .; return 0; }
  for d in .lake/packages/*/; do [ -f "$d$p.lean" ] && { echo "${d%/}"; return 0; }; done
  return 1
}
# Lake writes a module's trace only when its build ends, and never removes one: a failed
# rebuild leaves the last good build's, newer than the source, and tally.py and Audit/count.py
# would read it as this run's. So a failed module's build goes, as if it had never built, here
# or in the dependency that holds it: the trace, the .olean, .ilean and .c, and their hashes.
# The .olean must go too: with no trace, Lake would take an old .olean as up to date by its
# date, and this would say ok to a build that proved nothing. Fails when M is no module of this
# package or a dependency's.
forget() {
  local r p=${1//.//} was= where=
  r=$(root_of "$1") || return 1
  [ "$r" = . ] || where=" (in $r)"
  [ -e "$r/.lake/build/lib/lean/$p.trace" ] || [ -e "$r/.lake/build/lib/lean/$p.olean" ] && was=1
  rm -f "$r/.lake/build/lib/lean/$p".* "$r/.lake/build/ir/$p".*
  [ -n "$was" ] && echo "== $1 failed$where: its last good build removed, so it reads as not built"
  return 0
}
# A module's own build log, its trace, after a build that passed (Lake writes it as the build
# ends, and so it is this run's): how many of its Blaster checks are Undetermined, and how many
# entries show a proof the kernel didn't check, a `sorry` or a `#print axioms` naming sorryAx or
# the compiler's axioms (`native_decide`). Each message is read whole: Lean breaks an axiom list
# past 120 columns, one axiom a line. Prints "- -" when there's no trace to read.
own_log() {
  python3 -I - "$1" <<'EOF'
import json, sys
try:
    log = json.load(open(sys.argv[1], encoding="utf-8")).get("log", [])
except (OSError, ValueError):
    print("- -"); raise SystemExit
msgs = [(e.get("level"), e.get("message", "")) for e in log]
undet = sum(l == "warning" and "Undetermined" in m for l, m in msgs)
unsound = sum("declaration uses 'sorry'" in m or ("depends on axioms" in m and any(
    a in m for a in ("sorryAx", "Lean.ofReduceBool", "Lean.trustCompiler"))) for _, m in msgs)
print(undet, unsound)
EOF
}
for m in "${mods[@]}"; do
  echo "== $m (cap $CAP, limit $LIMIT)"
  start=$SECONDS
  : > "$peakf"
  # The scope's own cgroup records its peak; a killed scope never writes it.
  systemd-run --user --scope -q -p MemoryMax="$CAP" -p MemorySwapMax=0 -p OOMPolicy=kill \
    bash -c 'timeout "$1" lake build "$2"; rc=$?
      cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.peak" > "$3" 2>/dev/null
      exit $rc' _ "$LIMIT" "$m" "$peakf" 2>&1 \
    | grep -v -E "Replayed|PlutusCore/UPLC/CekMachine\.lean:[0-9]+:[0-9]+: declaration uses 'sorry'|Successfully decoded|^trace: \.> LEAN_PATH" \
    | tee "$outf"
  rc=${PIPESTATUS[0]}
  # The verdict comes from the module's own log, its trace (own_log), never from the console:
  # the console replays every import's log too, a dependency's included (PlutusCoreBlaster's own
  # `sorry`, in CekMachine.lean, which the filter above only keeps off the screen). Lean logs a
  # `sorry` with a warning, and a `native_decide` with no word but in a `#print axioms`.
  undet=0 unsound=0
  if [ "$rc" = 0 ]; then
    undet= unsound=
    r=$(root_of "$m") && read -r undet unsound < <(own_log "$r/.lake/build/lib/lean/${m//.//}.trace")
    # No trace, or no count read from it (python3 missing, say), is no verdict.
    case $undet.$unsound in *[!0-9.]*|.*|*.) rc=notrace ;;
      *) if [ "$unsound" -gt 0 ]; then rc=sorry; elif [ "$undet" -gt 0 ]; then rc=undetermined; fi ;; esac
  fi
  # A failed build: forget each module Lake says failed (`✖ … Building M`), here or in a
  # dependency. A module whose import failed never started, and keeps its build: the readers
  # see that what it rests on has none. A timeout or a kill leaves no word of which build it
  # stopped, nor does a failure Lake pins on no module here or in a dependency, so then the
  # module asked for goes too.
  case $rc in 0|undetermined|sorry|notrace) ;; *)
    found=
    for f in $(grep -aoE '✖ \[[0-9]+/[0-9]+\] Building [A-Za-z0-9_.]+' "$outf" | awk '{print $NF}'); do
      forget "$f" && found=1; done
    [ "$rc" = 1 ] && [ -n "$found" ] || forget "$m" ;; esac
  [ "$rc" = 0 ] || check_failed=1
  took=$((SECONDS - start))s
  peak=$(cat "$peakf")
  [ -n "$peak" ] && peak=", peak $((peak / 1048576)) MB"
  case $rc in
    0) summary+=("ok        $m ($took$peak)") ;;
    undetermined) summary+=("UNDETERM  $m ($undet Undetermined, $took$peak)") ;;
    sorry) summary+=("SORRY     $m ($unsound sorry or native_decide$([ "$undet" -gt 0 ] && echo ", $undet Undetermined"), $took$peak)") ;;
    notrace) summary+=("NO TRACE  $m (built, but left no trace to read, $took$peak)") ;;
    124) summary+=("TIMEOUT   $m (past $LIMIT$peak)") ;;
    137) summary+=("KILLED    $m (over $CAP, $took)") ;;
    *) summary+=("FAILED    $m (exit $rc, $took$peak)") ;;
  esac
done
rm -f "$peakf" "$outf"
echo
echo "== summary"
printf '%s\n' "${summary[@]}"
exit "$check_failed"
