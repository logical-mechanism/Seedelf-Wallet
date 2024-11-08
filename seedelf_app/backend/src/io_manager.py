from loguru._logger import Logger
from src.bls12_381 import scale
from src.db_manager import DbManager
from src.parse import asset_list_to_value
from src.utility import sha3_256


class IOManager:
    ###########################################################################
    # Inputs
    ###########################################################################
    @staticmethod
    def handle_input(db: DbManager, data: dict, logger: Logger) -> None:
        # the tx hash of this transaction
        input_utxo = data['tx_input']['tx_id'] + '#' + str(data['tx_input']['index'])

        # sha3_256 hash of the input utxo
        utxo_base_64 = sha3_256(input_utxo)

        # attempt to delete from the dbs
        if db.wallet.delete(utxo_base_64):
            logger.success(f"Spent Wallet Input @ {input_utxo} @ Timestamp {data['context']['timestamp']}")

    ###########################################################################
    # Outputs
    ###########################################################################
    @staticmethod
    def handle_output(db: DbManager, config: dict, data: dict, logger: Logger) -> None:
        context = data['context']

        output_utxo = context['tx_hash'] + '#' + str(context['output_idx'])
        utxo_base_64 = sha3_256(output_utxo)

        # check if its the batcher
        if data['tx_output']['address'] == config['wallet_address']:
            value_obj = asset_list_to_value(data['tx_output']['assets'])
            value_obj.add_lovelace(data['tx_output']['amount'])

            wallet_datum = data['tx_output']['inline_datum']['plutus_data'] if data['tx_output']['inline_datum'] is not None else {}
            tkn = ""
            if wallet_datum != {}:
                try:
                    generator = wallet_datum['fields'][0]['bytes']
                    public = wallet_datum['fields'][1]['bytes']
                    elves = db.seedelf.read_all()
                    for elf in elves:
                        x = elf['secret']
                        if scale(generator, x) == public:
                            logger.success(f"Owned Output: {elf['tkn']}")
                            tkn = elf["tkn"]
                            break
                except (KeyError, IndexError):
                    tkn = ""

            # if owned by one of the seedelfs, then mark the seedelf
            db.wallet.create(utxo_base_64, output_utxo, tkn, wallet_datum, value_obj)
            logger.success(f"Wallet Output @ {output_utxo} @ Timestamp: {context['timestamp']}")
