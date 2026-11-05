import Lovejoin.AnyTx.PurposesKernel

/-! Kernel-checked mix_logic publishing handler, independent of transaction data. -/
namespace Lovejoin.AnyTx.LogicPublishKernel
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekValue (CekValue)
open PlutusCore.UPLC.CekMachine
open Seedelf.V1.LinesAll
open Lovejoin.Template.AnyTx (isRegistrationData)
open Lovejoin.AnyTx.CekCase
open Lovejoin.Template (nftName)
open Lovejoin.Template.AnyTx (purposeCtx)
set_option maxHeartbeats 0

theorem registration_passes (P : ByteString) (info red : Data) (idx : Integer) (fs : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .Constr 0 fs])] n = .Halt (.VCon .Unit) := by
  apply exec_halt_of_ev
  cek_v3

theorem other_constructor_errors (P : ByteString) (info red : Data) (idx tag : Integer) (fs : List Data)
    (hTag : tag ≠ 0) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .Constr tag fs])] n = .Error := by
  have he : PlutusCore.Integer.equalsInteger 0 tag = false := by
    simp [PlutusCore.Integer.equalsInteger, Ne.symm hTag]
  apply exec_error_of_ev
  cek_v3
  all_goals try rw [he]
  cek_v3

theorem bytes_errors (P : ByteString) (info red : Data) (idx : Integer) (x : ByteString) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .B x])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem integer_errors (P : ByteString) (info red : Data) (idx : Integer) (x : Integer) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .I x])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem list_errors (P : ByteString) (info red : Data) (idx : Integer) (x : List Data) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .List x])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

theorem map_errors (P : ByteString) (info red : Data) (idx : Integer) (x : List (Data × Data)) :
    ∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, .Map x])] n = .Error := by
  apply exec_error_of_ev
  cek_v3

/-- The publishing handler accepts exactly constructor-zero certificates, even
for arbitrary raw certificate data and transaction fields. -/
theorem publish_iff_registration (P : ByteString) (info red : Data) (idx : Integer) (cert : Data) :
    (∃ n, cekExecuteProgram mixLogicTemplate.script
      [toTerm P, toTerm nftName, toTerm (purposeCtx 3 info red [.I idx, cert])] n = .Halt (.VCon .Unit)) ↔
      isRegistrationData cert = true := by
  cases cert with
  | Constr tag fs =>
    by_cases h : tag = 0
    · subst tag
      simpa [isRegistrationData] using registration_passes P info red idx fs
    · have he := other_constructor_errors P info red idx tag fs h
      constructor
      · rintro ⟨n, hn⟩
        obtain ⟨m, hm⟩ := he
        exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
      · intro hc
        simp [isRegistrationData, h] at hc
  | Map x =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := map_errors P info red idx x
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
    · intro hc; cases hc
  | List x =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := list_errors P info red idx x
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
    · intro hc; cases hc
  | I x =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := integer_errors P info red idx x
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
    · intro hc; cases hc
  | B x =>
    constructor
    · rintro ⟨n, hn⟩
      obtain ⟨m, hm⟩ := bytes_errors P info red idx x
      exact False.elim ((exec_never_halts hm n (.VCon .Unit)) hn)
    · intro hc; cases hc

end Lovejoin.AnyTx.LogicPublishKernel

/-- info: 'Lovejoin.AnyTx.LogicPublishKernel.publish_iff_registration' depends on axioms: [propext, Classical.choice, Quot.sound] -/
#guard_msgs in
#print axioms Lovejoin.AnyTx.LogicPublishKernel.publish_iff_registration
