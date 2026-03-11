# On-Premises CMDB Agent Connector

Collects local system information from the machine it runs on and normalizes it to the `AssetComputer` schema.

## Features

- Gathers CPU, memory, storage, and network information
- Detects operating system and architecture
- Lightweight - runs as scheduled task/cron job
- No external API dependencies

## Installation

```bash
cd connectors/agent-cmdb
pip install -r requirements.txt
```

## Configuration

Set these environment variables:

```bash
# MongoDB connection
export MONGODB_URI=mongodb://your-mongodb-server:27017
export MONGODB_DB=prism

# Optional: Custom source identifier
export AGENT_SOURCE_ID=agent-cmdb
```

## Running

```bash
# Direct execution
python collect.py

# Or from project root
npm run collect:agent
```

## Deployment

### Linux Cron Job

Add to crontab to run daily at 2 AM:

```bash
0 2 * * * cd /path/to/sightline-prism/connectors/agent-cmdb && /usr/bin/python3 collect.py >> /var/log/prism-agent.log 2>&1
```

### Windows Task Scheduler

Create a scheduled task that runs:
```
python.exe C:\path\to\sightline-prism\connectors\agent-cmdb\collect.py
```

### systemd Service (Linux)

Create `/etc/systemd/system/prism-agent.service`:

```ini
[Unit]
Description=Prism Asset Collection Agent
After=network.target

[Service]
Type=oneshot
User=prism
Environment="MONGODB_URI=mongodb://your-server:27017"
Environment="MONGODB_DB=prism"
WorkingDirectory=/opt/sightline-prism/connectors/agent-cmdb
ExecStart=/usr/bin/python3 collect.py

[Install]
WantedBy=multi-user.target
```

Then create a timer `/etc/systemd/system/prism-agent.timer`:

```ini
[Unit]
Description=Run Prism Agent Daily

[Timer]
OnCalendar=daily
Persistent=true

[Install]
WantedBy=timers.target
```

Enable and start:
```bash
sudo systemctl enable prism-agent.timer
sudo systemctl start prism-agent.timer
```

## Data Collected

- **System**: Hostname, FQDN, OS, architecture
- **CPU**: Core count, frequency
- **Memory**: Total and available RAM
- **Storage**: Total and used disk space
- **Network**: IP addresses for all interfaces
- **Boot time**: Last system boot

## Output

Creates snapshots in MongoDB collection: `snapshots_agent-cmdb`

Each snapshot contains:
- Timestamp
- Schema version
- Single `AssetComputer` object for the local machine
- Metadata

## Security Considerations

- Run with minimal privileges (non-root if possible)
- Use read-only MongoDB credentials
- Secure MongoDB connection (TLS recommended)
- Store credentials in environment variables, not in code
- Rotate MongoDB credentials regularly
