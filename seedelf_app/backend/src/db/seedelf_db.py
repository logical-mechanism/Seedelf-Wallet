from .base_db import BaseDbManager


class SeedelfDbManager(BaseDbManager):
    def initialize(self):
        # Initialize database tables
        with self.conn:
            # Table for the seedelf records
            self.conn.execute("""
                CREATE TABLE IF NOT EXISTS seedelf (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    secret INTEGER,
                    tkn TEXT
                )
            """)

    def create(self, secret: str, tkn: str):
        conn = self.get_connection()
        try:
            conn.execute(
                'INSERT OR REPLACE INTO seedelf (secret, tkn) VALUES (?, ?)',
                (secret, tkn))
            conn.commit()
        finally:
            conn.close()

    def read(self, tkn):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT secret, tkn FROM seedelf WHERE tkn = ?', (tkn,))
            record = cursor.fetchone()
            if record:
                secret, tkn = record
                return {'secret': secret, 'tkn': tkn}
            return None
        finally:
            conn.close()

    def read_all(self):
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute('SELECT secret, tkn FROM seedelf')
            records = cursor.fetchall()
            wallet_records = []
            for record in records:
                secret, tkn = record
                wallet_records.append({'secret': secret, 'tkn': tkn})
            return wallet_records
        finally:
            conn.close()

    def delete(self, current_time: int):
        conn = self.get_connection()
        try:
            conn.execute(
                'DELETE FROM seedelf WHERE end_time <= ?',
                (current_time,)
            )
            conn.commit()
        finally:
            conn.close()
