import { TxResponseWithSide } from "./wallet";

// to be passed into the outlets
export type OutletContextType = { lovelace: number; history: TxResponseWithSide[] };