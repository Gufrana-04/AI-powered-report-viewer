from rapidfuzz import fuzz
import re


# Canonical field mappings
FIELD_SYNONYMS = {
    "module": [
        "modul",
        "module",
        "division"
    ],

    "report_name": [
        "i",
        "report",
        "report name",
        "name",
        "title"
    ],

    "report_path": [
        "ii",
        "path",
        "location",
        "output ref",
        "report path",
        "file path"
    ],

    "description": [
        "ii descr",
        "description",
        "desc",
        "details",
        "usage info"
    ],

    "menu": [
        "iii",
        "menu",
        "navigation"
    ],

    "menu_description": [
        "iii descr",
        "menu descr",
        "menu description"
    ],

    "submenu": [
        "sub menu",
        "submenu",
        "iv"
    ],

    "submenu_description": [
        "sub menu descr",
        "submenu descr",
        "iv descr"
    ],

    "status": [
        "status",
        "state"
    ],

    "remark": [
        "remark",
        "remarks",
        "comment"
    ]
}


def clean_text(text):
    """
    Normalize text for matching
    """

    text = str(text).strip().lower()

    text = re.sub(r'[^a-z0-9 ]', '', text)

    return text


def detect_header_row(df):
    """
    Detects most probable header row dynamically
    """

    best_score = -1
    best_index = 0

    for idx in range(min(10, len(df))):

        row = df.iloc[idx].fillna("").tolist()

        score = 0

        unique_values = len(set(row))
        non_empty = sum(1 for cell in row if str(cell).strip())

        # More unique values = likely header
        score += unique_values

        # More filled cells = likely header
        score += non_empty

        row_text = " ".join([clean_text(cell) for cell in row])

        # Known keyword bonus
        keywords = [
            "modul",
            "status",
            "descr",
            "menu",
            "sub menu",
            "path"
        ]

        for keyword in keywords:
            if keyword in row_text:
                score += 5

        if score > best_score:
            best_score = score
            best_index = idx

    return best_index


def normalize_headers(headers):
    """
    Creates normalized header map
    """

    normalized = {}

    for header in headers:

        cleaned = clean_text(header)

        best_match = None
        best_score = 0

        for canonical, synonyms in FIELD_SYNONYMS.items():

            for synonym in synonyms:

                similarity = fuzz.ratio(cleaned, synonym)

                if similarity > best_score:
                    best_score = similarity
                    best_match = canonical

        if best_score >= 70:
            normalized[header] = best_match

        else:
            normalized[header] = cleaned

    return normalized


def detect_report_path(value):
    """
    Detects whether value looks like report path
    """

    if not value:
        return False

    value = str(value).lower()

    patterns = [
        r"/",
        r"\\\\",
        r"\.rdl",
        r"\.pbix",
        r"\.xlsx",
        r"\.csv",
        r"https?://"
    ]

    for pattern in patterns:
        if re.search(pattern, value):
            return True

    return False


def create_normalized_row(raw_row):
    """
    Build hierarchy dynamically from row sequence
    """

    values = list(raw_row.values())

    # Remove empty values
    cleaned_values = []

    for value in values:

        value = str(value).strip()

        if value and value.lower() != "nan":
            cleaned_values.append(value)

    # Remove status-like endings
    hierarchy = []

    status = ""
    remark = ""

    STATUS_KEYWORDS = [
        "not in report",
        "active",
        "inactive",
        "migrated",
        "not migrate in vision",
        "ok"
    ]

    # Matches single letters or short codes like A, B, U, D, H, A1, B2, etc.
    NAV_CODE_PATTERN = re.compile(r'^[a-zA-Z]{1,2}[0-9]{0,2}$')

    for value in cleaned_values:

        lower = value.lower().strip()

        if any(lower == keyword or lower.startswith(keyword) for keyword in STATUS_KEYWORDS):
            if not status:
                status = value
            else:
                remark += " " + value

        elif NAV_CODE_PATTERN.match(value.strip()):
            # Skip single-letter navigation codes silently
            continue

        else:
            hierarchy.append(value)

    # Build hierarchy path
    report_path = "/".join(hierarchy)

    # Last meaningful node = report name
    report_name = hierarchy[-1] if hierarchy else ""

    # Extract module/menu/submenu roughly
    module = hierarchy[0] if len(hierarchy) > 0 else ""
    menu = hierarchy[1] if len(hierarchy) > 1 else ""
    submenu = hierarchy[-2] if len(hierarchy) > 2 else ""

    return {
        "module": module,
        "menu": menu,
        "submenu": submenu,
        "report_name": report_name,
        "report_path": report_path,
        "description": "",
        "status": status,
        "remark": remark.strip()
    }