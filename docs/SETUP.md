# Setup guide

This guide takes you from zero to a running dashboard with Docker Compose. It takes about 10 minutes.

## What you need

- **OPNsense** with the web GUI reachable from the Docker host (the default LAN anti-lockout rule allows this).
- **Unbound** as the DNS resolver on OPNsense (the default) and clients using OPNsense for DNS. Without it the dashboard still works, but shows IP addresses and networks instead of domain names.
- A **Docker host** in your network with Docker and the Compose plugin (`docker compose version` should work). `amd64` and `arm64` (e.g. Raspberry Pi 4/5) are supported.
- An **OPNsense API key**. Yes, it is required: the dashboard reads everything through the OPNsense REST API. Step 1 shows how to create one with read-mostly privileges.

## Step 1: Create an API user and key in OPNsense

Use a dedicated user, not your admin account.

1. **System → Access → Users**, click **+** to add a user.
   - Username: `insight`
   - Password: anything long and random (it is never used, the API key is used instead)
   - Login shell: none
2. Save, then edit the user again and set the **privileges**. These are the exact names from OPNsense, verified against the OPNsense source code:

   | Privilege | Used for |
   |---|---|
   | `Reporting: Traffic` | interface counters, live throughput, "Active now" clients |
   | `Diagnostics: Show States` | per-connection traffic (services, clients, networks, destinations) |
   | `Diagnostics: ARP Table` | device names and vendors (IPv4) |
   | `Diagnostics: NDP Table` | device names for IPv6 addresses |
   | `System: Gateways` | latency, packet loss, gateway status |
   | `Lobby: Dashboard` | uptime, load, memory, version |
   | `Diagnostics: Network Insight` | reverse DNS for client names in "Top clients" |
   | `Services: Unbound` | DNS cache dump for domain names (optional, see note) |
   | DHCP leases, one of `Services: Dnsmasq DNS/DHCP: Settings`, `Services: DHCP: Kea(v4)` | device names reported by the clients themselves (optional, see note) |

3. In the user list click the **key icon** ("Create and download API key"), or in older versions use the **API keys → +** button on the user page. Your browser downloads a small text file:

   ```
   key=Abc123...
   secret=Xyz789...
   ```

   Keep it, the secret is shown only once.

> **Security notes**
> - `Diagnostics: Show States` also allows *killing* states via the API, and `Services: Unbound` also allows *changing* Unbound settings. OPNsense has no read-only variant of these two. The dashboard only reads, but treat the key like a password.
> - Without `Services: Unbound` the dashboard works, it just cannot map IPs to domains (services are then recognised by port and network only).
> - Client names come from the ARP table first, then from DHCP leases, then from reverse DNS. Reverse DNS only finds names if Unbound knows your local hosts (e.g. "Register DHCP leases" / Dnsmasq integration). The DHCP lease privileges also allow *changing* the DHCP configuration, so only grant one of them if reverse DNS does not give you names. Use the one matching your DHCP server.
> - There is no dedicated privilege for the interface address list (`diagnostics/interface/get_interface_config`). Without it, private IPv4 networks are still detected automatically. If your LAN uses public IPv6 addresses, set `LOCAL_NETS` (see step 2) so they are counted as local clients.

## Step 2: Create the compose project

On the Docker host:

```bash
mkdir -p ~/opnsense-insight && cd ~/opnsense-insight
curl -fsSLO https://raw.githubusercontent.com/DieSteinhose/opnsense-dashboard/main/docker-compose.yml
curl -fsSL  https://raw.githubusercontent.com/DieSteinhose/opnsense-dashboard/main/.env.example -o .env
```

Edit `.env`. The minimum:

```ini
OPNSENSE_URL=https://192.168.1.1      # how you open the OPNsense GUI, incl. port if not 443
OPNSENSE_KEY=Abc123...                # from the downloaded file
OPNSENSE_SECRET=Xyz789...
LANGUAGE=en                           # or de
TZ=Europe/Berlin                      # for "today" and the daily trend
```

Optional, depending on your setup:

```ini
WAN_INTERFACES=wan                    # interface key(s) of your WAN, e.g. wan,opt2 for dual WAN
LOCAL_NETS=2a02:1234:5678:100::/56    # your delegated IPv6 prefix, if any
OPNSENSE_INSECURE=true                # default: accept the self-signed OPNsense certificate
# OPNSENSE_CA=/certs/ca.pem           # better: trust your own CA (mount it in docker-compose.yml)
```

