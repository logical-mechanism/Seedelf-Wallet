import Lovejoin.OwnClassic1Spec
import Lovejoin.OwnClassic1Steps
import Audit.Classic.MutantScripts
import Audit.Classic.Common
import Blaster

/-! The classic Owner withdrawal of one box on the two `ctx` mutants of mix_logic
(`Audit.Classic.MutantScripts`), with the deployed spec. Expected: 2 `#guard`s pass and
**2 "✅ Expected Falsified" lines**.

- [B-M0a..b] Concretely, `OwnClassic1Steps`' honest proof errors on both mutants.
- [B-M1] Boxes on the mutant that leaves the input refs out of `ctx`: it accepts a proof the
  deployed `ctx` rejects. A Valid result would mean Boxes can't see whether the payer's and the
  box's refs are hashed.
- [B-M2] Passes on the mutant that leaves the outputs out: a proof the deployed `ctx` accepts
  needn't pass. A Valid result would mean Passes can't see whether the outputs are hashed. -/

namespace Audit.Classic.Own1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.UPLC.Utils
open Audit.Classic (erroredB)
open Lovejoin.Classic (wellFormed)
open Lovejoin.Classic.Own1 (ownerAcceptsOwn proofHolds honest kP kS kC kG kU)
open Seedelf.V1 (g1)

#prep_uplc auditClassicOwn1NoRefs auditClassicMixLogicNoRefs Lovejoin.Classic.Own1.argsOwn 10000
#prep_uplc auditClassicOwn1NoOutputs auditClassicMixLogicNoOutputs Lovejoin.Classic.Own1.argsOwn 10000

-- [B-M0a]
#guard match honest with
  | some [b1, t1, z1] => erroredB (auditClassicOwn1NoRefs.exec g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000)
  | _ => false

-- [B-M0b]
#guard match honest with
  | some [b1, t1, z1] => erroredB (auditClassicOwn1NoOutputs.exec g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000)
  | _ => false

-- [B-M1]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → proofHolds s g u amt kc ch a1 b1 t1 z1 = false →
    isUnsuccessful (auditClassicOwn1NoRefs.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

-- [B-M2]
#blaster (gen-cex: 0) (solve-result: 1) (timeout: 300) [∀ (a1 b1 t1 z1 : ByteString) (kp : ByteString) (pin : Integer)
    (s g u : ByteString) (amt : Integer) (kc : ByteString) (ch : Integer),
  wellFormed a1 b1 = true → ownerAcceptsOwn a1 b1 t1 z1 s g u amt kc ch = true →
    isSuccessful (auditClassicOwn1NoOutputs.prop a1 b1 t1 z1 kp pin s g u amt kc ch)]

end Audit.Classic.Own1
