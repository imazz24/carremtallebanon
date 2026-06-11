"""OpenAPI 3.0 spec for the external (API-key) surface of the Car Rental API.

Hand-written and kept in sync with the batch + report endpoints in app.py.
Served as JSON at /api/openapi.json and rendered with Swagger UI at /api/docs
so an external company can read the contract and "Try it out" with their key.

Only the endpoints an outside integration actually calls are described here —
the in-browser dashboard endpoints (which authenticate with a same-origin
X-Auth-User header, not a secret) are intentionally left out.
"""

# ---- Reusable request examples -------------------------------------------
_CAR_EXAMPLE = {
    "vin": "1HGCM82633A004352",
    "type": "Coupe",
    "model": "Honda Accord",
    "color": "White",
    "platenumber": "M 12345",
    "has_gps": True,
}
_CLIENT_EXAMPLE = {
    "licenseid": "L-0001",
    "id_type": "license",
    "name": "Sami Khoury",
    "phonenumber": "+9613000000",
    "dateofbirth": "1990-01-31",
}
_BRANCH_EXAMPLE = {
    "branchname": "Hamra",
    "location": "Beirut",
    "phonenumber": "+9611000000",
}


def _batch_endpoint(tag, key, item_schema, item_example, summary, success_desc):
    """Build a POST path object for a single-entity batch endpoint. Each accepts
    EITHER a JSON body (bare array or {key: [...]}) OR a multipart .json file."""
    return {
        "post": {
            "tags": [tag],
            "summary": summary,
            "description": (
                f"Bulk-add **{key}** (up to 500 per request). All-or-nothing: "
                "if any row fails validation, nothing is saved and the rejected "
                "rows are returned with the reason. Send a JSON body **or** "
                "upload a `.json` file in the `file` form field."
            ),
            "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
            "requestBody": {
                "required": True,
                "content": {
                    "application/json": {
                        "schema": {
                            "oneOf": [
                                {"type": "array", "items": item_schema},
                                {"type": "object",
                                 "properties": {key: {"type": "array", "items": item_schema}}},
                            ]
                        },
                        "example": {key: [item_example]},
                    },
                    "multipart/form-data": {
                        "schema": {
                            "type": "object",
                            "properties": {
                                "file": {"type": "string", "format": "binary",
                                         "description": "A .json file containing the array."}
                            },
                            "required": ["file"],
                        }
                    },
                },
            },
            "responses": {
                "201": {"description": success_desc,
                        "content": {"application/json": {"schema": {"$ref": "#/components/schemas/BatchSuccess"}}}},
                "400": {"$ref": "#/components/responses/BatchRejected"},
                "401": {"$ref": "#/components/responses/Unauthorized"},
                "403": {"$ref": "#/components/responses/Forbidden"},
                "409": {"$ref": "#/components/responses/Conflict"},
            },
        }
    }


