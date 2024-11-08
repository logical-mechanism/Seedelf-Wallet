from src.value import Value

from .base_db import BaseDbManager


class WalletDbManager(BaseDbManager):
    def initialize(self):
        # Initialize database tables
        with self.conn:
            # Table for wallet records
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS wallet (
                    tag TEXT PRIMARY KEY,
                    txid TEXT,
                    tkn TEXT,
                    datum TEXT,
                    value TEXT
                )
            """)

    def create(self, tag, txid, tkn, datum, value):
        conn = self.get_connection()
        try:
            datum_json = self.data_to_json(datum)
            value_json = value.dump()
            conn.execute(
                'INSERT OR REPLACE INTO wallet (tag, txid, tkn, datum, value) VALUES (?, ?, ?, ?, ?)',
                (tag, txid, tkn, datum_json, value_json)
            )
            conn.commit()
        finally:
            conn.close()

    def read(self, tag):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT txid, tkn, datum, value FROM wallet WHERE tag = ?', (tag,))
            record = cursor.fetchone()
            if record:
                txid, tkn, datum_json, value_json = record
                datum = self.json_to_data(datum_json)
                value = self.json_to_data(value_json)
                return {'tag': tag, 'txid': txid, 'tkn': tkn, 'datum': datum, 'value': Value(value)}
            return None
        finally:
            conn.close()

    def read_all(self):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT tag, txid, tkn, datum, value FROM wallet')
            records = cursor.fetchall()
            wallet_records = []
            for record in records:
                tag, txid, tkn, datum_json, value_json = record
                datum = self.json_to_data(datum_json)
                value = self.json_to_data(value_json)
                wallet_records.append({'tag': tag, 'txid': txid, 'tkn': tkn, 'datum': datum, 'value': Value(value)})
            return wallet_records
        finally:
            conn.close()

    def read_all_mine(self, tkn):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT tag, txid, tkn, datum, value FROM wallet WHERE tkn = ?', (tkn,))
            records = cursor.fetchall()
            wallet_records = []
            for record in records:
                tag, txid, tkn, datum_json, value_json = record
                datum = self.json_to_data(datum_json)
                value = self.json_to_data(value_json)
                wallet_records.append({'tag': tag, 'txid': txid, 'tkn': tkn, 'datum': datum, 'value': Value(value)})
            return wallet_records
        finally:
            conn.close()

    # get all wallet records by tkn

    def delete(self, tag):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            # Check if the record exists with the given txid
            cursor.execute('SELECT EXISTS(SELECT 1 FROM wallet WHERE tag = ?)', (tag,))
            exists = cursor.fetchone()[0]
            if exists:
                # If the record exists, delete it
                cursor.execute('DELETE FROM wallet WHERE tag = ?', (tag,))
                conn.commit()
                return True  # Record with the given txid existed and was deleted
            else:
                return False  # No record with the given txid
        finally:
            conn.close()
