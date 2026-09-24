// The network the wallet is on, for anything that names tokens by the
// wallet's token list. App provides it from the worker's status.

import { createContext, useContext } from "react";

import type { NetworkName } from "../networks";

export const NetworkContext = createContext<NetworkName>("preprod");

export const useNetwork = () => useContext(NetworkContext);
