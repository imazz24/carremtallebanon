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
_RENTAL_EXAMPLE = {
    "client_id": 101,
    "car_vin": "1HGCM82633A004352",
    "start_date": "2026-08-01",
    "end_date": "2026-08-07",
}
_RESERVATION_EXAMPLE = {
    "car_vin": "1HGCM82633A004352",
    "client_id": 101,
    "start_date": "2026-08-10",
    "end_date": "2026-08-14",
    "notes": "Airport pickup",
}
_COMPANY_RENTAL_EXAMPLE = {
    "company_name": "Cedar Fleet Co",
    "owner_name": "Rami Aoun",
    "location": "Tripoli",
    "phones": ["+9616000000"],
    "branches": ["Tripoli Center"],
    "car_vin": "1HGCM82633A004352",
    "start_date": "2026-09-01",
    "end_date": "2026-09-30",
    "notes": "Monthly corporate lease",
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
                "Push **everything** into Car Rental with a single secret API key — "
                "your fleet **cars, clients and branches**, plus the day-to-day "
                "records: **rentals to individuals, reservations, and B2B cars "
                "rented out to other companies** — and pull the matching "
                "**reports** back out.\n\n"
                "Every write endpoint is a **bulk / batch** import (up to 500 rows) "
                "and is safe to call **concurrently**: many companies — and many "
                "requests from the same company — can import at the same time. "
                "Bookings for the same car are serialised per-car so a car can "
                "never be double-booked, while different cars import fully in "
                "parallel.\n\n"
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
            {"name": "Import", "description": "Push cars, clients, branches, rentals, "
                                             "reservations & B2B company rentals in (bulk)."},
            {"name": "Reports", "description": "Read your cars, reservations, rentals & B2B rentals."},
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
            "/api/rentals/batch": _batch_endpoint(
                "Import", "rentals",
                {"$ref": "#/components/schemas/RentalInput"}, _RENTAL_EXAMPLE,
                "Rent cars to individuals in bulk",
                "Rentals recorded."),
            "/api/reservations/batch": _batch_endpoint(
                "Import", "reservations",
                {"$ref": "#/components/schemas/ReservationInput"}, _RESERVATION_EXAMPLE,
                "Reserve cars in bulk",
                "Reservations recorded."),
            "/api/company-rentals/batch": _batch_endpoint(
                "Import", "company_rentals",
                {"$ref": "#/components/schemas/CompanyRentalInput"}, _COMPANY_RENTAL_EXAMPLE,
                "Rent cars out to other companies (B2B) in bulk",
                "B2B rentals recorded."),
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
            "/api/reports/cars": {
                "get": {
                    "tags": ["Reports"],
                    "summary": "Fleet report",
                    "description": ("Every car in your fleet with the branch it "
                                    "currently belongs to (branch_id null = the "
                                    "head office, shown as \"Main\") and its last "
                                    "GPS point. Returns 403 until your company has "
                                    "data."),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "parameters": [{
                        "name": "branch_id", "in": "query", "required": False,
                        "schema": {"type": "string"},
                        "description": "Filter to one branch. Use 'main' or 0 for the head office.",
                    }],
                    "responses": {
                        "200": {"description": "List of cars with branch.",
                                "content": {"application/json": {"schema": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/CarReport"}}}}},
                        "401": {"$ref": "#/components/responses/Unauthorized"},
                        "403": {"$ref": "#/components/responses/Forbidden"},
                    },
                }
            },
            "/api/reports/company-rentals": {
                "get": {
                    "tags": ["Reports"],
                    "summary": "B2B rental report",
                    "description": ("Every car you've rented OUT to another company, "
                                    "with the car detail, the rental period, whether "
                                    "it's been returned and to which branch. Returns "
                                    "403 until your company has data."),
                    "security": [{"bearerAuth": []}, {"apiKeyAuth": []}],
                    "responses": {
                        "200": {"description": "List of B2B rentals.",
                                "content": {"application/json": {"schema": {
                                    "type": "array",
                                    "items": {"$ref": "#/components/schemas/CompanyRental"}}}}},
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
                "RentalInput": {
                    "type": "object",
                    "description": "Book one of your cars for one of your clients (a car rented to an individual).",
                    "required": ["client_id", "car_vin", "start_date", "end_date"],
                    "properties": {
                        "client_id": {"type": "integer", "example": 101,
                                      "description": "Id of a client already linked to your company."},
                        "car_vin": {"type": "string", "example": "1HGCM82633A004352",
                                    "description": "VIN of one of your active cars."},
                        "start_date": {"type": "string", "format": "date", "example": "2026-08-01"},
                        "end_date": {"type": "string", "format": "date", "example": "2026-08-07",
                                     "description": "On or after start_date. Must not overlap another booking of the same car."},
                        "status": {"type": "string", "enum": ["active", "pending", "cancelled"],
                                   "default": "active", "example": "active",
                                   "description": "Booking state. 'pending' = booked but not started "
                                                  "(what used to be a reservation), 'active' = out with "
                                                  "the renter, 'cancelled' = called off (frees the car). "
                                                  "Optional — defaults to 'active'."},
                        "notes": {"type": "string", "nullable": True, "example": "Airport pickup"},
                    },
                    "example": _RENTAL_EXAMPLE,
                },
                "ReservationInput": {
                    "type": "object",
                    "description": ("A future booking for one of your cars. Reservations are now simply "
                                    "rentals with status 'pending' — this endpoint is kept unchanged for "
                                    "compatibility and writes a pending rental."),
                    "required": ["car_vin", "client_id", "start_date", "end_date"],
                    "properties": {
                        "car_vin": {"type": "string", "example": "1HGCM82633A004352"},
                        "client_id": {"type": "integer", "example": 101,
                                      "description": "Id of a client already linked to your company."},
                        "start_date": {"type": "string", "format": "date", "example": "2026-08-10"},
                        "end_date": {"type": "string", "format": "date", "example": "2026-08-14",
                                     "description": "On or after start_date. Must not overlap another booking of the same car."},
                        "notes": {"type": "string", "nullable": True, "example": "Airport pickup"},
                    },
                    "example": _RESERVATION_EXAMPLE,
                },
                "CompanyRentalInput": {
                    "type": "object",
                    "description": "A car of yours rented OUT to another company (B2B).",
                    "required": ["company_name"],
                    "properties": {
                        "company_name": {"type": "string", "example": "Cedar Fleet Co",
                                         "description": "The company holding your car."},
                        "owner_name": {"type": "string", "example": "Rami Aoun"},
                        "location": {"type": "string", "example": "Tripoli"},
                        "x": {"type": "number", "description": "Longitude (optional)."},
                        "y": {"type": "number", "description": "Latitude (optional)."},
                        "phones": {"type": "array", "items": {"type": "string"},
                                   "description": "One or more phone numbers (array or comma-joined string).",
                                   "example": ["+9616000000"]},
                        "branches": {"type": "array", "items": {"type": "string"},
                                     "description": "One or more branch labels (array or comma-joined string).",
                                     "example": ["Tripoli Center"]},
                        "car_vin": {"type": "string", "example": "1HGCM82633A004352",
                                    "description": "VIN of one of your active cars (optional)."},
                        "start_date": {"type": "string", "format": "date", "example": "2026-09-01"},
                        "end_date": {"type": "string", "format": "date", "example": "2026-09-30"},
                        "status": {"type": "string", "enum": ["active", "pending", "cancelled"],
                                   "default": "active", "example": "active",
                                   "description": "Booking state. 'pending' = agreed but not started, "
                                                  "'active' = the company holds the car, 'cancelled' = "
                                                  "called off. Optional — defaults to 'active'."},
                        "notes": {"type": "string", "nullable": True},
                    },
                    "example": _COMPANY_RENTAL_EXAMPLE,
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
                        "status": {"type": "string", "enum": ["pending"], "example": "pending",
                                   "description": "Always 'pending' — this report lists bookings that "
                                                  "haven't started. The old reservation states are gone: "
                                                  "an activated booking is now a rental with status "
                                                  "'active', and 'inactive' is now 'cancelled'; neither "
                                                  "appears here. See GET /api/reports/rentals."},
                        "notes": {"type": "string", "nullable": True},
                        "created_at": {"type": "string", "format": "date-time"},
                        "client_name": {"type": "string"},
                        "client_phone": {"type": "string"},
                        "car_model": {"type": "string"},
                        "car_plate": {"type": "string"},
                        "car_branch_id": {"type": "integer", "nullable": True,
                                          "description": "Branch the car belongs to (null = head office)."},
                        "car_branch_name": {"type": "string", "example": "Main"},
                    },
                },
                "Rental": {
                    "type": "object",
                    "description": "A row from the rental report view (client + car + dates + branch).",
                    "properties": {
                        "client_id": {"type": "integer"},
                        "client_name": {"type": "string"},
                        "car_vin": {"type": "string"},
                        "car_model": {"type": "string"},
                        "car_plate": {"type": "string"},
                        "start_date": {"type": "string", "format": "date"},
                        "end_date": {"type": "string", "format": "date"},
                        "status": {"type": "string", "enum": ["active", "pending", "cancelled"],
                                   "example": "active",
                                   "description": "Booking state: 'pending' = booked but not started, "
                                                  "'active' = out with the renter, 'cancelled' = called "
                                                  "off (holds no car)."},
                        "car_branch_id": {"type": "integer", "nullable": True,
                                          "description": "Branch the car belongs to (null = head office)."},
                        "car_branch_name": {"type": "string", "example": "Main"},
                        "returned_at": {"type": "string", "format": "date-time", "nullable": True,
                                        "description": "When the car was handed back (null = still out)."},
                        "return_branch_id": {"type": "integer", "nullable": True,
                                             "description": "Branch it was returned to (null = not returned, or returned to head office)."},
                        "return_branch_name": {"type": "string", "nullable": True},
                    },
                },
                "CarReport": {
                    "type": "object",
                    "description": "A fleet car with the branch it belongs to.",
                    "properties": {
                        "vin": {"type": "string"},
                        "type": {"type": "string"},
                        "model": {"type": "string"},
                        "color": {"type": "string"},
                        "platenumber": {"type": "string"},
                        "has_gps": {"type": "boolean"},
                        "gps_lat": {"type": "number", "nullable": True},
                        "gps_lng": {"type": "number", "nullable": True},
                        "gps_updated_at": {"type": "string", "format": "date-time", "nullable": True},
                        "branch_id": {"type": "integer", "nullable": True,
                                      "description": "Branch the car belongs to (null = head office)."},
                        "branch_name": {"type": "string", "example": "Main"},
                        "branch_location": {"type": "string", "nullable": True},
                    },
                },
                "CompanyRental": {
                    "type": "object",
                    "description": "A car rented OUT to another company (B2B), with return status.",
                    "properties": {
                        "id": {"type": "integer"},
                        "company_name": {"type": "string", "description": "The company the car is rented to."},
                        "owner_name": {"type": "string", "nullable": True},
                        "car_vin": {"type": "string"},
                        "car_model": {"type": "string", "nullable": True},
                        "car_plate": {"type": "string", "nullable": True},
                        "car_branch_id": {"type": "integer", "nullable": True},
                        "car_branch_name": {"type": "string", "example": "Main"},
                        "start_date": {"type": "string", "format": "date"},
                        "end_date": {"type": "string", "format": "date"},
                        "returned_at": {"type": "string", "format": "date-time", "nullable": True,
                                        "description": "When the car came back (null = still out)."},
                        "return_branch_id": {"type": "integer", "nullable": True},
                        "return_branch_name": {"type": "string", "nullable": True},
                        "notes": {"type": "string", "nullable": True},
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
                "Conflict": {"description": "A conflict — a duplicate VIN/plate, or a car already "
                                            "booked for the requested dates. Nothing was saved; the "
                                            "clashing rows are listed under `failed`.",
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
