import pandas as pd
import os
from utils.mapper import (
    detect_header_row,
    normalize_headers,
    create_normalized_row
)


def parse_file(filepath):
    """
    Main parser function
    Supports:
    - Excel (.xlsx, .xls)
    - CSV
    """

    extension = os.path.splitext(filepath)[1].lower()

    if extension in [".xlsx", ".xls"]:
        df = pd.read_excel(filepath, header=None)

    elif extension == ".csv":
        df = pd.read_csv(filepath, header=None)

    else:
        raise Exception("Unsupported file format")

    # Detect actual header row dynamically
    header_row_index = detect_header_row(df)

    # Extract headers
    raw_headers = [
    str(col).strip()
    for col in df.iloc[header_row_index].fillna("").tolist()
]

    # Normalize headers
    normalized_headers = normalize_headers(raw_headers)

    # Actual data starts after header row
    data_df = df.iloc[header_row_index + 1:].reset_index(drop=True)

    # Assign raw headers
    data_df.columns = [str(col).strip() for col in raw_headers]

    parsed_rows = []

    for _, row in data_df.iterrows():

        raw_row = {}

        for col in data_df.columns:
            raw_row[str(col)] = str(row[col]).strip()

        normalized_row = create_normalized_row(raw_row)

        parsed_rows.append({
            "headers":raw_headers,
            "raw": raw_row,
            "normalized": normalized_row
        })

    return parsed_rows