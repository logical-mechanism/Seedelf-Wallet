import Upstream.SlicePrograms
import Blaster

/-! `slice1` prepared over a symbolic bytestring: compare this module's peak
memory and time across SliceNone, Slice1, Slice4, Slice16 and Slice32. -/

namespace Upstream
open PlutusCore.UPLC.Utils

#prep_uplc prepared_slice1 slice1 bsArg 4000

theorem slice1_halts : ∀ bs, isSuccessful (prepared_slice1.prop bs) := by blaster

end Upstream
