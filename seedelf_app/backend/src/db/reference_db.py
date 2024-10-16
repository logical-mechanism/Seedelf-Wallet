import json
import os

import cbor2
from src.value import Value

from .base_db import BaseDbManager


def get_cbor_from_file(tx_draft_path: str) -> str:
    """Open the transaction draft file and return the cbor hex.

    Args:
        tx_draft_path (str): The path to the draft transaction file.

    Returns:
        str: The cbor of the transaction.
    """
    # get cborHex from tx draft
    with open(tx_draft_path, 'r') as file:
        data = json.load(file)

    try:
        # get cbor hex from the file and proceed
        return data['cborHex']
    except KeyError:
        return None


class ReferenceDbManager(BaseDbManager):
    def initialize(self):
        # Initialize database tables
        with self.conn:
            # Table for reference records
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS reference (
                    id TEXT PRIMARY KEY,
                    txid TEXT,
                    cborHex TEXT,
                    value TEXT
                )
            """)

    def load(self, config):
        conn = self.get_connection()
        # The parent directory for relative pathing
        parent_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

        # wallet
        wallet_path = os.path.join(parent_dir, "contracts/wallet_contract.plutus")
        wallet_double_cbor = get_cbor_from_file(wallet_path)
        wallet_cbor = cbor2.loads(bytes.fromhex(wallet_double_cbor)).hex()

        # seedelf
        seedelf_path = os.path.join(parent_dir, "contracts/seedelf_contract.plutus")
        seedelf_double_cbor = get_cbor_from_file(seedelf_path)
        seedelf_cbor = cbor2.loads(bytes.fromhex(seedelf_double_cbor)).hex()

        try:
            conn.execute(
                'INSERT OR REPLACE INTO reference (id, txid, cborHex, value) VALUES (?, ?, ?, ?)',
                ("wallet_reference", config["wallet_ref_utxo"], wallet_cbor, Value({"lovelace": config["wallet_lovelace"]}).dump())
            )
            conn.execute(
                'INSERT OR REPLACE INTO reference (id, txid, cborHex, value) VALUES (?, ?, ?, ?)',
                ("seedelf_reference", config["seedelf_ref_utxo"], seedelf_cbor, Value({"lovelace": config["seedelf_lovelace"]}).dump())
            )
            conn.commit()
        finally:
            conn.close()

    def read(self):
        conn = self.get_connection()
        data = {
            "wallet": {},
            "seedelf": {},
        }
        try:
            cursor = conn.cursor()
            references = {
                "wallet_reference": "wallet",
                "seedelf_reference": "seedelf",
            }

            for ref_id, key in references.items():
                cursor.execute('SELECT txid, cborHex, value FROM reference WHERE id = ?', (ref_id,))
                record = cursor.fetchone()  # there is only one
                if record:
                    txid, cborHex, value_json = record
                    value = self.json_to_data(value_json)
                    data[key] = {'txid': txid, 'cborHex': cborHex, 'value': Value(value)}
            return data
        finally:
            conn.close()
