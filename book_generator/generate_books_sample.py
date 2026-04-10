import sys
from pathlib import Path

import generate_books as base


PROJECT_ROOT = Path(__file__).resolve().parent.parent
SAMPLE_COVER_PATH = PROJECT_ROOT / "SAMPLECOVER.pdf"
SAMPLE_INNER_PATH = PROJECT_ROOT / "SAMPLEINNER.pdf"

def resolve_sample_nonp_inner_source(_row):
    return SAMPLE_COVER_PATH

def resolve_sample_cover_source(_row):
    return SAMPLE_COVER_PATH


def resolve_sample_inner_source(_row):
    return SAMPLE_INNER_PATH


def resolve_sample_static_inner_source(_row):
    return SAMPLE_INNER_PATH


base.resolve_cover_source = resolve_sample_cover_source
base.resolve_inner_source = resolve_sample_inner_source
base.resolve_static_inner_source = resolve_sample_static_inner_source
base.resolve_nonp_inner_source = resolve_sample_nonp_inner_source


if __name__ == "__main__":
    sys.exit(base.main())
