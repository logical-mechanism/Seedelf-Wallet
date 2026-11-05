import Seedelf.AnyTxCover
import Seedelf.WalletPurposeAnyTx
import Seedelf.WalletNoLockAnyTx
import Seedelf.WalletRedeemerAnyTx
import Seedelf.WalletAnyTxTwo
import Seedelf.WalletAnyTxThree

/-! The wallet's every-transaction scenarios are every case, by Lean theorems rather than by
reading. Each `…AnyTx` module fixes a shape of the context and leaves the rest any `Data`; here
each list of shapes is shown to be every case of a V3 context, at the `Data` level the ledger
encodes it in (CardanoLedgerApiBlaster, V3/Contexts.lean). Kernel-checked, no blaster.

- `wallet_every_datum`: every spend's datum, encoded, is a Register's,
  `datumSome (Constr 0 [B g, B u])`, or one of WalletNoLockAnyTx's 18 (`noLockDatum`), and
  `noLockDatum_not_register`: none of the 18 is a Register's.
- `wallet_every_redeemer`: every redeemer is a proof, `Constr 0 [B z, B gr, B vkh]`, or one of
  WalletRedeemerAnyTx's 22 (`nonProofRedeemer`), and `nonProofRedeemer_not_proof`: none of the
  22 is a proof.
- `wallet_every_purpose`: every purpose is a spend's, `Constr 1 [ref, datum]`, or `Constr k _`
  for k = 0, 2, 3, 4 or 5, as WalletPurposeAnyTx's `anyTxPurposeArgs k` takes it.
- `signatories_encoding`, `txInfo_signatories`: the signatories are a `List` of `B`s, so every
  TxInfo is `TxRest.info` of its 15 other fields and its signatories, k of them
  `[.B s1, …, .B sk]`.
- `wallet_every_context`: so every V3 context is one of four: another purpose's
  (WalletPurposeAnyTx); a spend whose redeemer isn't a proof, any datum (WalletRedeemerAnyTx); a
  spend with a proof whose datum isn't a Register (WalletNoLockAnyTx); or a Register spent with
  a proof and k signatories, `spendIn (r.info (sigs.map .B)) proof ref (datumSome register)`.
- `wallet_every_run`: the same in the builders' own terms. For every V3 context, the argument
  the ledger applies the wallet to is the one some builder of those modules makes, for some
  values of its parameters: one of WalletPurposeAnyTx's 5, WalletRedeemerAnyTx's 22,
  WalletNoLockAnyTx's 18, or the four of WalletAnyTx, WalletAnyTxTwo and WalletAnyTxThree
  (none to three signatories), or a Register spend with four signatories or more, which
  Seedelf/Signers takes a count a module.

The disjuncts are written as the builders write their arguments, in the modules' orders, and
`wallet_every_run` links each builder to its disjunct by `rfl`. "Every V3 context" is every
value of CardanoLedgerApiBlaster's `ScriptContext`, in its encoding; unlike the policy's
(PolicyShapes), this cover needs none of its rules for what the ledger produces. The
`#guard_msgs` at the end fail the build if a theorem here ever depends on more axioms. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.Term (Term)

/-- Proves a right-nested disjunction by the first disjunct `rfl` proves, its witnesses found by
unification: for a value whose constructors are known, the one disjunct its shape is. -/
syntax "pick_shape" : tactic
macro_rules
  | `(tactic| pick_shape) => `(tactic| first
      | exact rfl
      | exact ⟨_, rfl⟩
      | exact ⟨_, _, rfl⟩
      | exact ⟨_, _, _, rfl⟩
      | exact ⟨_, _, _, _, rfl⟩
      | exact ⟨_, _, _, _, _, rfl⟩
      | exact Or.inl rfl
      | exact Or.inl ⟨_, rfl⟩
      | exact Or.inl ⟨_, _, rfl⟩
      | exact Or.inl ⟨_, _, _, rfl⟩
      | exact Or.inl ⟨_, _, _, _, rfl⟩
      | exact Or.inl ⟨_, _, _, _, _, rfl⟩
      | (refine Or.inr ?_; pick_shape))

