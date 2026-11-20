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
# replays every import's log too. Each module of this package that a module imports,
# directly or not, and the run doesn't list is read the same way, from its own
# trace and under its own name ("an import of"), once a run. A module whose build
# fails just as expected-failures.txt records, its listed theorems failing with the
# recorded error and nothing else in it amiss, is EXPECTED (expected(), below), and
# its imports are read as a passing build's. So the exit status is 0 only when every
# module listed and every module of this package under them reads ok or EXPECTED;
# a dependency's module counts only when its build fails. A module whose build
# fails, times out or is killed loses its last good build's files, and so does a
# dependency's module that fails, so no reader (tally.py, Audit/count.py) takes
# that build for this one: a module resting on one reads not ok there. Once a
# build passes, each trace read is dated to the build's start, a replayed one too,
# since Lake replays a log only for the source it was built from: the readers'
# test, a trace newer than its source, then holds. The .olean keeps the build's date.
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
# The theorems that fail by design (expected()), read from here whichever package a family builds in.
XFAIL=$PWD/expected-failures.txt
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
# A build's start, for its traces' date; and the modules this run lists or has read.
stampf=$(mktemp)
seenf=$(mktemp)
printf '%s\n' "${mods[@]}" > "$seenf"
summary=()
check_failed=0
imports=0 imports_ok=0
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
# After a build of module M that passed, which built or replayed M and everything it imports:
# M's own build log, its trace, then each trace of a module of this package M imports, directly
# or not, that $seenf doesn't name (the run lists it, or read it already). For each, how many of
# its Blaster checks are Undetermined, and how many entries show a proof the kernel didn't check,
# a `sorry` or a `#print axioms` naming sorryAx or the compiler's axioms (`native_decide`). Each
# message is read whole: Lean breaks an axiom list past 120 columns, one axiom a line. Prints
# M's two counts, then one line for each import, its name and counts; "-" for a count when
# there's no trace to read. Imports are found as tally.py's are, `import` in the source with
# comments and strings stripped. Each trace read is dated to $stampf's time, the build's start.
judge() {
  python3 -I - "$1" "$stampf" "$seenf" <<'EOF'
import glob, json, os, re, sys
mod, stamp = sys.argv[1], os.stat(sys.argv[2]).st_mtime_ns
seen = set(open(sys.argv[3], encoding="utf-8").read().split())
IMPORT = r"(?<![\w.])import\s+([A-Za-z_][\w.]*)"


def rel(m, ext):
    return os.path.join(*m.split(".")) + ext


def strip(src):
    out, i, depth, n = [], 0, 0, len(src)
    while i < n:
        if src.startswith("/-", i):
            depth += 1; i += 2
        elif depth and src.startswith("-/", i):
            depth -= 1; i += 2
        elif depth:
            i += 1
        elif src.startswith("--", i):
            j = src.find("\n", i); i = n if j < 0 else j
        elif src[i] == '"':
            j = i + 1
            while j < n and src[j] != '"':
                j += 2 if src[j] == "\\" else 1
            out.append('""'); i = j + 1
        else:
            out.append(src[i]); i += 1
    return "".join(out)


def counts(root, m):
    trace = os.path.join(root, ".lake", "build", "lib", "lean", rel(m, ".trace"))
    try:
        msgs = [(e.get("level"), e.get("message", ""))
                for e in json.load(open(trace, encoding="utf-8")).get("log", [])]
        undet = sum(l == "warning" and "Undetermined" in s for l, s in msgs)
        unsound = sum("declaration uses 'sorry'" in s or ("depends on axioms" in s and any(
            a in s for a in ("sorryAx", "Lean.ofReduceBool", "Lean.trustCompiler"))) for _, s in msgs)
    except (OSError, ValueError, AttributeError, TypeError):
        return "- -"
    try:
        os.utime(trace, ns=(os.stat(trace).st_atime_ns, stamp))
    except OSError:
        pass
    return f"{undet} {unsound}"


roots = ["."] + sorted(glob.glob(os.path.join(".lake", "packages", "*")))
root = None
if re.fullmatch(r"\w+(\.\w+)*", mod, re.ASCII):
    root = next((r for r in roots if os.path.isfile(os.path.join(r, rel(mod, ".lean")))), None)
print("- -" if root is None else counts(root, mod))
found, todo = set(), [mod] if root == "." else []
while todo:
    try:
        src = strip(open(rel(todo.pop(), ".lean"), encoding="utf-8").read())
    except (OSError, ValueError):
        continue
    for imp in re.findall(IMPORT, src):
        if imp != mod and imp not in found and os.path.isfile(rel(imp, ".lean")):
            found.add(imp); todo.append(imp)
for imp in sorted(found - seen):
    print(imp, counts(".", imp))
EOF
}
# After module M's build failed (exit 1), its console in $2: whether it failed just as
# expected-failures.txt records M's entry. Each theorem the entry's `fails:` names fails with an
# error that begins as its `with:` does; no other error, here or in another module's build; nothing
# in M is Undetermined, a sorry, a ❌ or a compiler-trusting axiom; and M's other theorems print as
# many ✅ as their source has `blaster` proofs and checks, counted as tally.py counts them. A failed
# build leaves no trace, so this reads the console: only the messages at M's own file, which an
# import's replayed log never is. A theorem runs from its line's first column to the next command.
# Prints the theorems and exits 0; prints what differs and exits 1; exits 2 when the list names no
# M. An entry with no `why:` or no `when:` counts for nothing.
expected() {
  python3 -I - "$1" "$2" "$XFAIL" <<'EOF'
import os, re, sys
mod, out, lst = sys.argv[1:4]
src = os.path.join(*mod.split(".")) + ".lean"
FIELDS = ("fails", "with", "why", "when")
AXIOMS = ("sorryAx", "Lean.ofReduceBool", "Lean.trustCompiler")


def strip(s):
    # tally.py's, but a comment or a string keeps its newlines, so a line here is the console's
    out, i, depth, n = [], 0, 0, len(s)
    while i < n:
        if s.startswith("/-", i):
            depth += 1; i += 2
        elif depth and s.startswith("-/", i):
            depth -= 1; i += 2
        elif depth:
            out.append("\n" if s[i] == "\n" else ""); i += 1
        elif s.startswith("--", i):
            j = s.find("\n", i); i = n if j < 0 else j
        elif s[i] == '"':
            j = i + 1
            while j < n and s[j] != '"':
                k = j + (2 if s[j] == "\\" else 1)
                out.append("\n" * s.count("\n", j, k)); j = k
            out.append('""'); i = j + 1
        else:
            out.append(s[i]); i += 1
    return "".join(out)


def expected(code):
    # tally.py's: the ✅ Valid and ✅ Expected Falsified a source's checks print
    checks = r"#blaster((?:\s*\([^()]*\))*)"
    valid = falsified = 0
    for m in re.finditer(checks, code):
        r = re.search(r"solve-result:\s*(\d)", m.group(1))
        k = int(r.group(1)) if r else 0
        falsified += k == 1
        valid += k == 0
    valid += len(re.findall(r"\bblaster\b", re.sub(checks, "", code)))
    return valid, falsified


entry, cur, field = None, None, None
try:
    lines = open(lst, encoding="utf-8").read().split("\n")
except OSError:
    lines = []
for line in lines:
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    if not line[0].isspace():
        cur, field = {}, None
        if line.split()[0] == mod:
            entry = cur
        continue
    m = re.match(r"\s+(\w+):\s*(.*)$", line)
    if cur is not None and m and m.group(1) in FIELDS:
        field = m.group(1); cur[field] = m.group(2).strip()
    elif cur is not None and field:
        cur[field] += " " + line.strip()
if entry is None:
    sys.exit(2)
missing = [f for f in FIELDS if not entry.get(f)]
if missing:
    print(f"its expected-failures.txt entry has no {', '.join(missing)}, so it counts for nothing")
    sys.exit(1)
fails, reason = set(entry["fails"].split()), entry["with"]
try:
    code = strip(open(src, encoding="utf-8").read()).split("\n")
except OSError:
    print(f"not as expected-failures.txt records: no {src} to read")
    sys.exit(1)
THEOREM = re.compile(r"(?:@\[[^\]]*\]\s*)*(?:(?:private|protected|noncomputable|partial|unsafe)\s+)*"
                     r"(?:theorem|lemma)\s+([^\s:({\[]+)")
starts = [(k + 1, THEOREM.match(l)) for k, l in enumerate(code) if l[:1].strip()]


def owner(line):
    s = [m for k, m in starts if k <= line]
    return s[-1].group(1) if s and s[-1] else None


ev, ef = expected("\n".join(code))
for i, (k, m) in enumerate(starts):
    if m and m.group(1) in fails:
        v, f = expected("\n".join(code[k - 1:starts[i + 1][0] - 1 if i + 1 < len(starts) else len(code)]))
        ev -= v; ef -= f
own = re.compile(r"(error|warning|info): (?:\./)?" + re.escape(src) + r":(\d+):(\d+): (.*)$")
lake = re.compile(r"(?:error|warning|info|trace): |✖ |✔ |⚠ |Some required targets|- |Build completed|== ")
msgs, why, last = [], [], None
for line in open(out, encoding="utf-8", errors="replace").read().split("\n"):
    m = own.match(line)
    if m:
        last = [m.group(1), int(m.group(2)), m.group(3), m.group(4)]
        msgs.append(last)
    elif last is not None and line and not lake.match(line):
        last[3] += "\n" + line  # a message that runs on over lines
    else:
        last = None
        b = re.match(r"✖ \[\d+/\d+\] Building (\S+)", line)
        if b and b.group(1) != mod:
            why.append(f"{b.group(1)} failed too")
        elif line.startswith("error: ") and line not in ("error: Lean exited with code 1", "error: build failed"):
            why.append(line[:100])
failed, valid, falsified = set(), 0, 0
for level, line, col, text in msgs:
    who = owner(line)
    at, head = f"{line}:{col}" + (f" in {who}" if who else ""), text.split("\n")[0]
    if level == "error":
        if who in fails and head.startswith(reason):
            failed.add(who)
        else:
            why.append(f"{at}: {head[:80]}")
    elif ((level == "warning" and "Undetermined" in text) or "declaration uses 'sorry'" in text or "❌" in text
          or ("depends on axioms" in text and any(a in text for a in AXIOMS))):
        why.append(f"{at}: {head[:80]}")
    valid += text.count("✅ Valid"); falsified += text.count("✅ Expected Falsified")
why += [f"{t} didn't fail" for t in sorted(fails - failed)]
if (valid, falsified) != (ev, ef):
    why.append(f"{valid} ✅ Valid and {falsified} ✅ Expected Falsified where its other theorems have {ev} and {ef}")
if why:
    print("not as expected-failures.txt records: " + "; ".join(why[:3]) + ("; …" if len(why) > 3 else ""))
    sys.exit(1)
print(f"{', '.join(sorted(fails))} fail as expected-failures.txt records")
EOF
}
for m in "${mods[@]}"; do
  echo "== $m (cap $CAP, limit $LIMIT)"
  start=$SECONDS
  : > "$peakf"
  touch "$stampf"
  # The scope's own cgroup records its peak; a killed scope never writes it.
  systemd-run --user --scope -q -p MemoryMax="$CAP" -p MemorySwapMax=0 -p OOMPolicy=kill \
    bash -c 'timeout "$1" lake build "$2"; rc=$?
      cat "/sys/fs/cgroup$(cut -d: -f3 /proc/self/cgroup)/memory.peak" > "$3" 2>/dev/null
      exit $rc' _ "$LIMIT" "$m" "$peakf" 2>&1 \
    | grep -v -E "Replayed|PlutusCore/UPLC/CekMachine\.lean:[0-9]+:[0-9]+: declaration uses 'sorry'|Successfully decoded|^trace: \.> LEAN_PATH" \
    | tee "$outf"
  rc=${PIPESTATUS[0]}
  # A build of this package's that fails just as expected-failures.txt records is EXPECTED, which
  # fails no run (expected(), above); any other failure stays FAILED, saying what differs from its
  # entry when it has one.
  xf= xfail=
  if [ "$rc" = 1 ] && [ "$(root_of "$m")" = . ]; then
    xf=$(expected "$m" "$outf"); case $? in 0) xfail=1 ;; 1) ;; *) xf= ;; esac
  fi
  # The verdicts come from the modules' own logs, their traces (judge), never from the console:
  # the console replays every import's log too, a dependency's included (PlutusCoreBlaster's own
  # `sorry`, in CekMachine.lean, which the filter above only keeps off the screen). Lean logs a
  # `sorry` with a warning, and a `native_decide` with no word but in a `#print axioms`. An
  # import's verdict is its own line, after the module's, and fails the run but not the module.
  # An EXPECTED module's imports are read so too: each built, or the module's build wouldn't have
  # started.
  undet=0 unsound=0 notes=()
  if [ "$rc" = 0 ] || [ -n "$xfail" ]; then
    # A judge that stops (python3 missing, an error) leaves no verdict at all.
    judged=$(judge "$m") || judged=
    [ -n "$xfail" ] && [ -z "$judged" ] && { xfail=; xf="not as expected-failures.txt records: its imports didn't read"; }
    undet= unsound= own=1
    while read -r a b c; do
      if [ -n "$own" ]; then undet=$a unsound=$b own=; continue; fi
      echo "$a" >> "$seenf"
      imports=$((imports + 1))
      case $b.$c in
        *[!0-9.]*|.*|*.) notes+=("NO TRACE  $a (an import of $m, built, but left no trace to read)") ;;
        *) if [ "$c" -gt 0 ]; then
             notes+=("SORRY     $a (an import of $m, $c sorry or native_decide$([ "$b" -gt 0 ] && echo ", $b Undetermined"))")
           elif [ "$b" -gt 0 ]; then notes+=("UNDETERM  $a (an import of $m, $b Undetermined)")
           else imports_ok=$((imports_ok + 1)); continue; fi ;;
      esac
      check_failed=1
    done <<< "$judged"
    # No trace, or no count read from it, is no verdict. An EXPECTED module's own build left none.
    [ "$rc" = 0 ] && case $undet.$unsound in *[!0-9.]*|.*|*.) rc=notrace ;;
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
  [ "$rc" = 0 ] || [ -n "$xfail" ] || check_failed=1
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
    *) if [ -n "$xfail" ]; then summary+=("EXPECTED  $m ($xf, $took$peak)")
       else summary+=("FAILED    $m (exit $rc, $took$peak${xf:+; $xf})"); fi ;;
  esac
  summary+=("${notes[@]}")
done
rm -f "$peakf" "$outf" "$stampf" "$seenf"
echo
echo "== summary"
printf '%s\n' "${summary[@]}"
[ "$imports" -gt 0 ] && echo "== unlisted imports from this package, each read from its own trace:" \
  "$imports_ok of $imports ok$([ "$imports_ok" -lt "$imports" ] && echo ", the rest above")"
exit "$check_failed"
