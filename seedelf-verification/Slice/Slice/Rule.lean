import Slice.Index0
import Slice.Index1
import Slice.Index2
import Slice.Index3

/-! The Seedelf policy's rule for one mint line, in every transaction, put together.

`Index0` to `Index3` prove `RuleAt k` for each first-input index `k` from 0 to 255, and `Run`
proves it below 0 and above 255, so it holds at every index: `policy_one_line_any_index`,
kernel-checked from those 258 Blaster theorems, no Blaster here. Every other value is symbolic
in each, and every field the bytes don't read any `Data` (Run). So, for every mint of one line,
in every transaction whose redeemer is a bytestring:

- `policy_one_line_iff_every_tx`: the deployed bytes, run on it, succeed iff `policyAccepts`
  holds: the first input's index is a byte, the line is the policy's own, and it burns one
  token whose first four bytes are 5eed0e1f or mints one of the name `generate` gives the
  first input and the tag;
- `policy_one_line_unit_or_error_every_tx`: every run returns unit, which the ledger
  accepts, or reaches `Error`, inside the step limit.

Together: what `policyAccepts` allows returns unit, and nothing else does. Both hold for any
interpretation of the slice (Run), and are stated over `ByteString` names; `…_any_tx` are the
same over the name's `String`, as the per-index theorems have it. -/

namespace Seedelf.V1
open PlutusCore.ByteString (ByteString)
open PlutusCore.Integer (Integer)
open PlutusCore.Data (Data)
open PlutusCore.UPLC.CekMachine (cekExecuteProgram)
open PlutusCore.UPLC.Utils

