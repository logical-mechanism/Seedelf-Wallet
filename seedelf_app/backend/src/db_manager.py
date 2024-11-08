from src.db.history_db import HistoryDbManager
from src.db.reference_db import ReferenceDbManager
from src.db.seedelf_db import SeedelfDbManager
from src.db.status_db import StatusDbManager
from src.db.wallet_db import WalletDbManager


class DbManager:
    def __init__(self, db_file: str):
        self.history = HistoryDbManager(db_file)
        self.reference = ReferenceDbManager(db_file)
        self.seedelf = SeedelfDbManager(db_file)
        self.status = StatusDbManager(db_file)
        self.wallet = WalletDbManager(db_file)

    def initialize(self, config):
        self.history.initialize()
        self.reference.initialize()
        self.seedelf.initialize()
        self.status.initialize()
        self.wallet.initialize()
        #
        # load the start status from config
        #
        self.reference.load(config)
        self.status.load(config)

    def cleanup(self):
        self.history.cleanup()
        self.reference.cleanup()
        self.seedelf.cleanup()
        self.status.cleanup()
        self.wallet.cleanup()
