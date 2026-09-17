#!/bin/bash
# cron does not inherit the container's environment (DATABASE_URL, SECRET_KEY,
# FERNET_KEY, etc. set via docker-compose `environment:`) for the jobs it
# spawns. Dump the current environment to a file that each crontab entry
# sources before running, so jobs.* / psql actually see those variables.
while IFS='=' read -r name value; do
    [ -z "$name" ] && continue
    printf 'export %s=%q\n' "$name" "$value"
done < <(env) > /app/cron_env.sh
chmod 0600 /app/cron_env.sh

exec cron -f
