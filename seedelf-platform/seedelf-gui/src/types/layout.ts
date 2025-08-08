import { TxResponseWithSide } from "./wallet";

// to be passed into the outlets
export type OutletContextType = {
  lovelace: number;
  allSeedelfs: string[];
  ownedSeedelfs: string[];
  history: TxResponseWithSide[];
};
