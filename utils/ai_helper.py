import google.generativeai as genai
import json
import os
#GOOGLE AI STUDIO KEY FOR API KEY
genai.configure(api_key=os.environ.get("API-KEY-MODEL", "YOUR-KEY"))

model = genai.GenerativeModel("gemini-2.0-flash")


def analyze_row_with_ai(raw_row: dict) -> dict:
    """
    Uses Google Gemini to semantically identify module, menu, submenu,
    report_name, report_path, status, and remark from a raw row.
    """

    # Build clean non-empty values list in order
    ordered_values = [
        str(v).strip()
        for v in raw_row.values()
        if str(v).strip().lower() not in ("", "nan")
    ]

    row_text = "\n".join(
        f"  {k}: {v}"
        for k, v in raw_row.items()
        if str(v).strip().lower() not in ("", "nan")
    )

    prompt = f"""You are a data parser for a software report mapping spreadsheet.
Each row represents a report in a hierarchical navigation system.

The cells in the row form a navigation path like:
  Module → Menu → (codes/IDs) → SubMenu → (codes/IDs) → Report Name → Status

STRICT RULES you must follow:
1. "OK", "Active", "Inactive", "Not in Report", "Migrated", "Not migrate in vision" are ALWAYS status values — never put them in report_name, submenu, or any other field
2. Single uppercase letters or short codes like "A", "B", "U", "D", "H", "A1", "B2" are navigation codes — ignore them, do NOT use them as module/menu/submenu/report_name
3. The report_name is ALWAYS the last meaningful descriptive label before a status word
4. Words like "Detail", "Summary", "Register" alone are NOT report names — they are qualifiers. The report name includes them combined with the surrounding label (e.g. "Locationwise Sales Register" not just "Register")
5. Ignore all "nan" values completely
6. submenu should be the section just above the report_name (not a code)

EXAMPLE:
Raw row: SCM | Inquiry | A1 | Swara Reports | D | Sales Reports | nan | nan | nan | nan | Detail | Locationwise Sales Register | OK | nan
Correct output:
{{
  "module": "SCM",
  "menu": "Inquiry",
  "submenu": "Sales Reports",
  "report_name": "Locationwise Sales Register",
  "report_path": "SCM / Inquiry / Swara Reports / Sales Reports / Locationwise Sales Register",
  "status": "OK",
  "remark": ""
}}

Now parse this row:
{row_text}

Ordered non-empty values for reference: {ordered_values}

Respond ONLY with a valid JSON object, absolutely no explanation or markdown:
{{
  "module": "...",
  "menu": "...",
  "submenu": "...",
  "report_name": "...",
  "report_path": "...",
  "status": "...",
  "remark": "..."
}}"""

    response = model.generate_content(prompt)
    response_text = response.text.strip()

    # Strip markdown fences if present
    if response_text.startswith("```"):
        parts = response_text.split("```")
        response_text = parts[1]
        if response_text.startswith("json"):
            response_text = response_text[4:]
        response_text = response_text.strip()

    parsed = json.loads(response_text)

    # Post-process: forcefully move status words out of report_name
    STATUS_KEYWORDS = ["ok", "active", "inactive", "not in report", "migrated", "not migrate in vision"]

    if parsed.get("report_name", "").strip().lower() in STATUS_KEYWORDS:
        if not parsed.get("status"):
            parsed["status"] = parsed["report_name"]
        parsed["report_name"] = ""

        # Try to recover report_name from ordered_values
        for val in reversed(ordered_values):
            if val.strip().lower() not in STATUS_KEYWORDS and len(val.strip()) > 2:
                parsed["report_name"] = val.strip()
                break

    # Ensure all expected keys exist
    expected_keys = ["module", "menu", "submenu", "report_name", "report_path", "status", "remark"]
    for key in expected_keys:
        if key not in parsed:
            parsed[key] = ""

    return parsed
