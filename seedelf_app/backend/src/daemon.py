import toml


def create_toml_file(filename: str, timestamp: int, block_hash: str, delay: int, magic: str) -> None:
    """
    Creates a TOML file with the provided configuration settings.

    Args:
        filename (str): The name of the file to create.
        node_socket (str): The path to the node socket.
        timestamp (int): The timestamp to use for the intersect point.
        block_hash (str): The block hash to use for the intersect point.
        delay (int, optional): The minimum depth delay. Default is 3.
        magic (str, optional): The magic string for the network. Default is "preprod".

    Returns:
        None
    """
    data = {
        "source": {
            "type": "N2N",
            "address": ["Tcp", "preprod-node.play.dev.cardano.org:3001"],
            "magic": magic,
            "min_depth": delay,
            "intersect": {
                "type": "Point",
                "value": [timestamp, block_hash]
            },
            "mapper": {
                "include_block_end_events": True,
                "include_transaction_details": True
            },
        },
        "sink": {
            "type": "Webhook",
            "url": "http://localhost:44203/webhook",
            "timeout": 60000,
            "error_policy": "Continue",
            "retry_policy": {
                "max_retries": 60,
                "backoff_unit": 20000,
                "backoff_factor": 2,
                "max_backoff": 100000,
            },
        },
    }

    with open(filename, 'w') as file:
        toml.dump(data, file)
