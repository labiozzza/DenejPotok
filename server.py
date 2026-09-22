#!/usr/bin/env python3
"""
Один сервер для фронта и API.
Запуск: python server.py
"""

from pathlib import Path
import json
import socket

from flask import Flask, jsonify, request

try:
    from flask_cors import CORS
    CORS_AVAILABLE = True
except ImportError:
    CORS_AVAILABLE = False
    print("Warning: Flask-CORS not available. Cross-origin requests may be blocked.")

BASE_DIR = Path(__file__).resolve().parent
DATA_FILE = BASE_DIR / "data" / "quotes.json"
DIVIDENDS_FILE = BASE_DIR / "data" / "dividends.json"
DEFAULT_QUOTES = {
    "GAZP": [50, 51, 53, 52, 54, 55, 56, 54, 53, 55, 56, 57],
    "YDEX": [20, 21, 22, 21, 23, 24, 24, 25, 26, 25, 26, 27],
    "MGNT": [70, 69, 68, 67, 68, 70, 72, 71, 73, 74, 73, 75],
    "SBER": [40, 41, 42, 41, 43, 44, 45, 44, 46, 47, 46, 48],
    "PLZL": [80, 79, 78, 77, 78, 79, 81, 80, 82, 83, 82, 84],
    "MTSS": [30, 31, 32, 31, 33, 34, 33, 35, 36, 35, 36, 37],
}
HOST = "0.0.0.0"
PORT = 5001

app = Flask(
    __name__,
    static_folder=str(BASE_DIR),   # index.html, app.js, styles.css, data/*
    static_url_path=""
)

if CORS_AVAILABLE:
    CORS(app)
else:
    @app.after_request
    def after_request(response):
        response.headers.add("Access-Control-Allow-Origin", "*")
        response.headers.add("Access-Control-Allow-Headers", "Content-Type,Authorization")
        response.headers.add("Access-Control-Allow-Methods", "GET,PUT,POST,DELETE,OPTIONS")
        return response


def get_local_ip() -> str:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except Exception:
        return "127.0.0.1"
    finally:
        s.close()


