import logging
import multiprocessing
import os
import subprocess

from flask import Flask, request
from flask_cors import CORS
from loguru import logger

from api.sync import sync_bp
from api.utxos import utxos_bp
from src import yaml_file
from src.daemon import create_toml_file
from src.db_manager import DbManager
from src.io_manager import IOManager
from src.koios import get_latest_block_number, get_protocol_params
from src.utility import create_folder_if_not_exists

# Get the directory of the currently executing script
backend_path = os.path.dirname(os.path.abspath(__file__))
parent_directory = os.path.dirname(backend_path)
bin_directory = os.path.join(backend_path, 'bin')
# Path to the same SQLite3 database Django is using
database_path = os.path.join(backend_path, 'db.sqlite3')

# load the environment configuration
config = yaml_file.read("config.yaml")

db = DbManager(database_path)
db.initialize(config)

# Log path
log_file_path = os.path.join(backend_path, 'app.log')

# create the tmp directory if it doesn't exist already
tmp_folder = os.path.join(backend_path, "tmp")
create_folder_if_not_exists(tmp_folder)

# get the current protocol parameters
get_protocol_params(config["network"], os.path.join(tmp_folder, "protocol.json"))

# the latest block at start time
latest_block_number = get_latest_block_number(config['network'])

# Configure log rotation with a maximum file size, retention, and log level
logger.add(
    log_file_path,
    rotation=config["max_log_file_size"],
    retention=config["max_num_log_files"],
    level=config["logging_level"]
)
app = Flask(__name__)

CORS(app, origins=['http://localhost:3000'])

# Register the UTxOs blueprint
app.register_blueprint(utxos_bp)
app.register_blueprint(sync_bp)

# Attach the db manager
app.db_manager = db

# Disable Flask's default logger
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)


@app.route('/webhook', methods=['POST'])
def webhook():
    """The webhook for oura. This is where all the db logic needs to go.

    Returns:
        str: A success/failure string
    """
    data = request.get_json()  # Get the JSON data from the request
    block_number = data['context']['block_number']
    block_hash = data['context']['block_hash']
    block_slot = data['context']['slot']

    # Get the current status
    sync_status = db.status.read()

    # What the db thinks is the current block is
    db_number = sync_status["block_number"]

    # check for a change in the block number
    if block_number != db_number:
        # the block number has changed so update the db
        db.status.update(block_number, block_hash, block_slot)
        # are we still syncing?
        try:
            if int(block_number) > latest_block_number:
                logger.debug(f"Block: {block_number} : Timestamp: {block_slot}")
            else:
                # we are still syncing
                tip_difference = latest_block_number - int(block_number)
                logger.debug(f"Blocks til tip: {tip_difference}")
        except TypeError:
            pass

    # try to sync inputs and outputs
    try:
        variant = data['variant']

        # if a rollback occurs we need to handle it somehow
        if variant == 'RollBack':
            # how do we handle it?
            logger.critical(f"ROLLBACK: {block_number}")

        # tx inputs
        if variant == 'TxInput':
            IOManager.handle_input(db, data, logger)

        # tx outputs
        if variant == 'TxOutput':
            IOManager.handle_output(db, config, data, logger)

    # not the right variant so pass it
    except Exception:
        pass

    # if we are here then everything in the webhook is good
    return 'Webhook Successful'


def run_oura():
    """
    Run the Oura daemon.
    """
    # need to set up the daemon file and db for this
    subprocess.run([bin_directory + '/oura', 'daemon', '--config', 'daemon.toml'])


def flask_process(start_event):
    """Start and wait for the flask app to begin.

    Args:
        start_event (Event): The event to wait to complete.
    """
    start_event.wait()  # Wait until the start event is set
    app.run(host='0.0.0.0', port=44203)


def start_processes():
    """
    Start the batcher processes as a multiprocessing event.
    """
    # start log
    # create the daemon toml file
    sync_status = db.status.read()
    # start log
    logger.info(f"Loading Block {sync_status['block_number']} @ Slot {sync_status['timestamp']} With Hash {sync_status['block_hash']}")

    # set the daemon magic based on the network config, preprod or mainnet only
    magic = "preprod" if "testnet-magic" in config["network"] else "mainnet"
    create_toml_file('daemon.toml', sync_status['timestamp'], sync_status['block_hash'], config['delay_depth'], magic=magic)

    # start the processes as events in order
    start_event = multiprocessing.Event()

    # start the webhook
    flask_proc = multiprocessing.Process(
        target=flask_process, args=(start_event,))
    flask_proc.start()

    # start oura daemon
    daemon_proc = multiprocessing.Process(target=run_oura)
    daemon_proc.start()

    # Set the start event to indicate that the Flask app is ready to run
    start_event.set()
    try:
        # Wait for both processes to complete
        flask_proc.join()
        daemon_proc.join()
    except KeyboardInterrupt:
        # Handle KeyboardInterrupt (CTRL+C)
        logger.critical("KeyboardInterrupt detected, terminating processes...")
        # clean up the db
        db.cleanup()
        # terminate and join
        flask_proc.terminate()
        daemon_proc.terminate()
        flask_proc.join()
        daemon_proc.join()


if __name__ == '__main__':
    start_processes()