/-- Every index that is a byte, from its own theorem. -/
theorem policy_one_line_at_a_byte : ∀ (k : Nat), k < 256 → RuleAt k
  | 0, _ => policy_one_line_at_0
  | 1, _ => policy_one_line_at_1
  | 2, _ => policy_one_line_at_2
  | 3, _ => policy_one_line_at_3
  | 4, _ => policy_one_line_at_4
  | 5, _ => policy_one_line_at_5
  | 6, _ => policy_one_line_at_6
  | 7, _ => policy_one_line_at_7
  | 8, _ => policy_one_line_at_8
  | 9, _ => policy_one_line_at_9
  | 10, _ => policy_one_line_at_10
  | 11, _ => policy_one_line_at_11
  | 12, _ => policy_one_line_at_12
  | 13, _ => policy_one_line_at_13
  | 14, _ => policy_one_line_at_14
  | 15, _ => policy_one_line_at_15
  | 16, _ => policy_one_line_at_16
  | 17, _ => policy_one_line_at_17
  | 18, _ => policy_one_line_at_18
  | 19, _ => policy_one_line_at_19
  | 20, _ => policy_one_line_at_20
  | 21, _ => policy_one_line_at_21
  | 22, _ => policy_one_line_at_22
  | 23, _ => policy_one_line_at_23
  | 24, _ => policy_one_line_at_24
  | 25, _ => policy_one_line_at_25
  | 26, _ => policy_one_line_at_26
  | 27, _ => policy_one_line_at_27
  | 28, _ => policy_one_line_at_28
  | 29, _ => policy_one_line_at_29
  | 30, _ => policy_one_line_at_30
  | 31, _ => policy_one_line_at_31
  | 32, _ => policy_one_line_at_32
  | 33, _ => policy_one_line_at_33
  | 34, _ => policy_one_line_at_34
  | 35, _ => policy_one_line_at_35
  | 36, _ => policy_one_line_at_36
  | 37, _ => policy_one_line_at_37
  | 38, _ => policy_one_line_at_38
  | 39, _ => policy_one_line_at_39
  | 40, _ => policy_one_line_at_40
  | 41, _ => policy_one_line_at_41
  | 42, _ => policy_one_line_at_42
  | 43, _ => policy_one_line_at_43
  | 44, _ => policy_one_line_at_44
  | 45, _ => policy_one_line_at_45
  | 46, _ => policy_one_line_at_46
  | 47, _ => policy_one_line_at_47
  | 48, _ => policy_one_line_at_48
  | 49, _ => policy_one_line_at_49
  | 50, _ => policy_one_line_at_50
  | 51, _ => policy_one_line_at_51
  | 52, _ => policy_one_line_at_52
  | 53, _ => policy_one_line_at_53
  | 54, _ => policy_one_line_at_54
  | 55, _ => policy_one_line_at_55
  | 56, _ => policy_one_line_at_56
  | 57, _ => policy_one_line_at_57
  | 58, _ => policy_one_line_at_58
  | 59, _ => policy_one_line_at_59
  | 60, _ => policy_one_line_at_60
  | 61, _ => policy_one_line_at_61
  | 62, _ => policy_one_line_at_62
  | 63, _ => policy_one_line_at_63
  | 64, _ => policy_one_line_at_64
  | 65, _ => policy_one_line_at_65
  | 66, _ => policy_one_line_at_66
  | 67, _ => policy_one_line_at_67
  | 68, _ => policy_one_line_at_68
  | 69, _ => policy_one_line_at_69
  | 70, _ => policy_one_line_at_70
  | 71, _ => policy_one_line_at_71
  | 72, _ => policy_one_line_at_72
  | 73, _ => policy_one_line_at_73
  | 74, _ => policy_one_line_at_74
  | 75, _ => policy_one_line_at_75
  | 76, _ => policy_one_line_at_76
  | 77, _ => policy_one_line_at_77
  | 78, _ => policy_one_line_at_78
  | 79, _ => policy_one_line_at_79
  | 80, _ => policy_one_line_at_80
  | 81, _ => policy_one_line_at_81
  | 82, _ => policy_one_line_at_82
  | 83, _ => policy_one_line_at_83
  | 84, _ => policy_one_line_at_84
  | 85, _ => policy_one_line_at_85
  | 86, _ => policy_one_line_at_86
  | 87, _ => policy_one_line_at_87
  | 88, _ => policy_one_line_at_88
  | 89, _ => policy_one_line_at_89
  | 90, _ => policy_one_line_at_90
  | 91, _ => policy_one_line_at_91
  | 92, _ => policy_one_line_at_92
  | 93, _ => policy_one_line_at_93
  | 94, _ => policy_one_line_at_94
  | 95, _ => policy_one_line_at_95
  | 96, _ => policy_one_line_at_96
  | 97, _ => policy_one_line_at_97
  | 98, _ => policy_one_line_at_98
  | 99, _ => policy_one_line_at_99
  | 100, _ => policy_one_line_at_100
  | 101, _ => policy_one_line_at_101
  | 102, _ => policy_one_line_at_102
  | 103, _ => policy_one_line_at_103
  | 104, _ => policy_one_line_at_104
  | 105, _ => policy_one_line_at_105
  | 106, _ => policy_one_line_at_106
  | 107, _ => policy_one_line_at_107
  | 108, _ => policy_one_line_at_108
  | 109, _ => policy_one_line_at_109
  | 110, _ => policy_one_line_at_110
  | 111, _ => policy_one_line_at_111
  | 112, _ => policy_one_line_at_112
  | 113, _ => policy_one_line_at_113
  | 114, _ => policy_one_line_at_114
  | 115, _ => policy_one_line_at_115
  | 116, _ => policy_one_line_at_116
  | 117, _ => policy_one_line_at_117
  | 118, _ => policy_one_line_at_118
  | 119, _ => policy_one_line_at_119
  | 120, _ => policy_one_line_at_120
  | 121, _ => policy_one_line_at_121
  | 122, _ => policy_one_line_at_122
  | 123, _ => policy_one_line_at_123
  | 124, _ => policy_one_line_at_124
  | 125, _ => policy_one_line_at_125
  | 126, _ => policy_one_line_at_126
  | 127, _ => policy_one_line_at_127
  | 128, _ => policy_one_line_at_128
  | 129, _ => policy_one_line_at_129
  | 130, _ => policy_one_line_at_130
  | 131, _ => policy_one_line_at_131
  | 132, _ => policy_one_line_at_132
  | 133, _ => policy_one_line_at_133
  | 134, _ => policy_one_line_at_134
  | 135, _ => policy_one_line_at_135
  | 136, _ => policy_one_line_at_136
  | 137, _ => policy_one_line_at_137
  | 138, _ => policy_one_line_at_138
  | 139, _ => policy_one_line_at_139
  | 140, _ => policy_one_line_at_140
  | 141, _ => policy_one_line_at_141
  | 142, _ => policy_one_line_at_142
  | 143, _ => policy_one_line_at_143
  | 144, _ => policy_one_line_at_144
  | 145, _ => policy_one_line_at_145
  | 146, _ => policy_one_line_at_146
  | 147, _ => policy_one_line_at_147
  | 148, _ => policy_one_line_at_148
  | 149, _ => policy_one_line_at_149
  | 150, _ => policy_one_line_at_150
  | 151, _ => policy_one_line_at_151
  | 152, _ => policy_one_line_at_152
  | 153, _ => policy_one_line_at_153
  | 154, _ => policy_one_line_at_154
  | 155, _ => policy_one_line_at_155
  | 156, _ => policy_one_line_at_156
  | 157, _ => policy_one_line_at_157
  | 158, _ => policy_one_line_at_158
  | 159, _ => policy_one_line_at_159
  | 160, _ => policy_one_line_at_160
  | 161, _ => policy_one_line_at_161
  | 162, _ => policy_one_line_at_162
  | 163, _ => policy_one_line_at_163
  | 164, _ => policy_one_line_at_164
  | 165, _ => policy_one_line_at_165
  | 166, _ => policy_one_line_at_166
  | 167, _ => policy_one_line_at_167
  | 168, _ => policy_one_line_at_168
  | 169, _ => policy_one_line_at_169
  | 170, _ => policy_one_line_at_170
  | 171, _ => policy_one_line_at_171
  | 172, _ => policy_one_line_at_172
  | 173, _ => policy_one_line_at_173
  | 174, _ => policy_one_line_at_174
  | 175, _ => policy_one_line_at_175
  | 176, _ => policy_one_line_at_176
  | 177, _ => policy_one_line_at_177
  | 178, _ => policy_one_line_at_178
  | 179, _ => policy_one_line_at_179
  | 180, _ => policy_one_line_at_180
  | 181, _ => policy_one_line_at_181
  | 182, _ => policy_one_line_at_182
  | 183, _ => policy_one_line_at_183
  | 184, _ => policy_one_line_at_184
  | 185, _ => policy_one_line_at_185
  | 186, _ => policy_one_line_at_186
  | 187, _ => policy_one_line_at_187
  | 188, _ => policy_one_line_at_188
  | 189, _ => policy_one_line_at_189
  | 190, _ => policy_one_line_at_190
  | 191, _ => policy_one_line_at_191
  | 192, _ => policy_one_line_at_192
  | 193, _ => policy_one_line_at_193
  | 194, _ => policy_one_line_at_194
  | 195, _ => policy_one_line_at_195
  | 196, _ => policy_one_line_at_196
  | 197, _ => policy_one_line_at_197
  | 198, _ => policy_one_line_at_198
  | 199, _ => policy_one_line_at_199
  | 200, _ => policy_one_line_at_200
  | 201, _ => policy_one_line_at_201
  | 202, _ => policy_one_line_at_202
  | 203, _ => policy_one_line_at_203
  | 204, _ => policy_one_line_at_204
  | 205, _ => policy_one_line_at_205
  | 206, _ => policy_one_line_at_206
  | 207, _ => policy_one_line_at_207
  | 208, _ => policy_one_line_at_208
  | 209, _ => policy_one_line_at_209
  | 210, _ => policy_one_line_at_210
  | 211, _ => policy_one_line_at_211
  | 212, _ => policy_one_line_at_212
  | 213, _ => policy_one_line_at_213
  | 214, _ => policy_one_line_at_214
  | 215, _ => policy_one_line_at_215
  | 216, _ => policy_one_line_at_216
  | 217, _ => policy_one_line_at_217
  | 218, _ => policy_one_line_at_218
  | 219, _ => policy_one_line_at_219
  | 220, _ => policy_one_line_at_220
  | 221, _ => policy_one_line_at_221
  | 222, _ => policy_one_line_at_222
  | 223, _ => policy_one_line_at_223
  | 224, _ => policy_one_line_at_224
  | 225, _ => policy_one_line_at_225
  | 226, _ => policy_one_line_at_226
  | 227, _ => policy_one_line_at_227
  | 228, _ => policy_one_line_at_228
  | 229, _ => policy_one_line_at_229
  | 230, _ => policy_one_line_at_230
  | 231, _ => policy_one_line_at_231
  | 232, _ => policy_one_line_at_232
  | 233, _ => policy_one_line_at_233
  | 234, _ => policy_one_line_at_234
  | 235, _ => policy_one_line_at_235
  | 236, _ => policy_one_line_at_236
  | 237, _ => policy_one_line_at_237
  | 238, _ => policy_one_line_at_238
  | 239, _ => policy_one_line_at_239
  | 240, _ => policy_one_line_at_240
  | 241, _ => policy_one_line_at_241
  | 242, _ => policy_one_line_at_242
  | 243, _ => policy_one_line_at_243
  | 244, _ => policy_one_line_at_244
  | 245, _ => policy_one_line_at_245
  | 246, _ => policy_one_line_at_246
  | 247, _ => policy_one_line_at_247
  | 248, _ => policy_one_line_at_248
  | 249, _ => policy_one_line_at_249
  | 250, _ => policy_one_line_at_250
  | 251, _ => policy_one_line_at_251
  | 252, _ => policy_one_line_at_252
  | 253, _ => policy_one_line_at_253
  | 254, _ => policy_one_line_at_254
  | 255, _ => policy_one_line_at_255
  | _ + 256, h => absurd h (by omega)

