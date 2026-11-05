import Slice.Run
import Blaster

/-! The policy's rule for one mint line at each first-input index from 0 to 63, in every
transaction: `Run`'s `RuleAt`, one theorem an index, the index concrete and everything else
symbolic. A symbolic index can't be: its byte is a `BitVec` (Run). `Rule` puts the 256 together
with `Run`'s two off-byte theorems. -/

namespace Seedelf.V1

theorem policy_one_line_at_0 : RuleAt 0 := by blaster
theorem policy_one_line_at_1 : RuleAt 1 := by blaster
theorem policy_one_line_at_2 : RuleAt 2 := by blaster
theorem policy_one_line_at_3 : RuleAt 3 := by blaster
theorem policy_one_line_at_4 : RuleAt 4 := by blaster
theorem policy_one_line_at_5 : RuleAt 5 := by blaster
theorem policy_one_line_at_6 : RuleAt 6 := by blaster
theorem policy_one_line_at_7 : RuleAt 7 := by blaster
theorem policy_one_line_at_8 : RuleAt 8 := by blaster
theorem policy_one_line_at_9 : RuleAt 9 := by blaster
theorem policy_one_line_at_10 : RuleAt 10 := by blaster
theorem policy_one_line_at_11 : RuleAt 11 := by blaster
theorem policy_one_line_at_12 : RuleAt 12 := by blaster
theorem policy_one_line_at_13 : RuleAt 13 := by blaster
theorem policy_one_line_at_14 : RuleAt 14 := by blaster
theorem policy_one_line_at_15 : RuleAt 15 := by blaster
theorem policy_one_line_at_16 : RuleAt 16 := by blaster
theorem policy_one_line_at_17 : RuleAt 17 := by blaster
theorem policy_one_line_at_18 : RuleAt 18 := by blaster
theorem policy_one_line_at_19 : RuleAt 19 := by blaster
theorem policy_one_line_at_20 : RuleAt 20 := by blaster
theorem policy_one_line_at_21 : RuleAt 21 := by blaster
theorem policy_one_line_at_22 : RuleAt 22 := by blaster
theorem policy_one_line_at_23 : RuleAt 23 := by blaster
theorem policy_one_line_at_24 : RuleAt 24 := by blaster
theorem policy_one_line_at_25 : RuleAt 25 := by blaster
theorem policy_one_line_at_26 : RuleAt 26 := by blaster
theorem policy_one_line_at_27 : RuleAt 27 := by blaster
theorem policy_one_line_at_28 : RuleAt 28 := by blaster
theorem policy_one_line_at_29 : RuleAt 29 := by blaster
theorem policy_one_line_at_30 : RuleAt 30 := by blaster
theorem policy_one_line_at_31 : RuleAt 31 := by blaster
theorem policy_one_line_at_32 : RuleAt 32 := by blaster
theorem policy_one_line_at_33 : RuleAt 33 := by blaster
theorem policy_one_line_at_34 : RuleAt 34 := by blaster
theorem policy_one_line_at_35 : RuleAt 35 := by blaster
theorem policy_one_line_at_36 : RuleAt 36 := by blaster
theorem policy_one_line_at_37 : RuleAt 37 := by blaster
theorem policy_one_line_at_38 : RuleAt 38 := by blaster
theorem policy_one_line_at_39 : RuleAt 39 := by blaster
theorem policy_one_line_at_40 : RuleAt 40 := by blaster
theorem policy_one_line_at_41 : RuleAt 41 := by blaster
theorem policy_one_line_at_42 : RuleAt 42 := by blaster
theorem policy_one_line_at_43 : RuleAt 43 := by blaster
theorem policy_one_line_at_44 : RuleAt 44 := by blaster
theorem policy_one_line_at_45 : RuleAt 45 := by blaster
theorem policy_one_line_at_46 : RuleAt 46 := by blaster
theorem policy_one_line_at_47 : RuleAt 47 := by blaster
theorem policy_one_line_at_48 : RuleAt 48 := by blaster
theorem policy_one_line_at_49 : RuleAt 49 := by blaster
theorem policy_one_line_at_50 : RuleAt 50 := by blaster
theorem policy_one_line_at_51 : RuleAt 51 := by blaster
theorem policy_one_line_at_52 : RuleAt 52 := by blaster
theorem policy_one_line_at_53 : RuleAt 53 := by blaster
theorem policy_one_line_at_54 : RuleAt 54 := by blaster
theorem policy_one_line_at_55 : RuleAt 55 := by blaster
theorem policy_one_line_at_56 : RuleAt 56 := by blaster
theorem policy_one_line_at_57 : RuleAt 57 := by blaster
theorem policy_one_line_at_58 : RuleAt 58 := by blaster
theorem policy_one_line_at_59 : RuleAt 59 := by blaster
theorem policy_one_line_at_60 : RuleAt 60 := by blaster
theorem policy_one_line_at_61 : RuleAt 61 := by blaster
theorem policy_one_line_at_62 : RuleAt 62 := by blaster
theorem policy_one_line_at_63 : RuleAt 63 := by blaster

end Seedelf.V1
