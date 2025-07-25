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

export interface Asset {
  decimals: number; // u8
  quantity: string;
  policy_id: string;
  asset_name: string;
  fingerprint: string;
}

export interface InlineDatum {
  bytes: string;
  value: unknown; // serde_json::Value
}

export interface UtxoResponse {
  tx_hash: string;
  tx_index: number; // u64 (beware >2^53 precision)
  address: string;
  value: string;
  stake_address: string | null;
  payment_cred: string;
  epoch_no: number;
  block_height: number;
  block_time: number;
  datum_hash: string | null;
  inline_datum: InlineDatum | null;
  reference_script: unknown | null;
  asset_list: Asset[] | null;
  is_spent: boolean;
}