/-! ### Every datum -/

/-- WalletNoLockAnyTx's 18 datums, each as its builder passes it to `anyTxWithDatum`, in its
order: every encoded datum but a Register's. -/
def noLockDatum (d : Data) : Prop :=
  d = datumNone ∨
  (∃ b, d = datumSome (.B b)) ∨
  (∃ i, d = datumSome (.I i)) ∨
  (∃ l, d = datumSome (.List l)) ∨
  (∃ m, d = datumSome (.Map m)) ∨
  (∃ n fs, d = datumSome (.Constr (Int.ofNat (n + 1)) fs)) ∨
  (∃ n fs, d = datumSome (.Constr (Int.negSucc n) fs)) ∨
  d = datumSome (.Constr 0 []) ∨
  (∃ x, d = datumSome (.Constr 0 [x])) ∨
  (∃ x y w rest, d = datumSome (.Constr 0 (x :: y :: w :: rest))) ∨
  (∃ k fs y, d = datumSome (.Constr 0 [.Constr k fs, y])) ∨
  (∃ m y, d = datumSome (.Constr 0 [.Map m, y])) ∨
  (∃ l y, d = datumSome (.Constr 0 [.List l, y])) ∨
  (∃ i y, d = datumSome (.Constr 0 [.I i, y])) ∨
  (∃ g k fs, d = datumSome (.Constr 0 [.B g, .Constr k fs])) ∨
  (∃ g m, d = datumSome (.Constr 0 [.B g, .Map m])) ∨
  (∃ g l, d = datumSome (.Constr 0 [.B g, .List l])) ∨
  (∃ g i, d = datumSome (.Constr 0 [.B g, .I i]))

/-- Every datum a spend can carry, encoded, is a Register's or one of the 18. -/
theorem wallet_every_datum : ∀ d : Option Data,
    (∃ g u, IsData.toData d = datumSome (.Constr 0 [.B g, .B u])) ∨ noLockDatum (IsData.toData d)
  | some (.Constr (Int.ofNat 0) [.B g, .B u]) => Or.inl ⟨g, u, rfl⟩
  | none | some (.B _) | some (.I _) | some (.List _) | some (.Map _)
  | some (.Constr (Int.ofNat (_ + 1)) _) | some (.Constr (Int.negSucc _) _)
  | some (.Constr (Int.ofNat 0) []) | some (.Constr (Int.ofNat 0) [_])
  | some (.Constr (Int.ofNat 0) (_ :: _ :: _ :: _))
  | some (.Constr (Int.ofNat 0) [.Constr _ _, _]) | some (.Constr (Int.ofNat 0) [.Map _, _])
  | some (.Constr (Int.ofNat 0) [.List _, _]) | some (.Constr (Int.ofNat 0) [.I _, _])
  | some (.Constr (Int.ofNat 0) [.B _, .Constr _ _]) | some (.Constr (Int.ofNat 0) [.B _, .Map _])
  | some (.Constr (Int.ofNat 0) [.B _, .List _]) | some (.Constr (Int.ofNat 0) [.B _, .I _]) =>
    Or.inr (by unfold noLockDatum; pick_shape)

/-- And no Register's is among the 18: they are exactly the datums but a Register's. -/
theorem noLockDatum_not_register (g u : ByteString) :
    ¬ noLockDatum (datumSome (.Constr 0 [.B g, .B u])) := by
  unfold noLockDatum
  rintro (h | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | h | ⟨_, ⟨⟩⟩ |
    ⟨_, _, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ |
    ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩) <;> nomatch h

/-! ### Every redeemer -/

