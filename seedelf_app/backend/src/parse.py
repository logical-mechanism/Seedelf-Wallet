from src.value import Value


def asset_list_to_value(assets: list) -> Value:
    """
    Convert the Oura asset list inside a tx output into a value dictionary.

    Args:
        assets (list): The oura list of assets from a tx_output variant

    Returns:
        Value: A value dictionary of the assets.
    """
    values = {}
    for asset in assets:
        values[asset['policy']] = {}
        values[asset['policy']][asset['asset']] = asset['amount']
    return Value(values)