def load_json_file(path: Path, default):
    try:
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def save_json_file(path: Path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


def get_default_quotes_data():
    return {ticker: prices[:] for ticker, prices in DEFAULT_QUOTES.items()}


def load_quotes_data():
    return load_json_file(DATA_FILE, get_default_quotes_data())


def save_quotes_data(data):
    save_json_file(DATA_FILE, data)


def load_dividends_data():
    data = load_json_file(DIVIDENDS_FILE, [])
    return data if isinstance(data, list) else []


def save_dividends_data(data):
    save_json_file(DIVIDENDS_FILE, data)


def normalize_dividend_entry(entry):
    if not isinstance(entry, dict):
        raise ValueError("Invalid dividend payload")

    dividend_id = str(entry.get("id") or "").strip()
    ticker = str(entry.get("ticker") or "").strip().upper()

    if not dividend_id:
        raise ValueError("Dividend id is required")
    if not ticker:
        raise ValueError("Ticker is required")

    try:
        normalized = {
            "id": dividend_id,
            "ts": int(entry.get("ts")),
            "turn": int(entry.get("turn")),
            "ticker": ticker,
            "pct": int(entry.get("pct")),
            "divAmount": int(entry.get("divAmount")),
            "before": int(entry.get("before")),
            "after": int(entry.get("after")),
        }
    except (TypeError, ValueError):
        raise ValueError("Dividend payload contains invalid numeric values")

    if normalized["ts"] < 0 or normalized["turn"] < 0:
        raise ValueError("Dividend timestamp and turn must be non-negative")

    return normalized


@app.route("/", methods=["GET"])
def index():
    return app.send_static_file("index.html")


@app.route("/api/quotes", methods=["GET"])
def get_current_quotes():
    try:
        all_data = load_quotes_data()

        current_quotes = {}
        for ticker, prices in all_data.items():
            if prices and len(prices) > 0:
                current_quotes[ticker] = prices[-1]
            else:
                current_quotes[ticker] = 0

        return jsonify({
            "success": True,
            "data": current_quotes,
            "timestamp": request.environ.get("HTTP_DATE", "unknown")
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "data": {}
        }), 500


@app.route("/api/quotes/history", methods=["GET"])
def get_quotes_history():
    try:
        ticker = request.args.get("ticker")
        all_data = load_quotes_data()

        if ticker:
            if ticker in all_data:
                result = {ticker: all_data[ticker]}
            else:
                return jsonify({
                    "success": False,
                    "error": f"Ticker {ticker} not found",
                    "data": {}
                }), 404
        else:
            result = all_data

        return jsonify({
            "success": True,
            "data": result,
            "timestamp": request.environ.get("HTTP_DATE", "unknown")
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "data": {}
        }), 500


@app.route("/api/quotes", methods=["POST"])
def update_quotes():
    try:
        new_data = request.get_json()

        if not new_data:
            return jsonify({
                "success": False,
                "error": "No JSON data provided"
            }), 400

        for ticker, prices in new_data.items():
            if not isinstance(prices, list):
                return jsonify({
                    "success": False,
                    "error": f"Invalid data format for ticker {ticker}"
                }), 400

        save_quotes_data(new_data)

        return jsonify({
            "success": True,
            "message": "Quotes updated successfully"
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/dividends", methods=["GET"])
def get_dividends():
    try:
        ticker = (request.args.get("ticker") or "").strip().upper()
        limit = request.args.get("limit", type=int)
        dividends = load_dividends_data()

        if ticker:
            dividends = [item for item in dividends if item.get("ticker") == ticker]

        dividends = sorted(
            dividends,
            key=lambda item: (item.get("ts", 0), item.get("turn", 0), item.get("id", "")),
            reverse=True
        )

        if limit is not None:
            if limit < 1:
                return jsonify({
                    "success": False,
                    "error": "limit must be greater than 0",
                    "data": []
                }), 400
            dividends = dividends[:limit]

        return jsonify({
            "success": True,
            "data": dividends,
            "count": len(dividends)
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "data": []
        }), 500


@app.route("/api/dividends", methods=["POST"])
def record_dividend():
    try:
        payload = request.get_json()

        if not payload:
            return jsonify({
                "success": False,
                "error": "No JSON data provided"
            }), 400

        dividend = normalize_dividend_entry(payload)
        dividends = load_dividends_data()
        existing = next((item for item in dividends if item.get("id") == dividend["id"]), None)

        if existing:
            return jsonify({
                "success": True,
                "message": "Dividend already recorded",
                "data": existing
            })

        dividends.append(dividend)
        save_dividends_data(dividends)

        return jsonify({
            "success": True,
            "message": "Dividend recorded successfully",
            "data": dividend
        }), 201
    except ValueError as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 400
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/reset", methods=["POST"])
def reset_all_data():
    try:
        default_quotes = get_default_quotes_data()
        save_quotes_data(default_quotes)
        save_dividends_data([])

        return jsonify({
            "success": True,
            "message": "All data has been reset to defaults",
            "quotes_tickers": len(default_quotes),
            "dividends_cleared": True
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/api/status", methods=["GET"])
def get_status():
    try:
        data = load_quotes_data()
        dividends = load_dividends_data()
        ticker_count = len(data)
        total_points = sum(len(prices) for prices in data.values())

        return jsonify({
            "success": True,
            "status": "active",
            "tickers": ticker_count,
            "total_data_points": total_points,
            "total_dividends": len(dividends),
            "available_tickers": list(data.keys())
        })
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e),
            "status": "error"
        }), 500


@app.errorhandler(404)
def not_found(error):
    return jsonify({
        "success": False,
        "error": "Endpoint not found"
    }), 404


@app.errorhandler(500)
def internal_error(error):
    return jsonify({
        "success": False,
        "error": "Internal server error"
    }), 500


if __name__ == "__main__":
    local_ip = get_local_ip()

    print("")
    print("DenejPotok started")
    print(f"WEB UI:    http://localhost:{PORT}/")
    print(f"WEB UI:    http://{local_ip}:{PORT}/")
    print(f"API:       http://{local_ip}:{PORT}/api/quotes")
    print(f"DIVIDENDS: http://{local_ip}:{PORT}/api/dividends")
    print(f"STATUS:    http://{local_ip}:{PORT}/api/status")
    print(f"HOST ONLY: {local_ip}")
    print("")

    app.run(host=HOST, port=PORT, debug=True, use_reloader=False)