/-- WalletRedeemerAnyTx's 22 redeemers, each as its builder passes it to `anyRedeemerArgs`, in
its order: every redeemer but a proof. -/
def nonProofRedeemer (rd : Data) : Prop :=
  (∃ b, rd = .B b) ∨
  (∃ i, rd = .I i) ∨
  (∃ l, rd = .List l) ∨
  (∃ m, rd = .Map m) ∨
  (∃ n fs, rd = .Constr (Int.ofNat (n + 1)) fs) ∨
  (∃ n fs, rd = .Constr (Int.negSucc n) fs) ∨
  rd = .Constr 0 [] ∨
  (∃ x, rd = .Constr 0 [x]) ∨
  (∃ x y, rd = .Constr 0 [x, y]) ∨
  (∃ x y w v rest, rd = .Constr 0 (x :: y :: w :: v :: rest)) ∨
  (∃ k fs y w, rd = .Constr 0 [.Constr k fs, y, w]) ∨
  (∃ m y w, rd = .Constr 0 [.Map m, y, w]) ∨
  (∃ l y w, rd = .Constr 0 [.List l, y, w]) ∨
  (∃ i y w, rd = .Constr 0 [.I i, y, w]) ∨
  (∃ a k fs w, rd = .Constr 0 [.B a, .Constr k fs, w]) ∨
  (∃ a m w, rd = .Constr 0 [.B a, .Map m, w]) ∨
  (∃ a l w, rd = .Constr 0 [.B a, .List l, w]) ∨
  (∃ a i w, rd = .Constr 0 [.B a, .I i, w]) ∨
  (∃ a b k fs, rd = .Constr 0 [.B a, .B b, .Constr k fs]) ∨
  (∃ a b m, rd = .Constr 0 [.B a, .B b, .Map m]) ∨
  (∃ a b l, rd = .Constr 0 [.B a, .B b, .List l]) ∨
  (∃ a b i, rd = .Constr 0 [.B a, .B b, .I i])

/-- Every redeemer is a proof or one of the 22. -/
theorem wallet_every_redeemer : ∀ rd : Data,
    (∃ z gr vkh, rd = .Constr 0 [.B z, .B gr, .B vkh]) ∨ nonProofRedeemer rd
  | .Constr (Int.ofNat 0) [.B z, .B gr, .B vkh] => Or.inl ⟨z, gr, vkh, rfl⟩
  | .B _ | .I _ | .List _ | .Map _ | .Constr (Int.ofNat (_ + 1)) _ | .Constr (Int.negSucc _) _
  | .Constr (Int.ofNat 0) [] | .Constr (Int.ofNat 0) [_] | .Constr (Int.ofNat 0) [_, _]
  | .Constr (Int.ofNat 0) (_ :: _ :: _ :: _ :: _)
  | .Constr (Int.ofNat 0) [.Constr _ _, _, _] | .Constr (Int.ofNat 0) [.Map _, _, _]
  | .Constr (Int.ofNat 0) [.List _, _, _] | .Constr (Int.ofNat 0) [.I _, _, _]
  | .Constr (Int.ofNat 0) [.B _, .Constr _ _, _] | .Constr (Int.ofNat 0) [.B _, .Map _, _]
  | .Constr (Int.ofNat 0) [.B _, .List _, _] | .Constr (Int.ofNat 0) [.B _, .I _, _]
  | .Constr (Int.ofNat 0) [.B _, .B _, .Constr _ _] | .Constr (Int.ofNat 0) [.B _, .B _, .Map _]
  | .Constr (Int.ofNat 0) [.B _, .B _, .List _] | .Constr (Int.ofNat 0) [.B _, .B _, .I _] =>
    Or.inr (by unfold nonProofRedeemer; pick_shape)

/-- And no proof is among the 22: they are exactly the redeemers but a proof. -/
theorem nonProofRedeemer_not_proof (z gr vkh : ByteString) :
    ¬ nonProofRedeemer (.Constr 0 [.B z, .B gr, .B vkh]) := by
  unfold nonProofRedeemer
  rintro (⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | ⟨_, _, ⟨⟩⟩ | h | ⟨_, ⟨⟩⟩ |
    ⟨_, _, ⟨⟩⟩ | ⟨_, _, _, _, _, ⟨⟩⟩ | ⟨_, _, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ |
    ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ |
    ⟨_, _, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩ | ⟨_, _, _, ⟨⟩⟩) <;> nomatch h

