import sys
from pathlib import Path

# Ensure mathcheck root is on sys.path
MATHCHECK_DIR = Path(__file__).resolve().parent.parent
if str(MATHCHECK_DIR) not in sys.path:
    sys.path.insert(0, str(MATHCHECK_DIR))
