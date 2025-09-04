import { TxResponseWithSide } from "./wallet";

// Use a outlet context here to hold data that can be shared all over. Add
// whatever when applicable and use only what you need on the page/component.
export type OutletContextType = {
  lovelace: number;
  allSeedelfs: string[];
  ownedSeedelfs: string[];
  history: TxResponseWithSide[];
};