/-- Every index: a byte, or below or above one. -/
theorem policy_one_line_any_index : ∀ (idx : Int), RuleAt idx := by
  intro idx
  by_cases h0 : (0 : Int) ≤ idx
  · by_cases h1 : idx ≤ (255 : Int)
    · have e : (idx.toNat : Int) = idx := Int.toNat_of_nonneg h0
      have hk : idx.toNat < 256 := by omega
      have h := policy_one_line_at_a_byte idx.toNat hk
      rwa [e] at h
    · exact policy_one_line_above_a_byte idx h1
  · exact policy_one_line_below_a_byte idx h0

/-- In every transaction, one mint line passes iff `policyAccepts` holds. The token name is
given by its bytes, as the per-index theorems have it. -/
theorem policy_one_line_iff_any_tx :
  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt idx : Integer),
    isSuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) ↔
      policyAccepts own pid ⟨tkn⟩ tag txid amt idx = true :=
  fun r sigs out rest own pid tkn tag txid amt idx =>
    (policy_one_line_any_index idx r sigs out rest own pid tkn tag txid amt).1

/-- Every run returns unit, which the ledger accepts, or reaches `Error`: none is cut off by
the step limit, and none halts with another value. -/
theorem policy_one_line_unit_or_error_any_tx :
  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid : ByteString) (tkn : String)
    (tag txid : ByteString) (amt idx : Integer),
    returnsUnit (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) ∨
      isUnsuccessful (sliceRuleRun r sigs out rest own pid tkn tag txid amt idx) :=
  fun r sigs out rest own pid tkn tag txid amt idx =>
    (policy_one_line_any_index idx r sigs out rest own pid tkn tag txid amt).2

