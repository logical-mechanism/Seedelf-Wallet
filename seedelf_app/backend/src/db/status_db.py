
from .base_db import BaseDbManager


class StatusDbManager(BaseDbManager):
    def initialize(self):
        # Initialize database tables
        with self.conn:
            # Table for status records
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS status (
                    id TEXT PRIMARY KEY,
                    block_number INTEGER,
                    block_hash TEXT,
                    timestamp INTEGER
                )
            """)

    def load(self, config):
        conn = self.get_connection()
        try:
            # use the default values in config
            conn.execute(
                'INSERT OR IGNORE INTO status (id, block_number, block_hash, timestamp) VALUES (?, ?, ?, ?)',
                (
                    "unique_status",
                    config["starting_block_number"],
                    config["starting_blockhash"],
                    config["starting_timestamp"]
                )
            )
            conn.commit()
        finally:
            conn.close()

    # it only gets created once, so the id is always known
    def update(self, block_number, block_hash, timestamp):
        conn = self.get_connection()
        try:
            conn.execute(
                'UPDATE status SET block_number = ?, block_hash = ?, timestamp = ? WHERE id = ?',
                (block_number, block_hash, timestamp, "unique_status")
            )
            conn.commit()
        finally:
            conn.close()

    def read(self):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                'SELECT block_number, block_hash, timestamp FROM status WHERE id = ?', ("unique_status",))
            record = cursor.fetchone()  # there is only one
            if record:
                block_number, block_hash, timestamp = record
                return {'block_number': block_number, 'block_hash': block_hash, 'timestamp': timestamp}
            return None
        finally:
            conn.close()
