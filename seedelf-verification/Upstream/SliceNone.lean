import Upstream.SlicePrograms
import Blaster

/-! `noslice` prepared over a symbolic bytestring: compare this module's peak
memory and time across SliceNone, Slice1, Slice4, Slice16 and Slice32. -/

namespace Upstream
open PlutusCore.UPLC.Utils

#prep_uplc prepared_noslice noslice bsArg 4000

theorem noslice_halts : ∀ bs, isSuccessful (prepared_noslice.prop bs) := by blaster

end Upstream