def build_spec():
    """Return the full OpenAPI document as a plain dict (jsonify-able)."""
    car_schema    = {"$ref": "#/components/schemas/Car"}
    client_schema = {"$ref": "#/components/schemas/Client"}
    branch_schema = {"$ref": "#/components/schemas/Branch"}

    return {
        "openapi": "3.0.3",
        "info": {
            "title": "Car Rental — External Integration API",
            "version": "1.0.0",
            "description": (
                "Push your fleet **cars, clients and branches** into Car Rental, "
                "and pull **reservation & rental reports** back out — all with a "
                "single secret API key.\n\n"
                "## Getting your key\n"
                "1. Sign in to the dashboard with your company account.\n"
                "2. Open the **🔑 Generate Secret Key** tab in the sidebar.\n"
                "3. Click **Generate Secret Key** and copy it — it is shown only "
                "once. (You must have added at least one car, client, or branch "
                "first.)\n\n"
                "## Authenticating\n"
                "Send the key on every request as `Authorization: Bearer <key>` "
                "(or `X-API-Key: <key>`). Click **Authorize** below, paste your "
                "key, and you can **Try it out** on any endpoint.\n\n"
                "## Rules\n"
                "* Everything you send is filed under **your** company "
                "automatically — never send a company id.\n"
                "* Up to **500 records** per request.\n"
                "* **All-or-nothing:** one bad row rejects the whole request and "
                "tells you exactly which rows to fix; nothing is saved."
            ),
        },
        "servers": [{"url": "/", "description": "This server"}],
        "tags": [
            {"name": "Import", "description": "Push cars / clients / branches in."},
            {"name": "Reports", "description": "Read your reservations & rentals."},
            {"name": "API key", "description": "Inspect or rotate your key."},
        ],
        "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
        "paths": {
            "/api/cars/batch": _batch_endpoint(
                "Import", "cars", car_schema, _CAR_EXAMPLE,
                "Add cars in bulk", "Cars inserted."),
            "/api/clients/batch": _batch_endpoint(
                "Import", "clients", client_schema, _CLIENT_EXAMPLE,
                "Add clients in bulk",
                "Clients inserted and/or linked to existing records."),
            "/api/branches/batch": _batch_endpoint(
                "Import", "branches", branch_schema, _BRANCH_EXAMPLE,
                "Add branches in bulk", "Branches inserted."),
            "/api/batch": {
                "post": {
                    "tags": ["Import"],
                    "summary": "Add cars, clients and branches together",
                    "description": (
                        "One all-or-nothing request that imports any mix of cars, "
                        "clients and branches in a single transaction. Each array "
                        "is optional — include only what you have. The 500-row cap "
                        "applies to the combined total."
                    ),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "requestBody": {
                        "required": True,
                        "content": {
                            "application/json": {
                                "schema": {"$ref": "#/components/schemas/UnifiedBatchBody"},
                                "example": {
                                    "cars": [_CAR_EXAMPLE],
                                    "clients": [_CLIENT_EXAMPLE],
                                    "branches": [_BRANCH_EXAMPLE],
                                },
                            },
                            "multipart/form-data": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "file": {"type": "string", "format": "binary",
                                                 "description": "A .json file with cars/clients/branches arrays."}
                                    },
                                    "required": ["file"],
                                }
                            },
                        },
                    },
                    "responses": {
                        "201": {"description": "All sections committed.",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/UnifiedBatchSuccess"}}}},
                        "400": {"$ref": "#/components/responses/UnifiedRejected"},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/Forbidden"},
                        "409": {"$ref": "#/components/responses/Conflict"},
                    },
                }
            },
            "/api/reports/reservations": {
                "get": {
                    "tags": ["Reports"],
                    "summary": "Reservation report",
                    "description": ("Every reservation for your company, with the "
                                    "client, car, dates and status. Returns 403 "
                                    "until your company has data in the system."),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "responses": {
                        "200": {"description": "List of reservations.",
                                "content": {"application/json": {"schema": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/Reservation"}}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/Forbidden"},
                    },
                }
            },
            "/api/reports/rentals": {
                "get": {
                    "tags": ["Reports"],
                    "summary": "Rental report",
                    "description": ("Every rental for your company. Returns 403 "
                                    "until your company has data."),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "parameters": [{
                        "name": "client_id", "in": "query", "required": False,
                        "schema": {"type": "integer"},
                        "description": "Filter to a single client.",
                    }],
                    "responses": {
                        "200": {"description": "List of rentals.",
                                "content": {"application/json": {"schema": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/Rental"}}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/Forbidden"},
                    },
                }
            },
            "/api/api-key": {
                "get": {
                    "tags": ["API key"],
                    "summary": "Show key status",
                    "description": "Whether a key is active (prefix + created date only — never the secret).",
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "responses": {
                        "200": {"description": "Key status.",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/KeyStatus"}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
                "post": {
                    "tags": ["API key"],
                    "summary": "Generate / rotate your key",
                    "description": ("Returns a brand-new key **once** and "
                                    "immediately invalidates the previous one. "
                                    "Your company must have data first."),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "responses": {
                        "201": {"description": "New key (store it now).",
                                "content": {"application/json": {"schema": {"$ref": "#/components/schemas/NewKey"}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/Forbidden"},
                    },
                },
                "delete": {
                    "tags": ["API key"],
                    "summary": "Revoke your key",
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "responses": {
                        "204": {"description": "Key revoked."},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                    },
                },
            },
        },
        "components": {
            "securitySchemes": {
                "bearerAuth": {"type": "http", "scheme": "bearer",
                               "description": "Paste your key (without the word 'Bearer')."},
                "apiKeyAuth": {"type": "apiKey", "in": "header", "name": "X-API-Key"},
            },
            "schemas": {
                "Car": {
                    "type": "object",
                    "required": ["vin", "type", "model", "color"],
                    "properties": {
                        "vin": {"type": "string", "description": "17 chars, A–Z/0–9, no I/O/Q; valid check digit; unique.", "example": "1HGCM82633A004352"},
                        "type": {"type": "string", "example": "Coupe", "description": "Body type — must match the VIN's NHTSA decode."},
                        "model": {"type": "string", "example": "Honda Accord"},
                        "color": {"type": "string", "example": "White", "description": "One of the allowed colours (White, Black, Silver, …)."},
                        "platenumber": {"type": "string", "example": "M 12345", "description": "\"<icon> <digits>\"; icon ∈ M B T G N Y Z O. Or send plate_icon + plate_number."},
                        "plate_icon": {"type": "string", "example": "M"},
                        "plate_number": {"type": "string", "example": "12345"},
                        "has_gps": {"type": "boolean", "default": False},
                    },
                    "example": _CAR_EXAMPLE,
                },
                "Client": {
                    "type": "object",
                    "required": ["licenseid"],
                    "properties": {
                        "licenseid": {"type": "string", "example": "L-0001", "description": "Driving-licence number (always required)."},
                        "id_type": {"type": "string", "enum": ["passport", "national_id", "license"], "example": "license"},
                        "personid": {"type": "string", "description": "Required when id_type is passport or national_id.", "example": "RL123456"},
                        "name": {"type": "string", "example": "Sami Khoury"},
                        "fathername": {"type": "string"},
                        "mothername": {"type": "string"},
                        "nationality": {"type": "string"},
                        "phonenumber": {"type": "string", "example": "+9613000000"},
                        "dateofbirth": {"type": "string", "format": "date", "example": "1990-01-31"},
                        "startdatelicense": {"type": "string", "format": "date"},
                        "enddatelicense": {"type": "string", "format": "date"},
                    },
                    "example": _CLIENT_EXAMPLE,
                },
                "Branch": {
                    "type": "object",
                    "required": ["branchname", "location"],
                    "properties": {
                        "branchname": {"type": "string", "example": "Hamra"},
                        "location": {"type": "string", "example": "Beirut"},
                        "phonenumber": {"type": "string", "example": "+9611000000"},
                        "x": {"type": "number", "description": "Longitude (optional)."},
                        "y": {"type": "number", "description": "Latitude (optional)."},
                    },
                    "example": _BRANCH_EXAMPLE,
                },
                "UnifiedBatchBody": {
                    "type": "object",
                    "properties": {
                        "cars": {"type": "array", "items": {"$ref": "#/components/schemas/Car"}},
                        "clients": {"type": "array", "items": {"$ref": "#/components/schemas/Client"}},
                        "branches": {"type": "array", "items": {"$ref": "#/components/schemas/Branch"}},
                    },
                },
                "BatchSuccess": {
                    "type": "object",
                    "properties": {
                        "inserted": {"type": "integer", "example": 1},
                        "failed": {"type": "array", "items": {}, "example": []},
                    },
                },
                "UnifiedBatchSuccess": {
                    "type": "object",
                    "properties": {
                        "cars": {"type": "object", "example": {"inserted": 1, "rows": []}},
                        "clients": {"type": "object", "example": {"inserted": 1, "linked": 0, "results": []}},
                        "branches": {"type": "object", "example": {"inserted": 1, "rows": []}},
                        "failed": {"type": "object", "example": {"cars": [], "clients": [], "branches": []}},
                    },
                },
                "RowError": {
                    "type": "object",
                    "properties": {
                        "index": {"type": "integer", "description": "0-based position of the bad row.", "example": 2},
                        "errors": {"type": "object", "additionalProperties": {"type": "string"},
                                   "example": {"vin": "VIN '…' has an invalid check digit (typo?)"}},
                    },
                },
                "Reservation": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "integer"},
                        "car_vin": {"type": "string"},
                        "client_id": {"type": "integer"},
                        "start_date": {"type": "string", "format": "date"},
                        "end_date": {"type": "string", "format": "date"},
                        "status": {"type": "string"},
                        "created_at": {"type": "string", "format": "date-time"},
                        "client_name": {"type": "string"},
                        "client_phone": {"type": "string"},
                        "car_model": {"type": "string"},
                        "car_plate": {"type": "string"},
                    },
                },
                "Rental": {
                    "type": "object",
                    "description": "A row from the rental report view (client + car + dates).",
                    "properties": {
                        "client_id": {"type": "integer"},
                        "client_name": {"type": "string"},
                        "car_vin": {"type": "string"},
                        "start_date": {"type": "string", "format": "date"},
                        "end_date": {"type": "string", "format": "date"},
                    },
                },
                "KeyStatus": {
                    "type": "object",
                    "properties": {
                        "has_key": {"type": "boolean", "example": True},
                        "prefix": {"type": "string", "example": "crk_AbC123"},
                        "created_at": {"type": "string", "format": "date-time"},
                    },
                },
                "NewKey": {
                    "type": "object",
                    "properties": {
                        "api_key": {"type": "string", "example": "crk_AbC123…"},
                        "prefix": {"type": "string", "example": "crk_AbC123"},
                        "note": {"type": "string"},
                    },
                },
                "Error": {
                    "type": "object",
                    "properties": {"error": {"type": "string"}},
                },
            },
            "responses": {
                "Unauthorized": {"description": "Missing or invalid API key.",
                                 "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"},
                                                                  "example": {"error": "Not authenticated"}}}},
                "Forbidden": {"description": "Not allowed (e.g. an admin key, or company has no data yet).",
                              "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                "Conflict": {"description": "A database conflict (e.g. a duplicate VIN/plate). Nothing saved.",
                             "content": {"application/json": {"schema": {"$ref": "#/components/schemas/Error"}}}},
                "BatchRejected": {
                    "description": "One or more rows are invalid — nothing was saved.",
                    "content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "error": {"type": "string"},
                            "inserted": {"type": "integer", "example": 0},
                            "failed": {"type": "array", "items": {"$ref": "#/components/schemas/RowError"}},
                        },
                    }}},
                },
                "UnifiedRejected": {
                    "description": "One or more rows invalid in any section — nothing saved.",
                    "content": {"application/json": {"schema": {
                        "type": "object",
                        "properties": {
                            "error": {"type": "string"},
                            "failed": {"type": "object", "properties": {
                                "cars": {"type": "array", "items": {"$ref": "#/components/schemas/RowError"}},
                                "clients": {"type": "array", "items": {"$ref": "#/components/schemas/RowError"}},
                                "branches": {"type": "array", "items": {"$ref": "#/components/schemas/RowError"}},
                            }},
                        },
                    }}},
                },
            },
        },
    }


# Swagger UI page. Assets are SELF-HOSTED (vendored under
# frontend/vendor/swagger-ui/) — no third-party CDN at view time, so the page
# works offline / behind strict firewalls and can run under a tight CSP. The
# initializer is an external file too, so /api/docs carries NO inline script and
# we can serve it with `script-src 'self'`. persistAuthorization keeps the key
# across "Try it out" calls.
SWAGGER_HTML = """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Car Rental API — Reference</title>
  <link rel="stylesheet" href="/vendor/swagger-ui/swagger-ui.css">
  <style>body{margin:0;background:#fafafa}.topbar{display:none}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/vendor/swagger-ui/swagger-ui-bundle.js"></script>
  <script src="/vendor/swagger-ui/swagger-initializer.js"></script>
</body>
</html>"""