/-! ### Every purpose -/

/-- Every purpose, encoded, is a spend's, or another's by its tag. -/
theorem wallet_every_purpose (si : ScriptInfo) :
    (∃ (ref : TxOutRef) (datum : Option Data),
      IsData.toData si = .Constr 1 [IsData.toData ref, IsData.toData datum]) ∨
    ∃ (k : Integer) (fs : List Data), (k = 0 ∨ k = 2 ∨ k = 3 ∨ k = 4 ∨ k = 5) ∧
      IsData.toData si = .Constr k fs := by
  cases si with
  | SpendingScript ref datum => exact Or.inl ⟨ref, datum, rfl⟩
  | MintingScript _ => exact Or.inr ⟨0, _, Or.inl rfl, rfl⟩
  | RewardingScript _ => exact Or.inr ⟨2, _, Or.inr (Or.inl rfl), rfl⟩
  | CertifyingScript _ _ => exact Or.inr ⟨3, _, Or.inr (Or.inr (Or.inl rfl)), rfl⟩
  | VotingScript _ => exact Or.inr ⟨4, _, Or.inr (Or.inr (Or.inr (Or.inl rfl))), rfl⟩
  | ProposingScript _ _ => exact Or.inr ⟨5, _, Or.inr (Or.inr (Or.inr (Or.inr rfl))), rfl⟩

/-! ### Every signatory list -/

/-- The signatories, encoded, are a `List` of `B`s, one a key hash. -/
theorem signatories_encoding (sigs : List PubKeyHash) : IsData.toData sigs = .List (sigs.map .B) := by
  induction sigs with
  | nil => rfl
  | cons s rest ih =>
    -- one more key hash is one more `B` at the head of the list
    exact congrArg (fun d : Data => match d with | .List l => Data.List (.B s :: l) | d => d) ih

/-- Every TxInfo is `TxRest.info` of its 15 other fields and its signatories, each a `B`. -/
theorem txInfo_signatories (tx : TxInfo) :
    IsData.toData tx = (TxRest.ofTxInfo tx).info (tx.txInfoSignatories.map .B) :=
  (TxRest.ofTxInfo_infoWith tx).trans
    (congrArg (TxRest.ofTxInfo tx).infoWith (signatories_encoding tx.txInfoSignatories))

/-! ### Every context -/

/-- Every V3 context is another purpose's; a spend whose redeemer isn't a proof; a spend with a
proof whose datum isn't a Register; or a Register spent with a proof and k signatories. -/
theorem wallet_every_context (ctx : ScriptContext) :
    (∃ (k : Integer) (info redeemer : Data) (fs : List Data), (k = 0 ∨ k = 2 ∨ k = 3 ∨ k = 4 ∨ k = 5) ∧
      IsData.toData ctx = .Constr 0 [info, redeemer, .Constr k fs]) ∨
    (∃ (info rd ref d : Data), nonProofRedeemer rd ∧ IsData.toData ctx = spendIn info rd ref d) ∨
    (∃ (info ref d : Data) (z gr vkh : ByteString), noLockDatum d ∧
      IsData.toData ctx = spendIn info (.Constr 0 [.B z, .B gr, .B vkh]) ref d) ∨
    ∃ (r : TxRest) (sigs : List ByteString) (ref : Data) (g u z gr vkh : ByteString),
      IsData.toData ctx =
        spendIn (r.info (sigs.map .B)) (.Constr 0 [.B z, .B gr, .B vkh]) ref (datumSome (.Constr 0 [.B g, .B u])) := by
  obtain ⟨tx, redeemer, si⟩ := ctx
  -- the context is `Constr 0 [TxInfo, redeemer, purpose]`
  have hctx : IsData.toData (⟨tx, redeemer, si⟩ : ScriptContext) =
      .Constr 0 [IsData.toData tx, redeemer, IsData.toData si] := rfl
  rw [hctx]
  rcases wallet_every_purpose si with ⟨ref, datum, hsi⟩ | ⟨k, fs, hk, hsi⟩ <;> rw [hsi]
  · rcases wallet_every_redeemer redeemer with ⟨z, gr, vkh, rfl⟩ | hrd
    · rcases wallet_every_datum datum with ⟨g, u, hd⟩ | hd
      · refine Or.inr (Or.inr (Or.inr
          ⟨TxRest.ofTxInfo tx, tx.txInfoSignatories, IsData.toData ref, g, u, z, gr, vkh, ?_⟩))
        rw [hd, txInfo_signatories] <;> rfl
      · exact Or.inr (Or.inr (Or.inl ⟨_, _, _, z, gr, vkh, hd, rfl⟩))
    · exact Or.inr (Or.inl ⟨_, _, _, _, hrd, rfl⟩)
  · exact Or.inl ⟨k, _, _, fs, hk, rfl⟩

