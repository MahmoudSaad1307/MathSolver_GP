import sys
from pathlib import Path

# Add mathcheck folder to sys.path so test discovery works seamlessly from root
MATHCHECK_DIR = Path(__file__).resolve().parent / "mathcheck"
if str(MATHCHECK_DIR) not in sys.path:
    sys.path.insert(0, str(MATHCHECK_DIR))
