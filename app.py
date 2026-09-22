# bots_links.py
import requests
from typing import List, Dict, Optional

TOKENS = [
    "8251741176:AAFFpha0sRBoJmjyY_JGcdgFTB2TXqbRtrM",
    "8210538807:AAHBUaQZFOiwX6-J0Z0nMZQImEUD1gJzAMM",
    "7118526007:AAFkEKNedChCgsNLsy17qNNAIaHRblgoMoM",
    "8493513806:AAFVZ0riCDpp3qiYxyFvZKQUrK3EthuRuyU",
    "8198361315:AAE5LVhnNOVb7X9tzIjSPNioe56EBW-07Sk",
    "8449933979:AAFhya7jZTyqZJYEMrFn3FHAGBfBlV5Iidc",
    "8204381660:AAHTEFLdHjw9tqwCjlBzEBTHJ7BjWOr09Ss",
    "8332882366:AAEqtq-ktarmJgEmnVI958jks6yrPc5-PDM",
]

API_URL = "https://api.telegram.org/bot{token}/getMe"


def mask_token(token: str) -> str:
    if len(token) <= 10:
        return "***"
    return token[:6] + "..." + token[-4:]


def get_bot_info(token: str, timeout: int = 8) -> Dict[str, Optional[str]]:
    url = API_URL.format(token=token)
    try:
        r = requests.get(url, timeout=timeout)
        data = r.json()
    except Exception as e:
        return {
            "token": mask_token(token),
            "ok": False,
            "error": f"request_failed: {e}",
            "id": None,
            "name": None,
            "username": None,
            "link": None,
        }

    if not data.get("ok"):
        return {
            "token": mask_token(token),
            "ok": False,
            "error": str(data),
            "id": None,
            "name": None,
            "username": None,
            "link": None,
        }

    res = data.get("result", {})
    username = res.get("username")
    link = f"https://t.me/{username}" if username else None

    return {
        "token": mask_token(token),
        "ok": True,
        "error": None,
        "id": str(res.get("id")),
        "name": res.get("first_name"),
        "username": username,
        "link": link,
    }


def main():
    rows: List[Dict[str, Optional[str]]] = []
    for t in TOKENS:
        info = get_bot_info(t)
        rows.append(info)

    # Печать компактной таблицы
    print("\n=== Итоги ===")
    print(f"{'Token':<15} {'OK':<3} {'Bot ID':<12} {'Name':<25} {'Username':<32} {'Link'}")
    for r in rows:
        print(
            f"{r['token']:<15} "
            f"{('Y' if r['ok'] else 'N'):<3} "
            f"{(r['id'] or '-'): <12} "
            f"{(r['name'] or '-'): <25} "
            f"{(r['username'] or '-'): <32} "
            f"{(r['link'] or '— нет username (задайте в @BotFather /setusername)')}"
        )

    # Отдельно — чистый список ссылок (только те, у кого есть username)
    links = [r["link"] for r in rows if r["link"]]
    print("\nСсылки на чат с ботами:")
    if links:
        for link in links:
            print(link)
    else:
        print("Нет ни одной ссылки — вероятно, у ботов не задан username.")


if __name__ == "__main__":
    main()