/-! ### Every run: the builders' own arguments -/

/-- WalletPurposeAnyTx's five builders: another purpose, any TxInfo, redeemer and payload. -/
def walletPurposeFamily (args : List Term) : Prop :=
  ∃ info redeemer fs,
    args = anyTxMintingArgs info redeemer fs ∨
    args = anyTxRewardingArgs info redeemer fs ∨
    args = anyTxCertifyingArgs info redeemer fs ∨
    args = anyTxVotingArgs info redeemer fs ∨
    args = anyTxProposingArgs info redeemer fs

/-- WalletRedeemerAnyTx's 22 builders: a spend whose redeemer isn't a proof, any TxInfo, output
reference and datum. -/
def walletRedeemerFamily (args : List Term) : Prop :=
  ∃ info ref d,
    (∃ b, args = anyRedeemerBytesArgs b info ref d) ∨
    (∃ i, args = anyRedeemerIntArgs i info ref d) ∨
    (∃ l, args = anyRedeemerListArgs l info ref d) ∨
    (∃ m, args = anyRedeemerMapArgs m info ref d) ∨
    (∃ n fs, args = anyRedeemerConstrPosArgs n fs info ref d) ∨
    (∃ n fs, args = anyRedeemerConstrNegArgs n fs info ref d) ∨
    args = anyRedeemerFields0Args info ref d ∨
    (∃ x, args = anyRedeemerFields1Args x info ref d) ∨
    (∃ x y, args = anyRedeemerFields2Args x y info ref d) ∨
    (∃ x y w v rest, args = anyRedeemerFields4Args x y w v rest info ref d) ∨
    (∃ k fs y w, args = anyRedeemerFirstConstrArgs k fs y w info ref d) ∨
    (∃ m y w, args = anyRedeemerFirstMapArgs m y w info ref d) ∨
    (∃ l y w, args = anyRedeemerFirstListArgs l y w info ref d) ∨
    (∃ i y w, args = anyRedeemerFirstIArgs i y w info ref d) ∨
    (∃ a k fs w, args = anyRedeemerSecondConstrArgs a k fs w info ref d) ∨
    (∃ a m w, args = anyRedeemerSecondMapArgs a m w info ref d) ∨
    (∃ a l w, args = anyRedeemerSecondListArgs a l w info ref d) ∨
    (∃ a i w, args = anyRedeemerSecondIArgs a i w info ref d) ∨
    (∃ a b k fs, args = anyRedeemerThirdConstrArgs a b k fs info ref d) ∨
    (∃ a b m, args = anyRedeemerThirdMapArgs a b m info ref d) ∨
    (∃ a b l, args = anyRedeemerThirdListArgs a b l info ref d) ∨
    (∃ a b i, args = anyRedeemerThirdIArgs a b i info ref d)

