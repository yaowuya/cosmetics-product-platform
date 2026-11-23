"""Bootstrap a single initial enterprise administrator without preset passwords."""
import argparse
import getpass

from app.services.accounts import create_first_admin


def main() -> None:
    """Accept a login, but read the temporary password only from hidden input."""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("login")
    args = parser.parse_args()
    password = getpass.getpass("Temporary password: ")
    if password != getpass.getpass("Repeat temporary password: "):
        parser.exit(2, "Passwords do not match.\n")
    try:
        create_first_admin(args.login, password)
    except (ValueError, RuntimeError) as exc:
        parser.exit(2, f"{exc}\n")
    print("Administrator created; first login requires a password change.")


if __name__ == "__main__":
    main()
