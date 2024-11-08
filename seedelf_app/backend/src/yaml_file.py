import yaml


def read(file_name: str) -> dict:
    """Read a YAML file and return its contents as a Python dictionary.

    Args:
        file_name (str): The path to the YAML file.

    Returns:
        dict: The data from the YAML file.
    """
    with open(file_name, 'r') as f:
        data = yaml.safe_load(f)
    return data
