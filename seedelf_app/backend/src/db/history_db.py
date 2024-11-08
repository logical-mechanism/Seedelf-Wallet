from .base_db import BaseDbManager


class HistoryDbManager(BaseDbManager):
    def initialize(self):
        # Initialize database tables
        with self.conn:
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS history (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    tag TEXT,
                    txid TEXT
                )
            """)

    def create(self, tag, txid):
        conn = self.get_connection()
        try:
            conn.execute(
                'INSERT OR REPLACE INTO history (tag, txid) VALUES (?, ?)',
                (tag, txid)
            )
            conn.commit()
        finally:
            conn.close()

    def read(self, tag):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT txid FROM history WHERE tag = ?', (tag,))
            record = cursor.fetchone()
            if record:
                txid = record[0]
                return {'tag': tag, 'txid': txid}
            return None
        finally:
            conn.close()

    def read_all(self):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT tag, txid FROM history')
            records = cursor.fetchall()
            wallet_records = [{'tag': tag, 'txid': txid} for tag, txid in records]
            return wallet_records
        finally:
            conn.close()