/-- WalletNoLockAnyTx's 18 builders: a spend with a proof whose datum isn't a Register, any
TxInfo and output reference. -/
def walletNoLockFamily (args : List Term) : Prop :=
  ∃ info ref z gr vkh,
    args = anyTxNoDatumArgs info ref z gr vkh ∨
    (∃ b, args = anyTxBytesArgs b info ref z gr vkh) ∨
    (∃ i, args = anyTxIntArgs i info ref z gr vkh) ∨
    (∃ l, args = anyTxListArgs l info ref z gr vkh) ∨
    (∃ m, args = anyTxMapArgs m info ref z gr vkh) ∨
    (∃ n fs, args = anyTxConstrPosArgs n fs info ref z gr vkh) ∨
    (∃ n fs, args = anyTxConstrNegArgs n fs info ref z gr vkh) ∨
    args = anyTxFields0Args info ref z gr vkh ∨
    (∃ x, args = anyTxFields1Args x info ref z gr vkh) ∨
    (∃ x y w rest, args = anyTxFields3Args x y w rest info ref z gr vkh) ∨
    (∃ k fs y, args = anyTxFirstConstrArgs k fs y info ref z gr vkh) ∨
    (∃ m y, args = anyTxFirstMapArgs m y info ref z gr vkh) ∨
    (∃ l y, args = anyTxFirstListArgs l y info ref z gr vkh) ∨
    (∃ i y, args = anyTxFirstIArgs i y info ref z gr vkh) ∨
    (∃ g k fs, args = anyTxSecondConstrArgs g k fs info ref z gr vkh) ∨
    (∃ g m, args = anyTxSecondMapArgs g m info ref z gr vkh) ∨
    (∃ g l, args = anyTxSecondListArgs g l info ref z gr vkh) ∨
    (∃ g i, args = anyTxSecondIArgs g i info ref z gr vkh)

/-- WalletAnyTx's, WalletAnyTxTwo's and WalletAnyTxThree's four builders: a Register spent with
a proof and none to three signatories, any other TxInfo field and output reference. -/
def walletRegisterFamily (args : List Term) : Prop :=
  ∃ r ref g u z gr vkh,
    args = anyTxRegister0Args r ref g u z gr vkh ∨
    (∃ s, args = anyTxRegisterArgs r ref g u z gr vkh s) ∨
    (∃ s1 s2, args = anyTxRegister2Args r ref g u z gr vkh s1 s2) ∨
    (∃ s1 s2 s3, args = anyTxRegister3Args r ref g u z gr vkh s1 s2 s3)

/-- A Register spent with a proof and four signatories or more: Seedelf/Signers, a count a
module. -/
def walletSignersFamily (args : List Term) : Prop :=
  ∃ (r : TxRest) (ref : Data) (g u z gr vkh : ByteString) (sigs : List ByteString),
    4 ≤ sigs.length ∧ args = [toTerm (anyTxRegisterSpend r ref g u z gr vkh (sigs.map .B))]

/-- The ledger applies a V3 script to one argument, its context as `Data`, which is what each
builder builds. -/
theorem toTerm_context (ctx : ScriptContext) : toTerm ctx = toTerm (IsData.toData ctx) := rfl

