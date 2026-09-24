// Copyright © 2021 IOHK. Licensed under the Apache License, Version 2.0; see
// LICENSE-APACHE-2.0 in this folder.
// Adapted from Lace (lace-extension@2.4.0) packages/lib/core/src/secret-box/index.ts.
// Changed by Logical Mechanism LLC: no EMIP-003 support.

import { isSealed } from "./format";
import { setArgon2idImplementation } from "./kdf";
import { open } from "./open";
import { seal } from "./seal";

export type { Argon2idImplementation, Argon2idParams } from "./kdf";

/** Password-based authenticated encryption for wallet secrets at rest (`SBV1`). */
export const SecretBox = { seal, open, isSealed, setArgon2idImplementation };
