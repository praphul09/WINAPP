from flask import Flask, jsonify, request
import os
import sqlite3

app = Flask(__name__)

BASE_DIR = os.path.abspath(os.path.dirname(__file__))
PROJECT_DIR = os.path.abspath(os.path.join(BASE_DIR, ".."))
BATCH_ROOT_DIR = r"\\pixartnas\home\INTERNAL_PROCESSING\BATCHES"
REGISTRY_DB_PATH = os.path.join(BATCH_ROOT_DIR, "batch-registry.db")
BARCODE_LENGTH = 43


def get_registry_connection():
    connection = sqlite3.connect(REGISTRY_DB_PATH)
    connection.row_factory = sqlite3.Row
    ensure_status_table(connection)
    return connection


def get_batch_connection(db_path):
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    return connection


def ensure_status_table(connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS status (
            type TEXT NOT NULL,
            station INTEGER NOT NULL,
            status INTEGER NOT NULL,
            present_book_id INTEGER,
            message TEXT,
            expected_book_id INTEGER,
            override_allowed INTEGER NOT NULL DEFAULT 0,
            override_target_book_id INTEGER,
            sequence_start_book_id INTEGER
        )
        """
    )
    connection.commit()


def set_status(
    connection,
    scan_type,
    station,
    status_value,
    present_book_id,
    message,
    expected_book_id=None,
    override_allowed=0,
    override_target_book_id=None,
    sequence_start_book_id=None,
):
    connection.execute("DELETE FROM status WHERE type = ? AND station = ?", (scan_type, station))
    connection.execute(
        """
        INSERT INTO status (
            type, station, status, present_book_id, message,
            expected_book_id, override_allowed, override_target_book_id, sequence_start_book_id
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            scan_type,
            int(station),
            int(status_value),
            present_book_id,
            message,
            expected_book_id,
            int(override_allowed),
            override_target_book_id,
            sequence_start_book_id,
        ),
    )
    connection.commit()


def get_status_by_type(connection, scan_type, station):
    return connection.execute(
        """
        SELECT
            type,
            station,
            status,
            present_book_id,
            message,
            expected_book_id,
            override_allowed,
            override_target_book_id,
            sequence_start_book_id
        FROM status
        WHERE type = ? AND station = ?
        """,
        (scan_type, int(station)),
    ).fetchone()


def get_active_batch():
    if not os.path.exists(REGISTRY_DB_PATH):
        raise FileNotFoundError(f"Batch registry not found at {REGISTRY_DB_PATH}")

    with get_registry_connection() as connection:
        row = connection.execute(
            """
            SELECT id, batch_name, db_path, status, active
            FROM batches
            WHERE active = 1
            LIMIT 1
            """
        ).fetchone()

    if row is None:
        raise RuntimeError("No active batch found.")
    if row["status"] != "processing":
        raise RuntimeError("Active batch is not in processing state.")
    if not row["db_path"] or not os.path.exists(row["db_path"]):
        raise FileNotFoundError("Active batch database not found.")

    return row


def get_books_by_batch(connection):
    return connection.execute(
        """
        SELECT rowid, school_id, student_id, book_id, name, innercode, outercode,
               lamination_status, composing_status, sorting_status
        FROM school_student_books
        ORDER BY CAST(book_id AS INTEGER) ASC
        """
    ).fetchall()


def get_books_for_student(connection, school_id, student_id):
    return connection.execute(
        """
        SELECT rowid, school_id, student_id, book_id, name, innercode, outercode,
               lamination_status, composing_status, sorting_status
        FROM school_student_books
        WHERE school_id = ? AND student_id = ?
        ORDER BY CAST(book_id AS INTEGER) ASC
        """,
        (str(school_id), str(student_id)),
    ).fetchall()


def get_book_by_id(connection, book_id):
    return connection.execute(
        """
        SELECT rowid, school_id, student_id, book_id, name, innercode, outercode,
               lamination_status, composing_status, sorting_status
        FROM school_student_books
        WHERE CAST(book_id AS INTEGER) = ?
        """,
        (int(book_id),),
    ).fetchone()


