"""Ensure the service modules are importable when running `pytest` directly
(without `python -m`). Adds this directory to sys.path."""
import os
import sys

sys.path.insert(0, os.path.dirname(__file__))
