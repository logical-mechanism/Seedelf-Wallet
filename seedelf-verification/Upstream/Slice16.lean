import Upstream.SlicePrograms
import Blaster

/-! `slice16` prepared over a symbolic bytestring: compare this module's peak
memory and time across SliceNone, Slice1, Slice4, Slice16 and Slice32. -/

namespace Upstream
open PlutusCore.UPLC.Utils

#prep_uplc prepared_slice16 slice16 bsArg 4000

theorem slice16_halts : ∀ bs, isSuccessful (prepared_slice16.prop bs) := by blaster

end Upstream
