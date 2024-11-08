import os

api_path = os.path.dirname(os.path.abspath(__file__))
backend_directory = os.path.dirname(api_path)
config_path = os.path.join(backend_directory, 'config.yaml')
database_path = os.path.join(backend_directory, 'db.sqlite3')