def parse_book_barcode(barcode):
    barcode_value = str(barcode or "").strip()
    if len(barcode_value) != BARCODE_LENGTH or not barcode_value.isdigit():
        raise ValueError("Wrong read")

    student_prefix = barcode_value[4:6]
    innercode = barcode_value[6:15]
    school_id = int(barcode_value[15:20])
    student_suffix = barcode_value[20:23]
    batch_id = int(barcode_value[23:26])
    book_id = int(barcode_value[26:31])
    layer_type = int(barcode_value[31:33])
    assigned_number = int(barcode_value[33:38])

    return {
        "raw": barcode_value,
        "version": barcode_value[0:2],
        "is_cover": barcode_value[2] == "1",
        "per_digit": int(barcode_value[3]),
        "student_id": int(f"{student_prefix}{student_suffix}"),
        "innercode": innercode,
        "school_id": school_id,
        "batch_id": batch_id,
        "book_id": book_id,
        "layer_type": layer_type,
        "assigned_number": assigned_number,
    }


def json_response(
    payload,
    http_code,
    connection=None,
    scan_type=None,
    station=None,
    status_value=None,
    present_book_id=None,
    expected_book_id=None,
    override_allowed=0,
    override_target_book_id=None,
    sequence_start_book_id=None,
):
    if connection is not None and scan_type is not None and station is not None and status_value is not None:
        set_status(
            connection,
            scan_type,
            station,
            status_value,
            present_book_id,
            payload.get("message"),
            expected_book_id=expected_book_id,
            override_allowed=override_allowed,
            override_target_book_id=override_target_book_id,
            sequence_start_book_id=sequence_start_book_id,
        )
    return jsonify(payload), http_code


def get_lamination_sequence_start(status_row):
    if status_row is None:
        return 1
    value = status_row["sequence_start_book_id"]
    return int(value) if value is not None else 1


def get_expected_lamination_book(books, sequence_start_book_id):
    for book in books:
        book_id = int(book["book_id"])
        if book_id < int(sequence_start_book_id):
            continue
        if int(book["lamination_status"] or 0) == 0:
            return book_id
    return None


def mark_book_laminated(connection, book_id):
    connection.execute(
        """
        UPDATE school_student_books
        SET lamination_status = 1
        WHERE CAST(book_id AS INTEGER) = ?
        """,
        (int(book_id),),
    )
    connection.commit()


@app.route("/status", methods=["GET"])
def get_status():
    scan_type = str(request.args.get("type") or "").strip()
    station = request.args.get("station")
    if not scan_type:
        return jsonify({"status": "failure", "message": "Query param 'type' is required."}), 400
    if station is None:
        return jsonify({"status": "failure", "message": "Query param 'station' is required."}), 400

    try:
        with get_registry_connection() as connection:
            row = get_status_by_type(connection, scan_type, int(station))

        return (
            jsonify(
                {
                    "status": "success",
                    "type": scan_type,
                    "station": int(station),
                    "data": None
                    if row is None
                    else {
                        "type": row["type"],
                        "station": int(row["station"]),
                        "status_value": int(row["status"]),
                        "present_book_id": row["present_book_id"],
                        "message": row["message"],
                        "expected_book_id": row["expected_book_id"],
                        "override_allowed": int(row["override_allowed"]),
                        "override_target_book_id": row["override_target_book_id"],
                        "sequence_start_book_id": row["sequence_start_book_id"],
                    },
                }
            ),
            200,
        )
    except Exception as error:
        return jsonify({"status": "failure", "message": str(error)}), 500


@app.route("/lamination/override", methods=["POST"])
def override_lamination_sequence():
    content = request.get_json(silent=True) or {}
    station_value = content.get("station")
    if station_value is None:
        return jsonify({"status": "failure", "message": "Field 'station' is required."}), 400

    station = int(station_value)
    requested_book_id = content.get("book_id")

    try:
        active_batch = get_active_batch()
        with get_registry_connection() as registry_connection, get_batch_connection(active_batch["db_path"]) as connection:
            status_row = get_status_by_type(registry_connection, "lamination", station)
            if status_row is None or int(status_row["override_allowed"] or 0) != 1:
                return jsonify({"status": "failure", "message": "No lamination override is pending for this station."}), 409

            target_book_id = int(requested_book_id or status_row["override_target_book_id"] or 0)
            if target_book_id <= 0:
                return jsonify({"status": "failure", "message": "No override target book is available."}), 400

            book = get_book_by_id(connection, target_book_id)
            if book is None:
                return jsonify({"status": "failure", "message": f"Book {target_book_id} not found in active batch."}), 404

            if int(book["lamination_status"] or 0) == 0:
                mark_book_laminated(connection, target_book_id)

            next_expected = get_expected_lamination_book(
                get_books_by_batch(connection),
                target_book_id,
            )

            return json_response(
                {
                    "status": "success",
                    "message": f"Lamination sequence continued from book {target_book_id}",
                    "present_book_id": target_book_id,
                    "expected_book_id": next_expected,
                },
                200,
                registry_connection,
                "lamination",
                station,
                1,
                target_book_id,
                expected_book_id=next_expected,
                override_allowed=0,
                override_target_book_id=None,
                sequence_start_book_id=target_book_id,
            )
    except Exception as error:
        return jsonify({"status": "failure", "message": str(error)}), 500