/-- For every V3 context, the wallet's argument is one some builder makes, or a Register spend
with four signatories or more. -/
theorem wallet_every_run (ctx : ScriptContext) :
    walletPurposeFamily [toTerm ctx] ∨ walletRedeemerFamily [toTerm ctx] ∨
      walletNoLockFamily [toTerm ctx] ∨ walletRegisterFamily [toTerm ctx] ∨
      walletSignersFamily [toTerm ctx] := by
  rcases wallet_every_context ctx with ⟨k, info, redeemer, fs, hk, hctx⟩ | ⟨info, rd, ref, d, hrd, hctx⟩ |
      ⟨info, ref, d, z, gr, vkh, hd, hctx⟩ | ⟨r, sigs, ref, g, u, z, gr, vkh, hctx⟩ <;>
    rw [toTerm_context, hctx]
  · refine Or.inl ⟨info, redeemer, fs, ?_⟩
    rcases hk with rfl | rfl | rfl | rfl | rfl <;> pick_shape
  · refine Or.inr (Or.inl ⟨info, ref, d, ?_⟩)
    unfold nonProofRedeemer at hrd
    rcases hrd with ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ | rfl |
      ⟨_, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, _, _, _, rfl⟩ | ⟨_, _, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ |
      ⟨_, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ | ⟨_, _, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ |
      ⟨_, _, _, rfl⟩ | ⟨_, _, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ <;>
      pick_shape
  · refine Or.inr (Or.inr (Or.inl ⟨info, ref, z, gr, vkh, ?_⟩))
    unfold noLockDatum at hd
    rcases hd with rfl | ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ | rfl |
      ⟨_, rfl⟩ | ⟨_, _, _, _, rfl⟩ | ⟨_, _, _, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ |
      ⟨_, _, _, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ | ⟨_, _, rfl⟩ <;>
      pick_shape
  · -- a Register spend, by its number of signatories
    rcases sigs with _ | ⟨s1, _ | ⟨s2, _ | ⟨s3, _ | ⟨s4, rest⟩⟩⟩⟩
    · exact Or.inr (Or.inr (Or.inr (Or.inl ⟨r, ref, g, u, z, gr, vkh, Or.inl rfl⟩)))
    · exact Or.inr (Or.inr (Or.inr (Or.inl ⟨r, ref, g, u, z, gr, vkh, Or.inr (Or.inl ⟨s1, rfl⟩)⟩)))
    · exact Or.inr (Or.inr (Or.inr (Or.inl
        ⟨r, ref, g, u, z, gr, vkh, Or.inr (Or.inr (Or.inl ⟨s1, s2, rfl⟩))⟩)))
    · exact Or.inr (Or.inr (Or.inr (Or.inl
        ⟨r, ref, g, u, z, gr, vkh, Or.inr (Or.inr (Or.inr ⟨s1, s2, s3, rfl⟩))⟩)))
    · exact Or.inr (Or.inr (Or.inr (Or.inr
        ⟨r, ref, g, u, z, gr, vkh, s1 :: s2 :: s3 :: s4 :: rest, by simp only [List.length_cons]; omega, rfl⟩)))

/-! ### Axioms: Lean's own, no `sorry`, `blasterProven` or `ofReduceBool` -/

/-- info: 'Seedelf.V1.wallet_every_datum' does not depend on any axioms -/
#guard_msgs in #print axioms wallet_every_datum
/-- info: 'Seedelf.V1.noLockDatum_not_register' does not depend on any axioms -/
#guard_msgs in #print axioms noLockDatum_not_register
/-- info: 'Seedelf.V1.wallet_every_redeemer' does not depend on any axioms -/
#guard_msgs in #print axioms wallet_every_redeemer
/-- info: 'Seedelf.V1.nonProofRedeemer_not_proof' does not depend on any axioms -/
#guard_msgs in #print axioms nonProofRedeemer_not_proof
/-- info: 'Seedelf.V1.wallet_every_purpose' does not depend on any axioms -/
#guard_msgs in #print axioms wallet_every_purpose
/-- info: 'Seedelf.V1.signatories_encoding' does not depend on any axioms -/
#guard_msgs in #print axioms signatories_encoding
/-- info: 'Seedelf.V1.txInfo_signatories' does not depend on any axioms -/
#guard_msgs in #print axioms txInfo_signatories
/-- info: 'Seedelf.V1.wallet_every_context' does not depend on any axioms -/
#guard_msgs in #print axioms wallet_every_context
/-- info: 'Seedelf.V1.wallet_every_run' depends on axioms: [propext, Quot.sound] -/
#guard_msgs in #print axioms wallet_every_run

end Seedelf.V1
