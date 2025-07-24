export type WalletExistsResult = string | null;

export type UTxOSide = "Input" | "Output";

export interface Register {
  generator: string;
  public_value: string;
}

export interface TxResponse {
  tx_hash: string;
  block_height: number;
  input_registers: Register[];
  output_registers: Register[];
}

export interface TxResponseWithSide {
  side: UTxOSide;
  tx: TxResponse;
}