@app.route("/barcode", methods=["POST"])
def receive_data():
    content = request.get_json(silent=True) or {}
    scan_type = str(content.get("type") or "").strip()
    station_value = content.get("station")
    if station_value is None:
        return jsonify({"status": "failure", "message": "Field 'station' is required."}), 400

    station = int(station_value)

    try:
        active_batch = get_active_batch()
        with get_registry_connection() as registry_connection, get_batch_connection(active_batch["db_path"]) as connection:
            if scan_type == "lamination":
                return lamination_check(
                    connection,
                    registry_connection,
                    str(content.get("barcode") or ""),
                    int(active_batch["id"]),
                    station,
                )

            if scan_type == "compose":
                return composing_check(
                    connection,
                    registry_connection,
                    str(content.get("barcode") or ""),
                    str(content.get("prev_barcode") or "0"),
                    int(content.get("user_id") or 0),
                    int(content.get("school_id") or 0),
                    int(active_batch["id"]),
                    station,
                )

            return json_response(
                {"status": "failure", "message": "Unsupported scan type", "received": content},
                404,
                registry_connection,
                scan_type or "unknown",
                station,
                0,
                None,
            )
    except Exception as error:
        return jsonify({"status": "failure", "message": str(error)}), 500


def lamination_check(connection, registry_connection, barcode, active_batch_id, station):
    scan_type = "lamination"
    status_row = get_status_by_type(registry_connection, scan_type, station)
    sequence_start_book_id = get_lamination_sequence_start(status_row)

    try:
        parsed = parse_book_barcode(barcode)
    except ValueError:
        return json_response(
            {"status": "success", "message": "Wrong read"},
            205,
            registry_connection,
            scan_type,
            station,
            0,
            None,
            expected_book_id=get_expected_lamination_book(get_books_by_batch(connection), sequence_start_book_id),
            sequence_start_book_id=sequence_start_book_id,
        )

    book_id = parsed["book_id"]
    if parsed["batch_id"] != active_batch_id:
        return json_response(
            {"status": "failure", "message": f"Book {book_id} belongs to batch {parsed['batch_id']}, active batch is {active_batch_id}"},
            404,
            registry_connection,
            scan_type,
            station,
            0,
            book_id,
            expected_book_id=get_expected_lamination_book(get_books_by_batch(connection), sequence_start_book_id),
            sequence_start_book_id=sequence_start_book_id,
        )

    books = get_books_by_batch(connection)
    if not books:
        return json_response(
            {"status": "failure", "message": "No books found for active batch"},
            404,
            registry_connection,
            scan_type,
            station,
            0,
            book_id,
            sequence_start_book_id=sequence_start_book_id,
        )

    expected_book_id = get_expected_lamination_book(books, sequence_start_book_id)
    if expected_book_id is None:
        book = get_book_by_id(connection, book_id)
        if book is not None and int(book["lamination_status"] or 0) == 1:
            return json_response(
                {"status": "success", "message": f"Double read: Book {book_id} is already laminated"},
                204,
                registry_connection,
                scan_type,
                station,
                1,
                book_id,
                sequence_start_book_id=sequence_start_book_id,
            )

        return json_response(
            {"status": "success", "message": "Lamination sequence is complete"},
            200,
            registry_connection,
            scan_type,
            station,
            1,
            book_id,
            sequence_start_book_id=sequence_start_book_id,
        )

    current_book = get_book_by_id(connection, book_id)
    if current_book is None:
        return json_response(
            {"status": "failure", "message": "Book not found in active batch"},
            404,
            registry_connection,
            scan_type,
            station,
            0,
            book_id,
            expected_book_id=expected_book_id,
            sequence_start_book_id=sequence_start_book_id,
        )

    if int(current_book["lamination_status"] or 0) == 1:
        return json_response(
            {"status": "success", "message": f"Double read: Book {book_id} is already laminated"},
            204,
            registry_connection,
            scan_type,
            station,
            1,
            book_id,
            expected_book_id=expected_book_id,
            sequence_start_book_id=sequence_start_book_id,
        )

    if book_id == expected_book_id:
        mark_book_laminated(connection, book_id)
        next_expected = get_expected_lamination_book(get_books_by_batch(connection), sequence_start_book_id)
        return json_response(
            {"status": "success", "message": f"Book {book_id} laminated successfully"},
            200,
            registry_connection,
            scan_type,
            station,
            1,
            book_id,
            expected_book_id=next_expected,
            sequence_start_book_id=sequence_start_book_id,
        )

    return json_response(
        {
            "status": "failure",
            "message": f"Out of order sequence. Expected {expected_book_id}, scanned {book_id}",
            "expected_book_id": expected_book_id,
            "override_target_book_id": book_id,
        },
        409,
        registry_connection,
        scan_type,
        station,
        0,
        book_id,
        expected_book_id=expected_book_id,
        override_allowed=1,
        override_target_book_id=book_id,
        sequence_start_book_id=sequence_start_book_id,
    )