/-- The rule over every `ByteString` name, a `⟨s⟩` of its bytes: the deployed bytes, run on
`sliceRuleArgs` for 1500 steps, succeed iff `policyAccepts` holds. -/
theorem policy_one_line_iff_every_tx :
  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid tkn tag txid : ByteString)
    (amt idx : Integer),
    isSuccessful (cekExecuteProgram seedelfSlicePolicy.script
        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) ↔
      policyAccepts own pid tkn tag txid amt idx = true :=
  fun r sigs out rest own pid tkn tag txid amt idx =>
    policy_one_line_iff_any_tx r sigs out rest own pid tkn.data tag txid amt idx

/-- And every such run returns unit or reaches `Error`. -/
theorem policy_one_line_unit_or_error_every_tx :
  ∀ (r : TxRest) (sigs out : Data) (rest : List Data) (own pid tkn tag txid : ByteString)
    (amt idx : Integer),
    returnsUnit (cekExecuteProgram seedelfSlicePolicy.script
        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) ∨
      isUnsuccessful (cekExecuteProgram seedelfSlicePolicy.script
        (sliceRuleArgs r sigs out rest own pid tkn tag txid amt idx) 1500) :=
  fun r sigs out rest own pid tkn tag txid amt idx =>
    policy_one_line_unit_or_error_any_tx r sigs out rest own pid tkn.data tag txid amt idx

-- What the rule rests on: Blaster's `blasterProven` and Lean's own axioms, no `sorryAx`.
#print axioms policy_one_line_iff_every_tx
#print axioms policy_one_line_unit_or_error_every_tx

end Seedelf.V1
