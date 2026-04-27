FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    tmux git curl ca-certificates gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt package*.json ./
RUN pip install --no-cache-dir -r requirements.txt && npm ci

COPY . .
RUN npm run build

RUN mkdir -p /work

ENV ANY_CONSOLE_WORKSPACE_ROOT=/work

EXPOSE 8888

CMD ["python", "-m", "uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8888"]
