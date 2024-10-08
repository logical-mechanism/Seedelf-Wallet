def combine(dicts):
    result = {}

    for sub_dict in dicts.values():  # Iterate over the values in the main dictionary
        for key, value in sub_dict.items():
            if isinstance(value, dict):
                if key not in result:
                    result[key] = {}
                for inner_key, inner_value in value.items():
                    if inner_key not in result[key]:
                        result[key][inner_key] = 0
                    result[key][inner_key] += inner_value
            else:
                if key not in result:
                    result[key] = 0
                result[key] += value
    return result


if __name__ == "__main__":
    # Test the function with your dictionary
    x = {
        "a": {'lovelace': 123},
        "b": {'lovelace': 321, 'pid1': {'tkn1': 321}},
        "c": {'lovelace': 21, 'pid1': {'tkn2': 321}},
        "d": {'lovelace': 12, 'pid2': {'tkn1': 321}}
    }

    result = combine(x)
    print(result)
