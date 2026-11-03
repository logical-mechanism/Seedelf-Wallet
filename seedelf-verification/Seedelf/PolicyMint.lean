import Seedelf.Policy
import Blaster

/-! Mints under policy `p` off `exampleTxid#i` (i = 0, 255), no tag, of a
5eed0e1f token with a symbolic rest. The input id and the tag are concrete:
`generate` slices them, and a symbolic slice splits the run on the string's
length (see `prefixed`). So this pins the one name a given input allows, not
`generate` over every input. The expected name spells the index byte as a
literal, since a computed one is a `UInt8`. -/

namespace Seedelf.V1
open CardanoLedgerApi.IsData.Class (toTerm)
open PlutusCore.ByteString
open PlutusCore.UPLC.Term (Term)
open PlutusCore.UPLC.Utils

/-- The name `generate` gives for first input `txid#i`, with `i` as its byte. -/
def nameWith (indexByte txid tag : ByteString) : ByteString :=
  sliceByteString 0 32
    (appendByteString (appendByteString seedelfPrefix (sliceByteString 0 15 tag))
      (appendByteString indexByte txid))

def mintAt0Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) exampleTxid "" 0 1)]
def mintAt255Args (rest : ByteString) : List Term := [toTerm (mintCtx "p" "p" (prefixed rest) exampleTxid "" 255 1)]

#prep_uplc appliedMintAt0 seedelf mintAt0Args 1500
#prep_uplc appliedMintAt255 seedelf mintAt255Args 1500

/-- A mint off `exampleTxid#0` passes for exactly one name: the one `generate` gives. -/
theorem mint_at_0_iff :
  ∀ (rest : ByteString),
    isSuccessful (appliedMintAt0.prop rest) ↔ prefixed rest = nameWith "\x00" exampleTxid "" := by blaster

/-- The same off `exampleTxid#255`. -/
theorem mint_at_255_iff :
  ∀ (rest : ByteString),
    isSuccessful (appliedMintAt255.prop rest) ↔ prefixed rest = nameWith "\xff" exampleTxid "" := by blaster

end Seedelf.V1
