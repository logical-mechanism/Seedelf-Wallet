import Lovejoin.AnyTx.LaunchSeedSearch
import Lovejoin.AnyTx.Common

/-! A fixed-slot adapter for the compiled launch seed search. -/
namespace Lovejoin.AnyTx.LaunchSeedSlots
open CardanoLedgerApi.IsData.Class (IsData toTerm)
open CardanoLedgerApi.V3
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue Environment)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1 (TxRest)
open Seedelf.V1.LinesAll
open Lovejoin.AnyTx
open Lovejoin.AnyTx.CekCase
open Lovejoin.AnyTx.BoxSearch (inputList)
open Lovejoin.AnyTx.LaunchSeedSearch
open Lovejoin.Template
set_option maxHeartbeats 0

theorem search_false_slots (t0 t1 t2 t3 t4 t5 t6 t7 t8 t9 t10 t11 t12 t13 t14 t15 t16 t17 t18 t19 t20 t21 t22 t23 t24 t25 t26 t27 : CekValue) (seed : Data) (m0 m1 m2 m3 m4 m5 m6 m7 m8 m9 c9 c6 : CekValue)
    (rest : Environment) (xs : List (Data × Data)) (hAbsent : containsSeed seed xs = false) :
    Ev default searchBody
      (.VCon (.ConstDataList (inputList xs)) ::
        .VLam searchLoop ([t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, t25, t26, t27] ++ .VCon (.Data seed) :: [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9] ++
          .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 ::
          .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest) ::
        ([t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, t25, t26, t27] ++ .VCon (.Data seed) :: [m0, m1, m2, m3, m4, m5, m6, m7, m8, m9] ++
          .VBuiltin .IfThenElse [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c9 ::
          .VBuiltin .SndPair [] (.One .ArgV) ::
          .VBuiltin .ChooseList [] (.More .ArgV (.More .ArgV (.One .ArgV))) :: c6 ::
          .VBuiltin .HeadList [] (.One .ArgV) :: .VBuiltin .TailList [] (.One .ArgV) :: rest))
      (some (.VCon (.Bool false))) := by
  let before : Fin 28 → CekValue := fun i => ([t0, t1, t2, t3, t4, t5, t6, t7, t8, t9, t10, t11, t12, t13, t14, t15, t16, t17, t18, t19, t20, t21, t22, t23, t24, t25, t26, t27] : List CekValue).getD i.val t0
  let middle : Fin 10 → CekValue := fun i => ([m0, m1, m2, m3, m4, m5, m6, m7, m8, m9] : List CekValue).getD i.val m0
  simpa [searchEnv, before, middle, List.ofFn, hAbsent] using search_all seed before middle c9 c6 rest xs

end Lovejoin.AnyTx.LaunchSeedSlots

/-- info: 'Lovejoin.AnyTx.LaunchSeedSlots.search_false_slots' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LaunchSeedSlots.search_false_slots
