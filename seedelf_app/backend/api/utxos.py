from flask import Blueprint, current_app, jsonify, request

# Define a Blueprint for UTxO routes
utxos_bp = Blueprint('utxos', __name__)


@utxos_bp.route('/getSeedelfs', methods=['GET'])
def get_seedelfs():
    """do a readall on the seedelf db"""
    db = current_app.db_manager  # Access DbManager instance from app context
    return jsonify({
        'seedelfs': db.seedelf.read_all()
    }), 200


@utxos_bp.route('/getUTxOs', methods=['POST'])
def get_utxos():
    """Fetch UTxOs with a token passed in the request body."""
    # Access the 'tkn' variable from the JSON request body
    data = request.get_json()
    tkn = data.get('tkn')  # Extract 'tkn' from the JSON body

    if not tkn:
        return "Token is required", 400

    # Use 'tkn' to query the database or perform other logic
    # Example response (replace with actual database logic)
    return f"Received token: {tkn}", 200
