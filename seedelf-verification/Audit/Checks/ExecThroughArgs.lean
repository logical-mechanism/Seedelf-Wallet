import Seedelf.WalletRegister
import Seedelf.WalletNoLock
import Seedelf.WalletPurpose
import Seedelf.Steps
import Lovejoin.MixBoxNoLock
import Lovejoin.Template.MixBoxNoLock
import Lovejoin.V2.OwnAny1Passes
import Lovejoin.V2.OwnAny1Steps
import Lovejoin.V2.MixAny3Outputs
import Lovejoin.V2.MixAny3OutSteps

/-! Checker of the audit finding `success-is-any-halt` (scratch, not part of the repo).

`isSuccessful` is a halt with any value, and each `Steps` run applies the script itself
(`stepsUsed`, `stepsWith`), not through the module's `#prep_uplc` argument function. Here each
passing run goes through a theorem's own list writer (its `NAME.exec`, or the writer itself
where every `NAME` fixes a failing purpose), and prints what the run ended as: one per list
writer that no theorem of the other direction shares. pcb-model's `ExecPairing.lean` does the
same but imports `Seedelf.PolicyBurn`, which has no .olean (the module fails on its two
`BitVec`-blocked success theorems), so `lake env lean` stops at that import.

Run with `./check.sh audit-quick`, after `LIMIT=30m ./check.sh audit-refresh`: `lake build`
brings any stale import up to date inside this module's own limit, and some of them
(OwnAny1Passes, MixAny3Outputs) are blaster modules.

Expected, in order (no theorem, so no Blaster call):
  "1 halt with unit"              WalletRegister (registerArgs), Steps' real proof
  "2 error"                       the same, another signer
  "3 halt with unit"              WalletNoLock (withDatum), no datum
  "4 halt with unit"              WalletPurpose's writer (purposeArgs), as a no-datum spend
  "5 HALT WITH A NON-UNIT VALUE"  control: the wallet with no argument
  "6 error"                       control: the no-datum spend with one argument too many
  "7 halt with unit"              classic MixBoxNoLock (boxNoDatumArgs), no datum
  "8 halt with unit"              template MixBoxNoLock (toTerm L :: …), classic L, no datum
  "9 halt with unit"              v2 OwnAny1Passes (argsOwn), OwnAny1Steps' honest proof
  "10 halt with unit"             v2 MixAny3Outputs (addressArgs, gen-lovejoin-mix-outputs.py's
                                  own list) with the KAT's outputs: the honest Mix
Anything else on 1, 3, 4 or 7-10 means that writer's list isn't the script's arity, or the
script halts with a value other than unit. -/

namespace SuccessIsAnyHaltCheck
open PlutusCore.UPLC.CekMachine (State)

/-- What a run ended as. Plutus V3 accepts a script only when it returns unit. -/
def summary : State → String
  | .Halt (.VCon .Unit) => "halt with unit"
  | .Halt _             => "HALT WITH A NON-UNIT VALUE"
  | .Error              => "error"
  | _                   => "exhausted (step limit)"

end SuccessIsAnyHaltCheck

namespace Seedelf.V1
open SuccessIsAnyHaltCheck (summary)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Term (Term)

#eval s!"1 {summary (appliedRegister.exec g1 u0 z0 gr0 vkh0 vkh0)}"
#eval s!"2 {summary (appliedRegister.exec g1 u0 z0 gr0 vkh0 "k")}"
#eval s!"3 {summary (appliedNoDatum.exec "\x01" g1 "k" "k")}"
#eval s!"4 {summary (cekExecuteProgram wallet.script (purposeArgs (.SpendingScript ⟨"", 0⟩ none)) 800)}"
#eval s!"5 {summary (cekExecuteProgram wallet.script [] 800)}"
#eval s!"6 {summary (cekExecuteProgram wallet.script (noDatumArgs "\x01" g1 "k" "k" ++ ([.Const .Unit] : List Term)) 800)}"

end Seedelf.V1

namespace Lovejoin.Classic
open SuccessIsAnyHaltCheck (summary)

#eval s!"7 {summary (appliedBoxNoDatum.exec (PlutusCore.Data.Data.Constr 0 []))}"

end Lovejoin.Classic

namespace Lovejoin.Template
open SuccessIsAnyHaltCheck (summary)

#eval s!"8 {summary (appliedBoxNoDatumT.exec Lovejoin.Classic.mixLogicHash (PlutusCore.Data.Data.Constr 0 []))}"

end Lovejoin.Template

namespace Lovejoin.V2.Own1
open SuccessIsAnyHaltCheck (summary)
open Seedelf.V1 (g1)

#eval match honest with
  | some [b1, t1, z1] =>
      s!"9 {summary (appliedOwnAny1Passes.exec nftPolicy mixBoxHash g1 b1 t1 z1 kP 3000000 kS kG kU 20000000 kC 1000000)}"
  | _ => "9 no honest proofs"

end Lovejoin.V2.Own1

namespace Lovejoin.V2.Any3
open SuccessIsAnyHaltCheck (summary)

/-- `addressArgs` with every box out where the KAT's Mix puts it: at mix_box, no stake, no
reference script, so its outputs are `runOut`'s honest ones. -/
def honestAddressRun : String :=
  summary (appliedMixAny3Address.exec nftPolicy mixBoxHash 10000000
    katA1 katB1 katA2 katB2 katA3 katB3 katOA1 katOB1 katOA2 katOB2 katOA3 katOB3
    katT011 katT111 katC11 katZ11 katT012 katT112 katC12 katZ12 katT013 katT113 katC13 katZ13
    katT021 katT121 katC21 katZ21 katT022 katT122 katC22 katZ22 katT023 katT123 katC23 katZ23
    katT031 katT131 katC31 katZ31 katT032 katT132 katC32 katZ32 katT033 katT133 katC33 katZ33
    (.ScriptCredential mixBoxHash) (.ScriptCredential mixBoxHash) (.ScriptCredential mixBoxHash)
    none none none none none none)

#eval s!"10 {honestAddressRun}"

end Lovejoin.V2.Any3
