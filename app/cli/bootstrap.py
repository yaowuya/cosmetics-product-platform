"""Bootstrap a single initial enterprise administrator without preset passwords."""
import argparse
import getpass
import os

from app.services.accounts import create_first_admin


def main() -> None:
    """Read the login and temporary password from the environment when present."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("login", nargs="?")
    args = parser.parse_args()
    login = (args.login or os.environ.get("ADMIN_LOGIN", "")).strip()
    if not login:
        parser.error("login is required, or set ADMIN_LOGIN")
    password = os.environ.get("ADMIN_PASSWORD")
    if not password:
        password = getpass.getpass("Temporary password: ")
        if password != getpass.getpass("Repeat temporary password: "):
            parser.exit(2, "Passwords do not match.\n")
    try:
        create_first_admin(login, password)
    except (ValueError, RuntimeError) as exc:
        parser.exit(2, f"{exc}\n")
    print("Administrator created; first login requires a password change.")


if __name__ == "__main__":
    main()