def composing_check(connection, registry_connection, barcode, barcode_prev, user_id, school_id, active_batch_id, station):
    scan_type = "compose"

    try:
        parsed = parse_book_barcode(barcode)
    except ValueError:
        return json_response(
            {"status": "success", "message": "Wrong read"},
            205,
            registry_connection,
            scan_type,
            station,
            0,
            None,
        )

    book_id = parsed["book_id"]
    if parsed["batch_id"] != active_batch_id:
        return json_response(
            {
                "status": "failure",
                "message": f"Book {book_id} belongs to batch {parsed['batch_id']}, active batch is {active_batch_id}",
                "user": user_id,
                "school": school_id,
                "barcode": barcode,
            },
            404,
            registry_connection,
            scan_type,
            station,
            0,
            book_id,
        )

    cover = 1 if parsed["is_cover"] else 0

    if cover == 0:
        try:
            previous = parse_book_barcode(barcode_prev)
        except ValueError:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Failed to read inner page for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        if not previous["is_cover"]:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Failed to read inner page for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        if previous["batch_id"] != active_batch_id:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Wrong batch for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        if parsed["innercode"] != previous["innercode"]:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Wrong Subject for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        if parsed["book_id"] != previous["book_id"]:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Cover and inner mismatch for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        if parsed["student_id"] != previous["student_id"] or parsed["school_id"] != previous["school_id"]:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Cover and inner mismatch for book id: {book_id}",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        current_student_id = parsed["student_id"]
        current_school_id = parsed["school_id"]

        if user_id != 0:
            if user_id != current_student_id or school_id != current_school_id:
                return json_response(
                    {
                        "status": "failure",
                        "message": "Previous User ID book not complete",
                        "user": user_id,
                        "school": school_id,
                        "barcode": barcode,
                    },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        books = get_books_for_student(connection, current_school_id, current_student_id)
        if not books:
            return json_response(
                {
                    "status": "failure",
                    "message": "No books found for student in active batch",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        book = next((item for item in books if int(item["book_id"]) == book_id), None)
        if book is None:
            return json_response(
                {
                    "status": "failure",
                    "message": f"Book {book_id} not found for student",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

        connection.execute(
            """
            UPDATE school_student_books
            SET lamination_status = 1,
                composing_status = 1
            WHERE school_id = ? AND student_id = ? AND CAST(book_id AS INTEGER) = ?
            """,
            (str(current_school_id), str(current_student_id), book_id),
        )
        connection.commit()

        refreshed_books = get_books_for_student(connection, current_school_id, current_student_id)
        if all(int(item["composing_status"] or 0) == 1 for item in refreshed_books):
            return json_response(
                {"status": "success", "message": "ALL OK", "user": 0, "school": 0, "barcode": 0},
                200,
                registry_connection,
                scan_type,
                station,
                1,
                book_id,
            )

        return json_response(
            {
                "status": "success",
                "message": "ALL OK",
                "user": current_student_id,
                "school": current_school_id,
                "barcode": barcode,
            },
            200,
            registry_connection,
            scan_type,
            station,
            1,
            book_id,
        )

    if barcode_prev != "0":
        try:
            previous = parse_book_barcode(barcode_prev)
        except ValueError:
            previous = None

        if previous and previous["is_cover"]:
            return json_response(
                {
                    "status": "failure",
                    "message": "Failed to read the previous cover pages",
                    "user": user_id,
                    "school": school_id,
                    "barcode": barcode,
                },
                404,
                registry_connection,
                scan_type,
                station,
                0,
                book_id,
            )

    return json_response(
        {"status": "success", "message": "ALL OK", "user": user_id, "school": school_id, "barcode": barcode},
        200,
        registry_connection,
        scan_type,
        station,
        1,
        book_id,
    )


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000)