The container stores its data in `./data` and makes that directory writable for itself on start (as uid/gid 1000, change with `PUID`/`PGID` if you want the files to belong to your own user).

The interface key is the internal OPNsense name (`wan`, `lan`, `opt1`, ...), not the description you gave the interface. For a PPPoE uplink it is still `wan`.

## Step 3: Start it

```bash
docker compose up -d
docker compose logs -f
```

A healthy start looks like this:

```
[http] OPNsense Insight 0.1.0 on http://0.0.0.0:8080, language en
[asn] downloading https://iptoasn.com/data/ip2asn-combined.tsv.gz
[asn] loaded 582011 ranges, 87365 networks
```

Lines starting with `[collector]` are errors from the OPNsense API (see troubleshooting).

Open `http://<docker-host>:8080`.

- Live throughput appears after a few seconds.
- "Active now" and the top lists fill after about 30 seconds (the first state poll only sets the baseline).
- The daily trend grows with every day the container runs. There is no history from before the first start.

## Step 4: Check the connection

The image ships a probe that tests every API endpoint and tells you what is missing:

```bash
docker compose exec opnsense-insight node scripts/probe.js
```

Example output:

```
OK   interfaceTraffic     42 ms
OK   states              180 ms
FAIL dnsCache             35 ms  GET unbound/diagnostics/dumpcache -> HTTP 403
...
```

`HTTP 403` means a missing privilege (see the table in step 1). The full report is written to `data/probe.json`. It contains your IP addresses, so do not post it publicly.

## Updating

```bash
docker compose pull && docker compose up -d
```

Data lives in `./data` (SQLite database and the ASN database) and survives updates.

## Own service rules

To recognise your Usenet provider, VPN server, game servers etc., copy the default rules and mount them:

```bash
curl -fsSL https://raw.githubusercontent.com/DieSteinhose/opnsense-dashboard/main/config/services.json -o services.json
```

In `docker-compose.yml`, enable the line:

```yaml
      - ./services.json:/app/config/services.json:ro
```

Then `docker compose up -d`. The format is explained at the top of the file and in the README.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `HTTP 401` in the logs | Key or secret wrong, or swapped. Copy them again from the downloaded file. |
| `HTTP 403` | Missing privilege, run the probe (step 4). |
| `self-signed certificate` / `unable to verify` | Set `OPNSENSE_INSECURE=true` or provide `OPNSENSE_CA`. |
| `timeout` / `ECONNREFUSED` | Wrong URL or port, or the Docker host may not reach the GUI. Test with `curl -k https://192.168.1.1` from the host. |
| WAN shows 0 | `WAN_INTERFACES` does not match the interface key. The Interfaces table in the dashboard shows each interface with its key, and the probe prints the available keys. |
| No domain names, only IPs | `Services: Unbound` privilege missing, clients use another DNS server, or browsers use DNS over HTTPS. |
| Large "Not tracked" share | Many short-lived connections between state polls. Lower `POLL_STATES_MS` (e.g. `5000`). |
| `cannot open /data/insight.db` / `unable to open database file` | The container fixes the owner of `./data` on start. This fails on NFS/CIFS mounts with root squash, or when you run the container with `user:`. Then run `sudo chown -R 1000:1000 ./data` on the host (or the `PUID`/`PGID` you set). On SELinux hosts (Fedora, RHEL) add `:Z` to the volume: `./data:/data:Z`. |
| `[asn] lookup disabled` | The container cannot reach iptoasn.com. Everything else works; networks and countries stay empty. Set `ASN_LOOKUP=false` to silence it. |

### Permission problems with `./data` (Dockge, Portainer, NAS shares)

The container makes `./data` writable for itself on start and falls back to running as root if the directory cannot be handed over. If it still fails, the log starts with `[entrypoint]` lines showing the owner and the mount type of `/data`. The simplest way out is a named volume managed by Docker instead of a folder:

```yaml
    volumes:
      - insight-data:/data

volumes:
  insight-data:
```

(`volumes:` at the end belongs to the top level of the compose file, not under the service.)

## Exposing it

The dashboard has **no login**. Keep it in your LAN, or put it behind a reverse proxy with authentication (e.g. Traefik, Caddy or nginx with basic auth, Authelia, or a VPN). Do not forward port 8080 to the internet.

## Trying it without OPNsense

```bash
docker run --rm -p 8080:8080 -e DEMO=1 -e LANGUAGE=en ghcr.io/diesteinhose/opnsense-dashboard:latest
```

This starts the dashboard with generated demo data and two weeks of fake history.
