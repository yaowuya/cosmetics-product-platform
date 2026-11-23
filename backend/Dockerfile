FROM python:3.12-slim
WORKDIR /srv/showcase
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
COPY pyproject.toml alembic.ini ./
COPY app ./app
COPY migrations ./migrations
RUN pip install --no-cache-dir . && useradd --system --uid 10001 --user-group showcase
USER 10001:10001
ENTRYPOINT ["sh", "-ec", "IFS= read -r DATABASE_URL < /run/secrets/database_url || [ -n \"$DATABASE_URL\" ]; export DATABASE_URL; exec \"$@\"", "--"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
