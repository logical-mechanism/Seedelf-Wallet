from api.pathing import config_path, database_path
from flask import Blueprint, jsonify
from src.db_manager import DbManager
from src.koios import get_latest_block_number
from src.yaml_file import read

# Define a Blueprint for UTxO routes
sync_bp = Blueprint('sync', __name__)


@sync_bp.route('/sync_status', methods=['GET'])
def sync_status():
    config = read(config_path)
    db = DbManager(database_path)
    db.initialize(config)
    # the latest block at start time
    latest_block_number = get_latest_block_number(config['network'])
    # Get the current status
    sync_status = db.status.read()

    # What the db thinks is the current block is
    db_number = sync_status["block_number"]

    difference = latest_block_number - config['starting_block_number']
    behind = latest_block_number - db_number - config['delay_depth']
    sync_perc = (difference - behind) / difference

    # Return the integer inside a dictionary
    return jsonify({
        'sync_perc': f"{100*sync_perc:.2f}",
        'blocks_behind': latest_block_number - db_number - config['delay_depth']
    }), 200
